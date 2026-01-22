/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  ChevronRight,
  Building2,
  Layers,
  MapPin,
  FolderKanban,
  Square,
  Box,
  DoorOpen,
  Eye,
  EyeOff,
  LayoutTemplate,
  FileBox,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

// Node types for the unified tree
type NodeType =
  | 'unified-storey'      // Grouped storey across models
  | 'model-contribution'  // Model's contribution to a unified storey
  | 'model-header'        // Model visibility control
  | 'element'             // Individual element
  | 'IfcProject'          // Project node (legacy)
  | 'IfcBuildingStorey';  // Single-model storey (legacy)

interface TreeNode {
  id: string;  // Unique ID for the node (can be composite)
  /** Express IDs this node represents (for elements/storeys) */
  expressIds: number[];
  /** Model IDs this node belongs to */
  modelIds: string[];
  name: string;
  type: NodeType;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isVisible: boolean;
  elementCount?: number;
  storeyElevation?: number;
  /** For model-contribution nodes, the model name */
  modelName?: string;
}

/** Data for a storey from a single model */
interface StoreyData {
  modelId: string;
  storeyId: number;
  name: string;
  elevation: number;
  elements: number[];
}

/** Unified storey grouping storeys from multiple models */
interface UnifiedStorey {
  key: string;  // Elevation-based key for matching
  name: string;
  elevation: number;
  storeys: StoreyData[];
  totalElements: number;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  'unified-storey': Layers,
  'model-contribution': FileBox,
  'model-header': FileBox,
  IfcProject: FolderKanban,
  IfcSite: MapPin,
  IfcBuilding: Building2,
  IfcBuildingStorey: Layers,
  IfcSpace: Box,
  IfcWall: Square,
  IfcWallStandardCase: Square,
  IfcDoor: DoorOpen,
  element: Box,
  default: Box,
};

// Helper to create elevation key (with 0.5m tolerance for matching)
function elevationKey(elevation: number): string {
  return (Math.round(elevation * 2) / 2).toFixed(2);
}

export function HierarchyPanel() {
  const {
    ifcDataStore,
    models,
    activeModelId,
    setActiveModel,
    setModelVisibility,
    setModelCollapsed,
    removeModel,
  } = useIfc();
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const selectedStoreys = useViewerStore((s) => s.selectedStoreys);
  const setStoreySelection = useViewerStore((s) => s.setStoreySelection);
  const setStoreysSelection = useViewerStore((s) => s.setStoreysSelection);
  const clearStoreySelection = useViewerStore((s) => s.clearStoreySelection);
  const isolateEntities = useViewerStore((s) => s.isolateEntities);

  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showEntities = useViewerStore((s) => s.showEntities);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const clearSelection = useViewerStore((s) => s.clearSelection);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Check if we have multiple models loaded
  const isMultiModel = models.size > 1;

  // Build unified storey data - groups storeys by elevation across all models
  const unifiedStoreys = useMemo((): UnifiedStorey[] => {
    if (models.size === 0) return [];

    const storeysByElevation = new Map<string, UnifiedStorey>();

    for (const [modelId, model] of models) {
      const dataStore = model.ifcDataStore;
      if (!dataStore?.spatialHierarchy) continue;

      const hierarchy = dataStore.spatialHierarchy;
      const { byStorey, storeyElevations } = hierarchy;

      for (const [storeyId, elements] of byStorey.entries()) {
        const elevation = storeyElevations.get(storeyId) ?? 0;
        const name = dataStore.entities.getName(storeyId) || `Storey #${storeyId}`;
        const key = elevationKey(elevation);

        const storeyData: StoreyData = {
          modelId,
          storeyId,
          name,
          elevation,
          elements: elements as number[],
        };

        if (storeysByElevation.has(key)) {
          const unified = storeysByElevation.get(key)!;
          unified.storeys.push(storeyData);
          unified.totalElements += elements.length;
          // Use the first storey's name or pick the shorter one
          if (name.length < unified.name.length) {
            unified.name = name;
          }
        } else {
          storeysByElevation.set(key, {
            key,
            name,
            elevation,
            storeys: [storeyData],
            totalElements: elements.length,
          });
        }
      }
    }

    // Sort by elevation descending (top to bottom)
    return Array.from(storeysByElevation.values())
      .sort((a, b) => b.elevation - a.elevation);
  }, [models]);

  // Get all element IDs for a unified storey (across all models)
  const getUnifiedStoreyElements = useCallback((unifiedStorey: UnifiedStorey): number[] => {
    const allElements: number[] = [];
    for (const storey of unifiedStorey.storeys) {
      allElements.push(...storey.elements);
    }
    return allElements;
  }, []);

  // Get all storey IDs for a unified storey (for isolation/filtering)
  const getUnifiedStoreyIds = useCallback((unifiedStorey: UnifiedStorey): number[] => {
    return unifiedStorey.storeys.map(s => s.storeyId);
  }, []);

  // Build the tree data structure
  const treeData = useMemo((): TreeNode[] => {
    const nodes: TreeNode[] = [];

    // Multi-model mode: show unified storeys first, then models
    if (isMultiModel && unifiedStoreys.length > 0) {
      // Add unified storeys
      for (const unified of unifiedStoreys) {
        const storeyNodeId = `unified-${unified.key}`;
        const isExpanded = expandedNodes.has(storeyNodeId);
        const allElements = getUnifiedStoreyElements(unified);
        const allStoreyIds = getUnifiedStoreyIds(unified);

        // Check visibility - visible if any element is not hidden
        const isVisible = allElements.some(id => !hiddenEntities.has(id));

        nodes.push({
          id: storeyNodeId,
          expressIds: allStoreyIds,
          modelIds: unified.storeys.map(s => s.modelId),
          name: unified.name,
          type: 'unified-storey',
          depth: 0,
          hasChildren: unified.storeys.length > 0,
          isExpanded,
          isVisible,
          elementCount: unified.totalElements,
          storeyElevation: unified.elevation,
        });

        // Add model contributions if expanded
        if (isExpanded) {
          for (const storey of unified.storeys) {
            const model = models.get(storey.modelId);
            const modelName = model?.name || storey.modelId;
            const contributionNodeId = `contribution-${storey.modelId}-${storey.storeyId}`;
            const contribExpanded = expandedNodes.has(contributionNodeId);

            // Check visibility for this model's contribution
            const contribVisible = storey.elements.some(id => !hiddenEntities.has(id));

            nodes.push({
              id: contributionNodeId,
              expressIds: [storey.storeyId],
              modelIds: [storey.modelId],
              name: modelName,
              type: 'model-contribution',
              depth: 1,
              hasChildren: storey.elements.length > 0,
              isExpanded: contribExpanded,
              isVisible: contribVisible,
              elementCount: storey.elements.length,
              modelName,
            });

            // Add elements if contribution is expanded
            if (contribExpanded) {
              const dataStore = model?.ifcDataStore;
              for (const elementId of storey.elements) {
                const entityType = dataStore?.entities.getTypeName(elementId) || 'Unknown';
                const entityName = dataStore?.entities.getName(elementId) || `${entityType} #${elementId}`;

                nodes.push({
                  id: `element-${storey.modelId}-${elementId}`,
                  expressIds: [elementId],
                  modelIds: [storey.modelId],
                  name: entityName,
                  type: 'element',
                  depth: 2,
                  hasChildren: false,
                  isExpanded: false,
                  isVisible: !hiddenEntities.has(elementId),
                });
              }
            }
          }
        }
      }

      // Add separator and model controls
      nodes.push({
        id: 'models-header',
        expressIds: [],
        modelIds: [],
        name: 'Models',
        type: 'model-header',
        depth: 0,
        hasChildren: false,
        isExpanded: false,
        isVisible: true,
      });

      // Add model entries for visibility control
      for (const [modelId, model] of models) {
        nodes.push({
          id: `model-${modelId}`,
          expressIds: [],
          modelIds: [modelId],
          name: model.name,
          type: 'model-header',
          depth: 0,
          hasChildren: false,
          isExpanded: false,
          isVisible: model.visible,
          elementCount: model.ifcDataStore?.entityCount,
        });
      }
    } else if (models.size === 1) {
      // Single model mode - simpler view
      const [modelId, model] = Array.from(models.entries())[0];
      const dataStore = model.ifcDataStore;

      if (dataStore?.spatialHierarchy) {
        const hierarchy = dataStore.spatialHierarchy;
        const { byStorey, storeyElevations } = hierarchy;

        // Sort storeys by elevation descending
        const storeysArray = Array.from(byStorey.entries()) as [number, number[]][];
        const sortedStoreys = storeysArray
          .map(([id, elements]) => ({
            id,
            name: dataStore.entities.getName(id) || `Storey #${id}`,
            elevation: storeyElevations.get(id) ?? 0,
            elements,
          }))
          .sort((a, b) => b.elevation - a.elevation);

        for (const storey of sortedStoreys) {
          const storeyNodeId = `storey-${storey.id}`;
          const isExpanded = expandedNodes.has(storeyNodeId);
          const isVisible = storey.elements.some(id => !hiddenEntities.has(id));

          nodes.push({
            id: storeyNodeId,
            expressIds: [storey.id],
            modelIds: [modelId],
            name: storey.name,
            type: 'IfcBuildingStorey',
            depth: 0,
            hasChildren: storey.elements.length > 0,
            isExpanded,
            isVisible,
            elementCount: storey.elements.length,
            storeyElevation: storey.elevation,
          });

          if (isExpanded) {
            for (const elementId of storey.elements) {
              const entityType = dataStore.entities.getTypeName(elementId) || 'Unknown';
              const entityName = dataStore.entities.getName(elementId) || `${entityType} #${elementId}`;

              nodes.push({
                id: `element-${modelId}-${elementId}`,
                expressIds: [elementId],
                modelIds: [modelId],
                name: entityName,
                type: 'element',
                depth: 1,
                hasChildren: false,
                isExpanded: false,
                isVisible: !hiddenEntities.has(elementId),
              });
            }
          }
        }
      }
    } else if (ifcDataStore?.spatialHierarchy) {
      // Legacy single-model mode (no federation)
      const hierarchy = ifcDataStore.spatialHierarchy;
      const { byStorey, storeyElevations } = hierarchy;

      const storeysArray = Array.from(byStorey.entries()) as [number, number[]][];
      const sortedStoreys = storeysArray
        .map(([id, elements]) => ({
          id,
          name: ifcDataStore.entities.getName(id) || `Storey #${id}`,
          elevation: storeyElevations.get(id) ?? 0,
          elements,
        }))
        .sort((a, b) => b.elevation - a.elevation);

      for (const storey of sortedStoreys) {
        const storeyNodeId = `storey-${storey.id}`;
        const isExpanded = expandedNodes.has(storeyNodeId);
        const isVisible = storey.elements.some(id => !hiddenEntities.has(id));

        nodes.push({
          id: storeyNodeId,
          expressIds: [storey.id],
          modelIds: ['legacy'],
          name: storey.name,
          type: 'IfcBuildingStorey',
          depth: 0,
          hasChildren: storey.elements.length > 0,
          isExpanded,
          isVisible,
          elementCount: storey.elements.length,
          storeyElevation: storey.elevation,
        });

        if (isExpanded) {
          for (const elementId of storey.elements) {
            const entityType = ifcDataStore.entities.getTypeName(elementId) || 'Unknown';
            const entityName = ifcDataStore.entities.getName(elementId) || `${entityType} #${elementId}`;

            nodes.push({
              id: `element-legacy-${elementId}`,
              expressIds: [elementId],
              modelIds: ['legacy'],
              name: entityName,
              type: 'element',
              depth: 1,
              hasChildren: false,
              isExpanded: false,
              isVisible: !hiddenEntities.has(elementId),
            });
          }
        }
      }
    }

    return nodes;
  }, [models, ifcDataStore, unifiedStoreys, expandedNodes, hiddenEntities, isMultiModel, getUnifiedStoreyElements, getUnifiedStoreyIds]);

  // Filter nodes based on search
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return treeData;
    const query = searchQuery.toLowerCase();
    return treeData.filter(node =>
      node.name.toLowerCase().includes(query) ||
      node.type.toLowerCase().includes(query)
    );
  }, [treeData, searchQuery]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Get all elements for a node (handles unified storeys, contributions, and single elements)
  const getNodeElements = useCallback((node: TreeNode): number[] => {
    if (node.type === 'unified-storey') {
      // Get elements from all contributing storeys
      const unified = unifiedStoreys.find(u => `unified-${u.key}` === node.id);
      if (unified) {
        return getUnifiedStoreyElements(unified);
      }
    } else if (node.type === 'model-contribution') {
      // Get elements from this model's storey contribution
      // Use node.modelIds and node.expressIds (not string parsing - UUIDs have dashes!)
      const modelId = node.modelIds[0];
      const storeyId = node.expressIds[0];
      const model = models.get(modelId);
      if (model?.ifcDataStore?.spatialHierarchy) {
        return (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
      }
    } else if (node.type === 'IfcBuildingStorey') {
      // Single model storey
      const storeyId = node.expressIds[0];
      if (ifcDataStore?.spatialHierarchy) {
        return (ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
      }
      // Or from the model in federation
      const modelId = node.modelIds[0];
      const model = models.get(modelId);
      if (model?.ifcDataStore?.spatialHierarchy) {
        return (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
      }
    } else if (node.type === 'element') {
      return node.expressIds;
    }
    return [];
  }, [unifiedStoreys, models, ifcDataStore, getUnifiedStoreyElements]);

  // Toggle visibility for a node
  const handleVisibilityToggle = useCallback((node: TreeNode) => {
    const elements = getNodeElements(node);
    if (elements.length === 0) return;

    // Check if all elements are currently visible (not hidden)
    const allVisible = elements.every(id => !hiddenEntities.has(id));

    if (allVisible) {
      hideEntities(elements);
      if (selectedEntityId !== null && elements.includes(selectedEntityId)) {
        clearSelection();
      }
    } else {
      showEntities(elements);
    }
  }, [getNodeElements, hiddenEntities, hideEntities, showEntities, selectedEntityId, clearSelection]);

  // Handle model visibility toggle
  const handleModelVisibilityToggle = useCallback((modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const model = models.get(modelId);
    if (model) {
      setModelVisibility(modelId, !model.visible);
    }
  }, [models, setModelVisibility]);

  // Remove model
  const handleRemoveModel = useCallback((modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeModel(modelId);
  }, [removeModel]);

  // Handle node click - for selection/isolation
  const handleNodeClick = useCallback((node: TreeNode, e: React.MouseEvent) => {
    if (node.type === 'model-header' && node.id !== 'models-header') {
      // Clicking model header - no action needed (visibility via eye icon)
      return;
    }

    if (node.type === 'unified-storey' || node.type === 'IfcBuildingStorey') {
      // Get all storey IDs for filtering
      const storeyIds = node.type === 'unified-storey'
        ? (unifiedStoreys.find(u => `unified-${u.key}` === node.id)?.storeys.map(s => s.storeyId) || [])
        : node.expressIds;

      if (e.ctrlKey || e.metaKey) {
        // Add to selection
        setStoreysSelection([...Array.from(selectedStoreys), ...storeyIds]);
      } else {
        // Single selection (toggle if already selected)
        if (storeyIds.length === 1 && selectedStoreys.has(storeyIds[0]) && selectedStoreys.size === 1) {
          clearStoreySelection();
        } else {
          setStoreysSelection(storeyIds);
        }
      }
    } else if (node.type === 'element') {
      const elementId = node.expressIds[0];
      const modelId = node.modelIds[0];
      setSelectedEntityId(elementId);
      if (modelId !== 'legacy') {
        setSelectedEntity({ modelId, expressId: elementId });
        setActiveModel(modelId);
      }
    }
  }, [unifiedStoreys, selectedStoreys, setStoreysSelection, clearStoreySelection, setSelectedEntityId, setSelectedEntity, setActiveModel]);

  if (!ifcDataStore && models.size === 0) {
    return (
      <div className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">Hierarchy</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-black">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-950">
            <LayoutTemplate className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="font-bold uppercase text-zinc-900 dark:text-zinc-100 mb-2">No Model</p>
          <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 max-w-[150px]">
            Structure will appear here when loaded
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 space-y-3 bg-zinc-50 dark:bg-black">
        <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
          {isMultiModel ? 'Building Storeys' : 'Hierarchy'}
        </h2>
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-9 text-sm rounded-none border-2 border-zinc-200 dark:border-zinc-800 focus:border-primary focus:ring-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
        />
      </div>

      {/* Tree */}
      <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin bg-white dark:bg-black">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = filteredNodes[virtualRow.index];
            const Icon = TYPE_ICONS[node.type] || TYPE_ICONS.default;

            // Determine if node is selected
            const isSelected = node.type === 'unified-storey'
              ? node.expressIds.some(id => selectedStoreys.has(id))
              : node.type === 'IfcBuildingStorey'
                ? selectedStoreys.has(node.expressIds[0])
                : node.type === 'element'
                  ? selectedEntityId === node.expressIds[0]
                  : false;

            const nodeHidden = !node.isVisible;

            // Special rendering for "Models" section header
            if (node.id === 'models-header') {
              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="flex items-center gap-2 px-2 py-2 bg-zinc-100 dark:bg-zinc-900 border-t-2 border-b border-zinc-200 dark:border-zinc-800 mt-2">
                    <FileBox className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Models
                    </span>
                  </div>
                </div>
              );
            }

            // Model header nodes (for visibility control)
            if (node.type === 'model-header' && node.id.startsWith('model-')) {
              const modelId = node.modelIds[0];
              const model = models.get(modelId);

              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className={cn(
                      'flex items-center gap-1 px-2 py-1.5 cursor-default border-l-4 transition-all group',
                      'hover:bg-zinc-50 dark:hover:bg-zinc-900',
                      'border-transparent',
                      !model?.visible && 'opacity-50'
                    )}
                    style={{ paddingLeft: '24px' }}
                  >
                    <FileBox className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="flex-1 text-sm truncate ml-1.5 text-zinc-900 dark:text-zinc-100">
                      {node.name}
                    </span>

                    {node.elementCount !== undefined && (
                      <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-zinc-500 dark:text-zinc-400 rounded-none">
                        {node.elementCount.toLocaleString()}
                      </span>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => handleModelVisibilityToggle(modelId, e)}
                          className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {model?.visible ? (
                            <Eye className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{model?.visible ? 'Hide model' : 'Show model'}</p>
                      </TooltipContent>
                    </Tooltip>

                    {models.size > 1 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => handleRemoveModel(modelId, e)}
                            className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Remove model</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            }

            // Regular node rendering (unified storeys, contributions, elements)
            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-1.5 cursor-pointer border-l-4 transition-all group hierarchy-item',
                    isSelected ? 'border-l-primary font-medium selected' : 'border-transparent',
                    nodeHidden && 'opacity-50 grayscale',
                    node.type === 'unified-storey' && 'bg-zinc-50/50 dark:bg-zinc-900/30',
                    node.type === 'model-contribution' && 'text-zinc-600 dark:text-zinc-400'
                  )}
                  style={{
                    paddingLeft: `${node.depth * 16 + 8}px`,
                    backgroundColor: isSelected ? 'var(--hierarchy-selected-bg)' : undefined,
                    color: isSelected ? 'var(--hierarchy-selected-text)' : undefined,
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button') === null) {
                      handleNodeClick(node, e);
                    }
                  }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('button') === null) {
                      e.preventDefault();
                    }
                  }}
                >
                  {/* Expand/Collapse */}
                  {node.hasChildren ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(node.id);
                      }}
                      className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-none mr-1"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 transition-transform duration-200',
                          node.isExpanded && 'rotate-90'
                        )}
                      />
                    </button>
                  ) : (
                    <div className="w-5" />
                  )}

                  {/* Visibility Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVisibilityToggle(node);
                        }}
                        className={cn(
                          'p-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-1',
                          nodeHidden && 'opacity-100'
                        )}
                      >
                        {node.isVisible ? (
                          <Eye className="h-3 w-3 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                        ) : (
                          <EyeOff className="h-3 w-3 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        {node.isVisible ? 'Hide' : 'Show'}
                        {node.type === 'unified-storey' && ' (all models)'}
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Type Icon */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Icon className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        node.type === 'unified-storey' ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400'
                      )} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        {node.type === 'unified-storey' ? 'Building Storey (all models)' :
                         node.type === 'model-contribution' ? 'Model contribution' :
                         node.type}
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Name */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(
                        'flex-1 text-sm truncate ml-1.5',
                        node.type === 'unified-storey'
                          ? 'font-medium text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-700 dark:text-zinc-300',
                        nodeHidden && 'line-through decoration-zinc-400 dark:decoration-zinc-600'
                      )}>{node.name}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{node.name}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Model badges for unified storeys */}
                  {node.type === 'unified-storey' && node.modelIds.length > 1 && (
                    <span className="text-[9px] font-mono bg-primary/20 text-primary px-1 py-0.5 rounded-none">
                      {node.modelIds.length}M
                    </span>
                  )}

                  {/* Storey Elevation */}
                  {node.storeyElevation !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 rounded-none">
                          {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Elevation: {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {/* Element Count */}
                  {node.elementCount !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-950 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-none">
                          {node.elementCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{node.elementCount} {node.elementCount === 1 ? 'element' : 'elements'}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer status */}
      {selectedStoreys.size > 0 ? (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 bg-primary text-white dark:bg-primary">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="uppercase tracking-wide">
              {selectedStoreys.size} {selectedStoreys.size === 1 ? 'STOREY' : 'STOREYS'} FILTERED
            </span>
            <div className="flex items-center gap-2">
              <span className="opacity-70 text-[10px] font-mono">ESC</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] uppercase border border-white/20 hover:bg-white/20 hover:text-white rounded-none px-2"
                onClick={clearStoreySelection}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : isMultiModel ? (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
          {models.size} models · Click storey to filter all
        </div>
      ) : (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
          Click to filter · Ctrl toggle
        </div>
      )}
    </div>
  );
}

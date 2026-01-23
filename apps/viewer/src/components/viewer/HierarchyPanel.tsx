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
import { IfcTypeEnum } from '@ifc-lite/data';

// Node types for the tree
type NodeType =
  | 'unified-storey'      // Grouped storey across models (multi-model only)
  | 'model-header'        // Model visibility control (section header or individual model)
  | 'IfcProject'          // Project node
  | 'IfcSite'             // Site node
  | 'IfcBuilding'         // Building node
  | 'IfcBuildingStorey'   // Storey node
  | 'element';            // Individual element

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

  // Helper to convert IfcTypeEnum to NodeType string
  const getNodeType = useCallback((ifcType: IfcTypeEnum): NodeType => {
    switch (ifcType) {
      case IfcTypeEnum.IfcProject: return 'IfcProject';
      case IfcTypeEnum.IfcSite: return 'IfcSite';
      case IfcTypeEnum.IfcBuilding: return 'IfcBuilding';
      case IfcTypeEnum.IfcBuildingStorey: return 'IfcBuildingStorey';
      default: return 'element';
    }
  }, []);

  // Build unified storey data for multi-model mode
  const unifiedStoreys = useMemo((): UnifiedStorey[] => {
    if (models.size <= 1) return [];

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

    return Array.from(storeysByElevation.values())
      .sort((a, b) => b.elevation - a.elevation);
  }, [models]);

  // Get all element IDs for a unified storey
  const getUnifiedStoreyElements = useCallback((unifiedStorey: UnifiedStorey): number[] => {
    const allElements: number[] = [];
    for (const storey of unifiedStorey.storeys) {
      allElements.push(...storey.elements);
    }
    return allElements;
  }, []);

  // Build the tree data structure
  const treeData = useMemo((): TreeNode[] => {
    const nodes: TreeNode[] = [];

    // Helper to recursively build spatial nodes (Project → Site → Building)
    // stopAtBuilding: if true, don't include storeys (for multi-model mode)
    const buildSpatialNodes = (
      spatialNode: { expressId: number; type: IfcTypeEnum; name: string; elevation?: number; children: any[]; elements: number[] },
      modelId: string,
      dataStore: any,
      depth: number,
      parentNodeId: string,
      stopAtBuilding: boolean
    ) => {
      const nodeId = `${parentNodeId}-${spatialNode.expressId}`;
      const nodeType = getNodeType(spatialNode.type);
      const isNodeExpanded = expandedNodes.has(nodeId);

      // Skip storeys in multi-model mode (they're shown in unified list)
      if (stopAtBuilding && nodeType === 'IfcBuildingStorey') {
        return;
      }

      // For storeys, get elements from byStorey map
      let elements: number[] = [];
      if (nodeType === 'IfcBuildingStorey') {
        elements = (dataStore.spatialHierarchy?.byStorey.get(spatialNode.expressId) as number[]) || [];
      }

      // Check visibility
      const isVisible = elements.length === 0 || elements.some((id: number) => !hiddenEntities.has(id));

      // Check if has children
      // In stopAtBuilding mode, buildings have no children (storeys shown separately)
      const hasNonStoreyChildren = spatialNode.children?.some(
        (c: any) => getNodeType(c.type) !== 'IfcBuildingStorey'
      );
      const hasChildren = stopAtBuilding
        ? (nodeType !== 'IfcBuilding' && hasNonStoreyChildren)
        : (spatialNode.children?.length > 0) || (nodeType === 'IfcBuildingStorey' && elements.length > 0);

      nodes.push({
        id: nodeId,
        expressIds: [spatialNode.expressId],
        modelIds: [modelId],
        name: spatialNode.name || `${nodeType} #${spatialNode.expressId}`,
        type: nodeType,
        depth,
        hasChildren,
        isExpanded: isNodeExpanded,
        isVisible,
        elementCount: nodeType === 'IfcBuildingStorey' ? elements.length : undefined,
        storeyElevation: spatialNode.elevation,
      });

      if (isNodeExpanded) {
        // Sort storeys by elevation descending
        const sortedChildren = nodeType === 'IfcBuilding'
          ? [...(spatialNode.children || [])].sort((a, b) => (b.elevation || 0) - (a.elevation || 0))
          : spatialNode.children || [];

        for (const child of sortedChildren) {
          buildSpatialNodes(child, modelId, dataStore, depth + 1, nodeId, stopAtBuilding);
        }

        // For storeys (single-model only), add elements
        if (!stopAtBuilding && nodeType === 'IfcBuildingStorey' && elements.length > 0) {
          for (const elementId of elements) {
            const entityType = dataStore.entities?.getTypeName(elementId) || 'Unknown';
            const entityName = dataStore.entities?.getName(elementId) || `${entityType} #${elementId}`;

            nodes.push({
              id: `element-${modelId}-${elementId}`,
              expressIds: [elementId],
              modelIds: [modelId],
              name: entityName,
              type: 'element',
              depth: depth + 1,
              hasChildren: false,
              isExpanded: false,
              isVisible: !hiddenEntities.has(elementId),
            });
          }
        }
      }
    };

    // Multi-model mode: unified storeys + MODELS section
    if (isMultiModel) {
      // 1. Add unified storeys at the top
      for (const unified of unifiedStoreys) {
        const storeyNodeId = `unified-${unified.key}`;
        const isExpanded = expandedNodes.has(storeyNodeId);
        const allElements = getUnifiedStoreyElements(unified);
        const allStoreyIds = unified.storeys.map(s => s.storeyId);
        const isVisible = allElements.some(id => !hiddenEntities.has(id));

        nodes.push({
          id: storeyNodeId,
          expressIds: allStoreyIds,
          modelIds: unified.storeys.map(s => s.modelId),
          name: unified.name,
          type: 'unified-storey',
          depth: 0,
          hasChildren: allElements.length > 0,
          isExpanded,
          isVisible,
          elementCount: unified.totalElements,
          storeyElevation: unified.elevation,
        });

        // If expanded, show elements grouped by model
        if (isExpanded) {
          for (const storey of unified.storeys) {
            const model = models.get(storey.modelId);
            const modelName = model?.name || storey.modelId;

            // Add model contribution header
            const contribNodeId = `contrib-${storey.modelId}-${storey.storeyId}`;
            const contribExpanded = expandedNodes.has(contribNodeId);
            const contribVisible = storey.elements.some(id => !hiddenEntities.has(id));

            nodes.push({
              id: contribNodeId,
              expressIds: [storey.storeyId],
              modelIds: [storey.modelId],
              name: modelName,
              type: 'model-header',
              depth: 1,
              hasChildren: storey.elements.length > 0,
              isExpanded: contribExpanded,
              isVisible: contribVisible,
              elementCount: storey.elements.length,
            });

            // If contribution expanded, show elements
            if (contribExpanded) {
              const dataStore = model?.ifcDataStore;
              for (const elementId of storey.elements) {
                const entityType = dataStore?.entities?.getTypeName(elementId) || 'Unknown';
                const entityName = dataStore?.entities?.getName(elementId) || `${entityType} #${elementId}`;

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

      // 2. Add MODELS section header
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

      // 3. Add each model with Project → Site → Building (NO storeys)
      for (const [modelId, model] of models) {
        const modelNodeId = `model-${modelId}`;
        const isModelExpanded = expandedNodes.has(modelNodeId);
        const hasSpatialHierarchy = model.ifcDataStore?.spatialHierarchy?.project !== undefined;

        nodes.push({
          id: modelNodeId,
          expressIds: [],
          modelIds: [modelId],
          name: model.name,
          type: 'model-header',
          depth: 0,
          hasChildren: hasSpatialHierarchy,
          isExpanded: isModelExpanded,
          isVisible: model.visible,
          elementCount: model.ifcDataStore?.entityCount,
        });

        // If expanded, show Project → Site → Building (stop at building, no storeys)
        if (isModelExpanded && model.ifcDataStore?.spatialHierarchy?.project) {
          buildSpatialNodes(
            model.ifcDataStore.spatialHierarchy.project,
            modelId,
            model.ifcDataStore,
            1,
            modelNodeId,
            true  // stopAtBuilding = true
          );
        }
      }
    } else if (models.size === 1) {
      // Single model: show full spatial hierarchy (including storeys)
      const [modelId, model] = Array.from(models.entries())[0];
      if (model.ifcDataStore?.spatialHierarchy?.project) {
        buildSpatialNodes(
          model.ifcDataStore.spatialHierarchy.project,
          modelId,
          model.ifcDataStore,
          0,
          'root',
          false  // stopAtBuilding = false (show full hierarchy)
        );
      }
    } else if (ifcDataStore?.spatialHierarchy?.project) {
      // Legacy single-model mode
      buildSpatialNodes(
        ifcDataStore.spatialHierarchy.project,
        'legacy',
        ifcDataStore,
        0,
        'root',
        false
      );
    }

    return nodes;
  }, [models, ifcDataStore, expandedNodes, hiddenEntities, isMultiModel, getNodeType, unifiedStoreys, getUnifiedStoreyElements]);

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

  // Get all elements for a node (handles unified storeys, single storeys, model contributions, and elements)
  const getNodeElements = useCallback((node: TreeNode): number[] => {
    if (node.type === 'unified-storey') {
      // Get all elements from all models for this unified storey
      const unified = unifiedStoreys.find(u => `unified-${u.key}` === node.id);
      if (unified) {
        return getUnifiedStoreyElements(unified);
      }
    } else if (node.type === 'model-header' && node.id.startsWith('contrib-')) {
      // Model contribution header inside a unified storey - get elements for this model's storey
      const storeyId = node.expressIds[0];
      const modelId = node.modelIds[0];
      const model = models.get(modelId);
      if (model?.ifcDataStore?.spatialHierarchy) {
        return (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
      }
    } else if (node.type === 'IfcBuildingStorey') {
      // Get storey elements
      const storeyId = node.expressIds[0];
      const modelId = node.modelIds[0];

      // Try legacy dataStore first
      if (ifcDataStore?.spatialHierarchy) {
        const elements = ifcDataStore.spatialHierarchy.byStorey.get(storeyId);
        if (elements) return elements as number[];
      }

      // Or from the model in federation
      const model = models.get(modelId);
      if (model?.ifcDataStore?.spatialHierarchy) {
        return (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
      }
    } else if (node.type === 'element') {
      return node.expressIds;
    }
    // Spatial containers (Project, Site, Building) and top-level models don't have direct element visibility toggle
    return [];
  }, [models, ifcDataStore, unifiedStoreys, getUnifiedStoreyElements]);

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

  // Handle node click - for selection/isolation or expand/collapse
  const handleNodeClick = useCallback((node: TreeNode, e: React.MouseEvent) => {
    if (node.type === 'model-header' && node.id !== 'models-header') {
      // Model header click handled by its own onClick (expand/collapse)
      return;
    }

    // Spatial container nodes - toggle expand/collapse
    if (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding') {
      if (node.hasChildren) {
        toggleExpand(node.id);
      }
      return;
    }

    if (node.type === 'unified-storey' || node.type === 'IfcBuildingStorey') {
      // Storey click - select/isolate (unified or single)
      const storeyIds = node.type === 'unified-storey'
        ? (unifiedStoreys.find(u => `unified-${u.key}` === node.id)?.storeys.map(s => s.storeyId) || [])
        : node.expressIds;

      if (e.ctrlKey || e.metaKey) {
        // Add to selection
        setStoreysSelection([...Array.from(selectedStoreys), ...storeyIds]);
      } else {
        // Single selection - toggle if already selected
        const allAlreadySelected = storeyIds.length > 0 &&
          storeyIds.every(id => selectedStoreys.has(id)) &&
          selectedStoreys.size === storeyIds.length;

        if (allAlreadySelected) {
          // Toggle off - clear selection to show all
          clearStoreySelection();
        } else {
          // Select this storey (replaces any existing selection)
          setStoreysSelection(storeyIds);
        }
      }
    } else if (node.type === 'element') {
      // Element click - select it
      const elementId = node.expressIds[0];  // Original expressId
      const modelId = node.modelIds[0];

      if (modelId !== 'legacy') {
        // Multi-model: need to convert to globalId for renderer
        const model = models.get(modelId);
        const globalId = elementId + (model?.idOffset ?? 0);
        setSelectedEntityId(globalId);
        setSelectedEntity({ modelId, expressId: elementId });
        setActiveModel(modelId);
      } else {
        // Legacy single-model: expressId = globalId (offset is 0)
        setSelectedEntityId(elementId);
      }
    }
  }, [selectedStoreys, setStoreysSelection, clearStoreySelection, setSelectedEntityId, setSelectedEntity, setActiveModel, toggleExpand, unifiedStoreys]);

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
                  <div className="flex items-center gap-2 px-2 h-full bg-zinc-100 dark:bg-zinc-900 border-t-2 border-b border-zinc-200 dark:border-zinc-800">
                    <FileBox className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Models
                    </span>
                  </div>
                </div>
              );
            }

            // Model header nodes (for visibility control and expansion)
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
                      'flex items-center gap-1 px-2 py-1.5 border-l-4 transition-all group',
                      'hover:bg-zinc-50 dark:hover:bg-zinc-900',
                      'border-transparent',
                      !model?.visible && 'opacity-50',
                      node.hasChildren && 'cursor-pointer'
                    )}
                    style={{ paddingLeft: '8px' }}
                    onClick={() => node.hasChildren && toggleExpand(node.id)}
                  >
                    {/* Expand/collapse chevron */}
                    {node.hasChildren ? (
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 text-zinc-400 transition-transform shrink-0',
                          node.isExpanded && 'rotate-90'
                        )}
                      />
                    ) : (
                      <div className="w-3.5" />
                    )}

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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleModelVisibilityToggle(modelId, e);
                          }}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveModel(modelId, e);
                            }}
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

            // Regular node rendering (spatial hierarchy nodes and elements)
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
                    'flex items-center gap-1 px-2 py-1.5 border-l-4 transition-all group hierarchy-item',
                    // No selection styling for spatial containers in multi-model mode
                    isMultiModel && (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding')
                      ? 'border-transparent cursor-default'
                      : cn(
                          'cursor-pointer',
                          isSelected ? 'border-l-primary font-medium selected' : 'border-transparent'
                        ),
                    nodeHidden && 'opacity-50 grayscale'
                  )}
                  style={{
                    paddingLeft: `${node.depth * 16 + 8}px`,
                    // No selection highlighting for spatial containers in multi-model mode
                    backgroundColor: isSelected && !(isMultiModel && (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding'))
                      ? 'var(--hierarchy-selected-bg)' : undefined,
                    color: isSelected && !(isMultiModel && (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding'))
                      ? 'var(--hierarchy-selected-text)' : undefined,
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

                  {/* Visibility Toggle - hide for spatial containers (Project/Site/Building) in multi-model mode */}
                  {!(isMultiModel && (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding')) && (
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
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {/* Type Icon */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{node.type}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Name */}
                  <span className={cn(
                    'flex-1 text-sm truncate ml-1.5',
                    (node.type === 'IfcProject' || node.type === 'IfcSite' || node.type === 'IfcBuilding')
                      ? 'font-medium text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-700 dark:text-zinc-300',
                    nodeHidden && 'line-through decoration-zinc-400 dark:decoration-zinc-600'
                  )}>{node.name}</span>

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

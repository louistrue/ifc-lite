/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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
  GripHorizontal,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';

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
  isVisible: boolean; // Note: For storeys, computed lazily during render for performance
  elementCount?: number;
  storeyElevation?: number;
  /** Internal: ID offset for lazy visibility computation */
  _idOffset?: number;
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

// Spatial container types (Project/Site/Building) - these don't have direct visibility toggles
const SPATIAL_CONTAINER_TYPES: Set<NodeType> = new Set(['IfcProject', 'IfcSite', 'IfcBuilding']);
const isSpatialContainer = (type: NodeType): boolean => SPATIAL_CONTAINER_TYPES.has(type);

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
  const setSelectedEntities = useViewerStore((s) => s.setSelectedEntities);
  const setSelectedModelId = useViewerStore((s) => s.setSelectedModelId);
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
  const [hasInitializedExpansion, setHasInitializedExpansion] = useState(false);

  // Resizable panel split (percentage for storeys section, 0.5 = 50%)
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Build unified storey data for multi-model mode (moved before useEffect that depends on it)
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

  // Auto-expand nodes on initial load based on model count
  useEffect(() => {
    // Only run once when data is first loaded
    if (hasInitializedExpansion) return;

    const newExpanded = new Set<string>();

    if (models.size === 1) {
      // Single model in federation: expand full hierarchy to show all storeys
      const [, model] = Array.from(models.entries())[0];
      const hierarchy = model.ifcDataStore?.spatialHierarchy;

      // Wait until spatial hierarchy is computed before initializing
      if (!hierarchy?.project) {
        return; // Don't mark as initialized - will retry when hierarchy is ready
      }

      // Expand Project → Site → Building to reveal storeys
      const project = hierarchy.project;
      const projectNodeId = `root-${project.expressId}`;
      newExpanded.add(projectNodeId);

      for (const site of project.children || []) {
        const siteNodeId = `${projectNodeId}-${site.expressId}`;
        newExpanded.add(siteNodeId);

        for (const building of site.children || []) {
          const buildingNodeId = `${siteNodeId}-${building.expressId}`;
          newExpanded.add(buildingNodeId);
        }
      }
    } else if (models.size > 1) {
      // Multi-model: expand all model entries in Models section
      // But collapse if there are too many items (rough estimate based on viewport)
      const totalItems = unifiedStoreys.length + models.size;
      const estimatedRowHeight = 36;
      const availableHeight = window.innerHeight * 0.6; // Estimate panel takes ~60% of viewport
      const maxVisibleItems = Math.floor(availableHeight / estimatedRowHeight);

      if (totalItems <= maxVisibleItems) {
        // Enough space - expand all model entries
        for (const [modelId] of models) {
          newExpanded.add(`model-${modelId}`);
        }
      }
      // If not enough space, leave collapsed (newExpanded stays empty for models)
    } else if (models.size === 0 && ifcDataStore?.spatialHierarchy?.project) {
      // Legacy single-model mode (loaded via loadFile, not in models Map)
      const hierarchy = ifcDataStore.spatialHierarchy;
      const project = hierarchy.project;
      const projectNodeId = `root-${project.expressId}`;
      newExpanded.add(projectNodeId);

      for (const site of project.children || []) {
        const siteNodeId = `${projectNodeId}-${site.expressId}`;
        newExpanded.add(siteNodeId);

        for (const building of site.children || []) {
          const buildingNodeId = `${siteNodeId}-${building.expressId}`;
          newExpanded.add(buildingNodeId);
        }
      }
    } else {
      // No data loaded yet
      return;
    }

    if (newExpanded.size > 0) {
      setExpandedNodes(newExpanded);
    }
    setHasInitializedExpansion(true);
  }, [models, ifcDataStore, hasInitializedExpansion, unifiedStoreys.length]);

  // Reset expansion state when all data is cleared
  useEffect(() => {
    if (models.size === 0 && !ifcDataStore) {
      setHasInitializedExpansion(false);
      setExpandedNodes(new Set());
    }
  }, [models.size, ifcDataStore]);

  // Get all element IDs for a unified storey (as global IDs) - optimized to avoid spread operator
  const getUnifiedStoreyElements = useCallback((unifiedStorey: UnifiedStorey): number[] => {
    // Pre-calculate total length for single allocation
    const totalLength = unifiedStorey.storeys.reduce((sum, s) => sum + s.elements.length, 0);
    const allElements = new Array<number>(totalLength);
    let idx = 0;
    for (const storey of unifiedStorey.storeys) {
      const model = models.get(storey.modelId);
      const offset = model?.idOffset ?? 0;
      // Direct assignment instead of spread for better performance
      for (const id of storey.elements) {
        allElements[idx++] = id + offset;
      }
    }
    return allElements;
  }, [models]);

  // Build the tree data structure
  const treeData = useMemo((): TreeNode[] => {
    const nodes: TreeNode[] = [];

    // Helper to recursively build spatial nodes (Project → Site → Building)
    // stopAtBuilding: if true, don't include storeys (for multi-model mode)
    const buildSpatialNodes = (
      spatialNode: SpatialNode,
      modelId: string,
      dataStore: IfcDataStore,
      depth: number,
      parentNodeId: string,
      stopAtBuilding: boolean,
      idOffset: number = 0
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

      // Note: isVisible is computed lazily during render for performance
      // We just need to know if there ARE elements (for empty check)
      const hasElements = elements.length > 0;

      // Check if has children
      // In stopAtBuilding mode, buildings have no children (storeys shown separately)
      const hasNonStoreyChildren = spatialNode.children?.some(
        (c: SpatialNode) => getNodeType(c.type) !== 'IfcBuildingStorey'
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
        isVisible: true, // Visibility computed lazily during render
        elementCount: nodeType === 'IfcBuildingStorey' ? elements.length : undefined,
        storeyElevation: spatialNode.elevation,
        // Store idOffset for lazy visibility computation
        _idOffset: idOffset,
      });

      if (isNodeExpanded) {
        // Sort storeys by elevation descending
        const sortedChildren = nodeType === 'IfcBuilding'
          ? [...(spatialNode.children || [])].sort((a, b) => (b.elevation || 0) - (a.elevation || 0))
          : spatialNode.children || [];

        for (const child of sortedChildren) {
          buildSpatialNodes(child, modelId, dataStore, depth + 1, nodeId, stopAtBuilding, idOffset);
        }

        // For storeys (single-model only), add elements
        if (!stopAtBuilding && nodeType === 'IfcBuildingStorey' && elements.length > 0) {
          for (const elementId of elements) {
            const globalId = elementId + idOffset;
            const entityType = dataStore.entities?.getTypeName(elementId) || 'Unknown';
            const entityName = dataStore.entities?.getName(elementId) || `${entityType} #${elementId}`;

            nodes.push({
              id: `element-${modelId}-${elementId}`,
              expressIds: [globalId],  // Store global ID for visibility operations
              modelIds: [modelId],
              name: entityName,
              type: 'element',
              depth: depth + 1,
              hasChildren: false,
              isExpanded: false,
              isVisible: true, // Computed lazily during render
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
        const allStoreyIds = unified.storeys.map(s => s.storeyId);

        nodes.push({
          id: storeyNodeId,
          expressIds: allStoreyIds,
          modelIds: unified.storeys.map(s => s.modelId),
          name: unified.name,
          type: 'unified-storey',
          depth: 0,
          hasChildren: unified.totalElements > 0,
          isExpanded,
          isVisible: true, // Computed lazily during render
          elementCount: unified.totalElements,
          storeyElevation: unified.elevation,
        });

        // If expanded, show elements grouped by model
        if (isExpanded) {
          for (const storey of unified.storeys) {
            const model = models.get(storey.modelId);
            const modelName = model?.name || storey.modelId;
            const offset = model?.idOffset ?? 0;

            // Add model contribution header
            const contribNodeId = `contrib-${storey.modelId}-${storey.storeyId}`;
            const contribExpanded = expandedNodes.has(contribNodeId);

            nodes.push({
              id: contribNodeId,
              expressIds: [storey.storeyId],
              modelIds: [storey.modelId],
              name: modelName,
              type: 'model-header',
              depth: 1,
              hasChildren: storey.elements.length > 0,
              isExpanded: contribExpanded,
              isVisible: true, // Computed lazily during render
              elementCount: storey.elements.length,
              _idOffset: offset,
            });

            // If contribution expanded, show elements
            if (contribExpanded) {
              const dataStore = model?.ifcDataStore;
              for (const elementId of storey.elements) {
                const globalId = elementId + offset;
                const entityType = dataStore?.entities?.getTypeName(elementId) || 'Unknown';
                const entityName = dataStore?.entities?.getName(elementId) || `${entityType} #${elementId}`;

                nodes.push({
                  id: `element-${storey.modelId}-${elementId}`,
                  expressIds: [globalId],  // Store global ID for visibility operations
                  modelIds: [storey.modelId],
                  name: entityName,
                  type: 'element',
                  depth: 2,
                  hasChildren: false,
                  isExpanded: false,
                  isVisible: true, // Computed lazily during render
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
            true,  // stopAtBuilding = true
            model.idOffset ?? 0
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
          false,  // stopAtBuilding = false (show full hierarchy)
          model.idOffset ?? 0
        );
      }
    } else if (ifcDataStore?.spatialHierarchy?.project) {
      // Legacy single-model mode (no offset)
      buildSpatialNodes(
        ifcDataStore.spatialHierarchy.project,
        'legacy',
        ifcDataStore,
        0,
        'root',
        false,
        0
      );
    }

    return nodes;
  // Note: hiddenEntities intentionally NOT in deps - visibility computed lazily for performance
  }, [models, ifcDataStore, expandedNodes, isMultiModel, getNodeType, unifiedStoreys, getUnifiedStoreyElements]);

  // Filter nodes based on search
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return treeData;
    const query = searchQuery.toLowerCase();
    return treeData.filter(node =>
      node.name.toLowerCase().includes(query) ||
      node.type.toLowerCase().includes(query)
    );
  }, [treeData, searchQuery]);

  // Split filtered nodes into storeys and models sections (for multi-model mode)
  const { storeysNodes, modelsNodes } = useMemo(() => {
    if (!isMultiModel) {
      // Single model mode - all nodes go in storeys section (which is the full hierarchy)
      return { storeysNodes: filteredNodes, modelsNodes: [] };
    }

    // Find the models-header index to split
    const modelsHeaderIdx = filteredNodes.findIndex(n => n.id === 'models-header');
    if (modelsHeaderIdx === -1) {
      return { storeysNodes: filteredNodes, modelsNodes: [] };
    }

    return {
      storeysNodes: filteredNodes.slice(0, modelsHeaderIdx),
      modelsNodes: filteredNodes.slice(modelsHeaderIdx + 1), // Skip the models-header itself
    };
  }, [filteredNodes, isMultiModel]);

  // Refs for both scroll areas
  const storeysRef = useRef<HTMLDivElement>(null);
  const modelsRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null); // Legacy single-model mode

  // Virtualizers for both sections
  const storeysVirtualizer = useVirtualizer({
    count: storeysNodes.length,
    getScrollElement: () => storeysRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const modelsVirtualizer = useVirtualizer({
    count: modelsNodes.length,
    getScrollElement: () => modelsRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  // Legacy virtualizer for single-model mode
  const virtualizer = useVirtualizer({
    count: filteredNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  // Resize handler for draggable divider
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      // Account for the search header height (~70px)
      const headerHeight = 70;
      const availableHeight = containerRect.height - headerHeight;
      const newRatio = Math.max(0.15, Math.min(0.85, (relativeY - headerHeight) / availableHeight));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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
        const localIds = (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
        // Convert local expressIds to global IDs using model's idOffset
        const offset = model.idOffset ?? 0;
        return localIds.map(id => id + offset);
      }
    } else if (node.type === 'IfcBuildingStorey') {
      // Get storey elements
      const storeyId = node.expressIds[0];
      const modelId = node.modelIds[0];

      // Try legacy dataStore first (no offset needed, IDs are already global)
      if (ifcDataStore?.spatialHierarchy) {
        const elements = ifcDataStore.spatialHierarchy.byStorey.get(storeyId);
        if (elements) return elements as number[];
      }

      // Or from the model in federation - need to apply idOffset
      const model = models.get(modelId);
      if (model?.ifcDataStore?.spatialHierarchy) {
        const localIds = (model.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[]) || [];
        const offset = model.idOffset ?? 0;
        return localIds.map(id => id + offset);
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

    // Spatial container nodes (IfcProject/IfcSite/IfcBuilding) - select for property panel + expand
    if (isSpatialContainer(node.type)) {
      const entityId = node.expressIds[0];
      const modelId = node.modelIds[0];

      if (modelId && modelId !== 'legacy') {
        // Multi-model: convert to globalId for renderer, set entity for property panel
        const model = models.get(modelId);
        const globalId = entityId + (model?.idOffset ?? 0);
        setSelectedEntityId(globalId);
        setSelectedEntity({ modelId, expressId: entityId });
        setActiveModel(modelId);
      } else if (entityId) {
        // Legacy single-model
        setSelectedEntityId(entityId);
        setSelectedEntity({ modelId: 'legacy', expressId: entityId });
      }

      // Also toggle expand if has children
      if (node.hasChildren) {
        toggleExpand(node.id);
      }
      return;
    }

    if (node.type === 'unified-storey' || node.type === 'IfcBuildingStorey') {
      // Storey click - select/isolate (unified or single)
      const unified = node.type === 'unified-storey'
        ? unifiedStoreys.find(u => `unified-${u.key}` === node.id)
        : null;
      const storeyIds = unified
        ? unified.storeys.map(s => s.storeyId)
        : node.expressIds;

      // Set entity refs for property panel display
      if (unified && unified.storeys.length > 1) {
        // Multi-model unified storey: show all storeys combined in property panel
        const entityRefs = unified.storeys.map(s => ({
          modelId: s.modelId,
          expressId: s.storeyId,
        }));
        setSelectedEntities(entityRefs);
        // Clear single entity selection (property panel will use selectedEntities)
        setSelectedEntityId(null);
      } else {
        // Single storey: show in property panel like any entity
        const storeyId = storeyIds[0];
        const modelId = node.modelIds[0];
        if (modelId && modelId !== 'legacy') {
          const model = models.get(modelId);
          const globalId = storeyId + (model?.idOffset ?? 0);
          setSelectedEntityId(globalId);
          setSelectedEntity({ modelId, expressId: storeyId });
        } else {
          setSelectedEntityId(storeyId);
          setSelectedEntity({ modelId: 'legacy', expressId: storeyId });
        }
      }

      if (e.ctrlKey || e.metaKey) {
        // Add to storey filter selection
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
  }, [selectedStoreys, setStoreysSelection, clearStoreySelection, setSelectedEntityId, setSelectedEntity, setSelectedEntities, setActiveModel, toggleExpand, unifiedStoreys, models]);

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

  // Helper function to render a node
  const renderNode = (node: TreeNode, virtualRow: { index: number; size: number; start: number }, nodeList: TreeNode[]) => {
    const Icon = TYPE_ICONS[node.type] || TYPE_ICONS.default;

    // Determine if node is selected
    const isSelected = node.type === 'unified-storey'
      ? node.expressIds.some(id => selectedStoreys.has(id))
      : node.type === 'IfcBuildingStorey'
        ? selectedStoreys.has(node.expressIds[0])
        : node.type === 'element'
          ? selectedEntityId === node.expressIds[0]
          : false;

    // Compute visibility inline - for elements check directly, for storeys use getNodeElements
    // This avoids a useCallback dependency that was causing infinite re-renders
    let nodeHidden = false;
    if (node.type === 'element') {
      nodeHidden = hiddenEntities.has(node.expressIds[0]);
    } else if (node.type === 'IfcBuildingStorey' || node.type === 'unified-storey' ||
               (node.type === 'model-header' && node.id.startsWith('contrib-'))) {
      const elements = getNodeElements(node);
      nodeHidden = elements.length > 0 && elements.every(id => hiddenEntities.has(id));
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
            onClick={() => {
              setSelectedModelId(modelId);
              if (node.hasChildren) toggleExpand(node.id);
            }}
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
            isMultiModel && isSpatialContainer(node.type)
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
            backgroundColor: isSelected && !(isMultiModel && isSpatialContainer(node.type))
              ? 'var(--hierarchy-selected-bg)' : undefined,
            color: isSelected && !(isMultiModel && isSpatialContainer(node.type))
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
          {!(isMultiModel && isSpatialContainer(node.type)) && (
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
            isSpatialContainer(node.type)
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
  };

  // Section header component
  const SectionHeader = ({ icon: IconComponent, title, count }: { icon: React.ElementType; title: string; count?: number }) => (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
      <IconComponent className="h-3.5 w-3.5 text-zinc-500" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
        {title}
      </span>
      {count !== undefined && (
        <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 ml-auto">
          {count}
        </span>
      )}
    </div>
  );

  // Multi-model layout with resizable split
  if (isMultiModel) {
    return (
      <div ref={containerRef} className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
        {/* Search Header */}
        <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            className="h-9 text-sm rounded-none border-2 border-zinc-200 dark:border-zinc-800 focus:border-primary focus:ring-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
          />
        </div>

        {/* Resizable content area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Storeys Section */}
          <div style={{ height: `${splitRatio * 100}%` }} className="flex flex-col min-h-0">
            <SectionHeader icon={Layers} title="Building Storeys" count={storeysNodes.length} />
            <div ref={storeysRef} className="flex-1 overflow-auto scrollbar-thin bg-white dark:bg-black">
              <div
                style={{
                  height: `${storeysVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {storeysVirtualizer.getVirtualItems().map((virtualRow) => {
                  const node = storeysNodes[virtualRow.index];
                  return renderNode(node, virtualRow, storeysNodes);
                })}
              </div>
            </div>
          </div>

          {/* Resizable Divider */}
          <div
            className={cn(
              'flex items-center justify-center h-2 cursor-ns-resize border-y border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors',
              isDragging && 'bg-primary/20'
            )}
            onMouseDown={handleResizeStart}
          >
            <GripHorizontal className="h-3 w-3 text-zinc-400" />
          </div>

          {/* Models Section */}
          <div style={{ height: `${(1 - splitRatio) * 100}%` }} className="flex flex-col min-h-0">
            <SectionHeader icon={FileBox} title="Models" count={models.size} />
            <div ref={modelsRef} className="flex-1 overflow-auto scrollbar-thin bg-white dark:bg-black">
              <div
                style={{
                  height: `${modelsVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {modelsVirtualizer.getVirtualItems().map((virtualRow) => {
                  const node = modelsNodes[virtualRow.index];
                  return renderNode(node, virtualRow, modelsNodes);
                })}
              </div>
            </div>
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
        ) : (
          <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
            {models.size} models · Drag divider to resize
          </div>
        )}
      </div>
    );
  }

  // Single model layout
  return (
    <div className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-9 text-sm rounded-none border-2 border-zinc-200 dark:border-zinc-800 focus:border-primary focus:ring-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
        />
      </div>

      {/* Section Header */}
      <SectionHeader icon={Building2} title="Hierarchy" count={filteredNodes.length} />

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
            return renderNode(node, virtualRow, filteredNodes);
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
      ) : (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
          Click to filter · Ctrl toggle
        </div>
      )}
    </div>
  );
}

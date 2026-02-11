/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { FederatedModel } from '@/store';
import type { TreeNode, NodeType, StoreyData, UnifiedStorey } from './types';

/** Helper to create elevation key (with 0.5m tolerance for matching) */
export function elevationKey(elevation: number): string {
  return (Math.round(elevation * 2) / 2).toFixed(2);
}

/** Convert IfcTypeEnum to NodeType string */
export function getNodeType(ifcType: IfcTypeEnum): NodeType {
  switch (ifcType) {
    case IfcTypeEnum.IfcProject: return 'IfcProject';
    case IfcTypeEnum.IfcSite: return 'IfcSite';
    case IfcTypeEnum.IfcBuilding: return 'IfcBuilding';
    case IfcTypeEnum.IfcBuildingStorey: return 'IfcBuildingStorey';
    default: return 'element';
  }
}

/** Build unified storey data for multi-model mode */
export function buildUnifiedStoreys(models: Map<string, FederatedModel>): UnifiedStorey[] {
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
}

/** Get all element IDs for a unified storey (as global IDs) - optimized to avoid spread operator */
export function getUnifiedStoreyElements(
  unifiedStorey: UnifiedStorey,
  models: Map<string, FederatedModel>
): number[] {
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
}

/** Recursively build spatial nodes (Project -> Site -> Building) */
function buildSpatialNodes(
  spatialNode: SpatialNode,
  modelId: string,
  dataStore: IfcDataStore,
  depth: number,
  parentNodeId: string,
  stopAtBuilding: boolean,
  idOffset: number,
  expandedNodes: Set<string>,
  nodes: TreeNode[]
): void {
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
      buildSpatialNodes(child, modelId, dataStore, depth + 1, nodeId, stopAtBuilding, idOffset, expandedNodes, nodes);
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
}

/** Build the complete tree data structure */
export function buildTreeData(
  models: Map<string, FederatedModel>,
  ifcDataStore: IfcDataStore | null | undefined,
  expandedNodes: Set<string>,
  isMultiModel: boolean,
  unifiedStoreys: UnifiedStorey[]
): TreeNode[] {
  const nodes: TreeNode[] = [];

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

    // 3. Add each model with Project -> Site -> Building (NO storeys)
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

      // If expanded, show Project -> Site -> Building (stop at building, no storeys)
      if (isModelExpanded && model.ifcDataStore?.spatialHierarchy?.project) {
        buildSpatialNodes(
          model.ifcDataStore.spatialHierarchy.project,
          modelId,
          model.ifcDataStore,
          1,
          modelNodeId,
          true,  // stopAtBuilding = true
          model.idOffset ?? 0,
          expandedNodes,
          nodes
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
        model.idOffset ?? 0,
        expandedNodes,
        nodes
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
      0,
      expandedNodes,
      nodes
    );
  }

  return nodes;
}

/** Build tree data grouped by IFC class instead of spatial hierarchy.
 *  Only includes entities that have geometry (visible in the 3D viewer).
 *  @param geometricIds Pre-computed set of global IDs with geometry (memoized by caller). */
export function buildTypeTree(
  models: Map<string, FederatedModel>,
  ifcDataStore: IfcDataStore | null | undefined,
  expandedNodes: Set<string>,
  isMultiModel: boolean,
  geometricIds?: Set<number>,
): TreeNode[] {
  // Collect entities grouped by IFC class across all models
  const typeGroups = new Map<string, Array<{ expressId: number; globalId: number; name: string; modelId: string }>>();

  const processDataStore = (dataStore: IfcDataStore, modelId: string, idOffset: number) => {
    for (let i = 0; i < dataStore.entities.count; i++) {
      const expressId = dataStore.entities.expressId[i];
      const globalId = expressId + idOffset;

      // Only include entities that have geometry
      if (geometricIds && geometricIds.size > 0 && !geometricIds.has(globalId)) continue;

      const typeName = dataStore.entities.getTypeName(expressId) || 'Unknown';
      const entityName = dataStore.entities.getName(expressId) || `${typeName} #${expressId}`;

      if (!typeGroups.has(typeName)) {
        typeGroups.set(typeName, []);
      }
      typeGroups.get(typeName)!.push({ expressId, globalId, name: entityName, modelId });
    }
  };

  // Process all models
  if (models.size > 0) {
    for (const [modelId, model] of models) {
      if (model.ifcDataStore) {
        processDataStore(model.ifcDataStore, modelId, model.idOffset ?? 0);
      }
    }
  } else if (ifcDataStore) {
    processDataStore(ifcDataStore, 'legacy', 0);
  }

  // Sort types alphabetically
  const sortedTypes = Array.from(typeGroups.keys()).sort();

  const nodes: TreeNode[] = [];
  for (const typeName of sortedTypes) {
    const entities = typeGroups.get(typeName)!;
    const groupNodeId = `type-${typeName}`;
    const isExpanded = expandedNodes.has(groupNodeId);

    // Store all globalIds on the group node so getNodeElements is O(1),
    // avoiding a full entity scan when the group is collapsed.
    const groupGlobalIds = entities.map(e => e.globalId);

    nodes.push({
      id: groupNodeId,
      expressIds: groupGlobalIds,
      modelIds: [],
      name: typeName,
      type: 'type-group',
      depth: 0,
      hasChildren: entities.length > 0,
      isExpanded,
      isVisible: true,
      elementCount: entities.length,
    });

    if (isExpanded) {
      // Sort elements by name within type group
      entities.sort((a, b) => a.name.localeCompare(b.name));
      for (const entity of entities) {
        const suffix = isMultiModel ? ` [${models.get(entity.modelId)?.name || entity.modelId}]` : '';
        nodes.push({
          id: `element-${entity.modelId}-${entity.expressId}`,
          expressIds: [entity.globalId],
          modelIds: [entity.modelId],
          name: entity.name + suffix,
          type: 'element',
          depth: 1,
          hasChildren: false,
          isExpanded: false,
          isVisible: true,
        });
      }
    }
  }

  return nodes;
}

/** Filter nodes based on search query */
export function filterNodes(nodes: TreeNode[], searchQuery: string): TreeNode[] {
  if (!searchQuery.trim()) return nodes;
  const query = searchQuery.toLowerCase();
  return nodes.filter(node =>
    node.name.toLowerCase().includes(query) ||
    node.type.toLowerCase().includes(query)
  );
}

/** Split filtered nodes into storeys and models sections (for multi-model mode) */
export function splitNodes(
  filteredNodes: TreeNode[],
  isMultiModel: boolean
): { storeysNodes: TreeNode[]; modelsNodes: TreeNode[] } {
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
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback, useEffect } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import type { FederatedModel } from '@/store';
import type { TreeNode, UnifiedStorey } from './types';
import {
  buildUnifiedStoreys,
  getUnifiedStoreyElements as getUnifiedStoreyElementsFn,
  buildTreeData,
  buildTypeTree,
  filterNodes,
  splitNodes,
} from './treeDataBuilder';

export type GroupingMode = 'spatial' | 'type';

interface UseHierarchyTreeParams {
  models: Map<string, FederatedModel>;
  ifcDataStore: IfcDataStore | null | undefined;
  isMultiModel: boolean;
  geometryResult?: GeometryResult | null;
}

/**
 * Build a stable Set of global IDs that have geometry.
 * Only rebuilds when the actual set of IDs changes, NOT when mesh colors change.
 */
function buildGeometricIdSet(
  models: Map<string, FederatedModel>,
  legacyGeometry: GeometryResult | null | undefined,
): Set<number> {
  const ids = new Set<number>();
  if (models.size > 0) {
    for (const [, model] of models) {
      if (model.geometryResult) {
        for (const mesh of model.geometryResult.meshes) {
          ids.add(mesh.expressId);
        }
      }
    }
  } else if (legacyGeometry) {
    for (const mesh of legacyGeometry.meshes) {
      ids.add(mesh.expressId);
    }
  }
  return ids;
}

export function useHierarchyTree({ models, ifcDataStore, isMultiModel, geometryResult }: UseHierarchyTreeParams) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [hasInitializedExpansion, setHasInitializedExpansion] = useState(false);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('hierarchy-grouping') as GroupingMode) || 'spatial'
  );

  // Build unified storey data for multi-model mode (moved before useEffect that depends on it)
  const unifiedStoreys = useMemo(
    (): UnifiedStorey[] => buildUnifiedStoreys(models),
    [models]
  );

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

      // Expand Project -> Site -> Building to reveal storeys
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

  // Get all element IDs for a unified storey (as global IDs)
  const getUnifiedStoreyElements = useCallback(
    (unifiedStorey: UnifiedStorey): number[] => getUnifiedStoreyElementsFn(unifiedStorey, models),
    [models]
  );

  // Stable mesh count — only changes when models are added/removed, not on color updates.
  // Used as a dep proxy so the geometric ID set doesn't rebuild on every color change.
  const meshCount = useMemo(() => {
    if (models.size > 0) {
      let count = 0;
      for (const [, model] of models) {
        count += model.geometryResult?.meshes.length ?? 0;
      }
      return count;
    }
    return geometryResult?.meshes.length ?? 0;
  }, [models, geometryResult?.meshes.length]);

  // Pre-computed set of global IDs with geometry — stable across color changes
  const geometricIds = useMemo(
    () => buildGeometricIdSet(models, geometryResult),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meshCount is a stable proxy
    [models, meshCount]
  );

  // Build the tree data structure based on grouping mode
  // Note: hiddenEntities intentionally NOT in deps - visibility computed lazily for performance
  const treeData = useMemo(
    (): TreeNode[] => {
      if (groupingMode === 'type') {
        return buildTypeTree(models, ifcDataStore, expandedNodes, isMultiModel, geometricIds);
      }
      return buildTreeData(models, ifcDataStore, expandedNodes, isMultiModel, unifiedStoreys);
    },
    [models, ifcDataStore, expandedNodes, isMultiModel, unifiedStoreys, groupingMode, geometricIds]
  );

  // Filter nodes based on search
  const filteredNodes = useMemo(
    () => filterNodes(treeData, searchQuery),
    [treeData, searchQuery]
  );

  // Split filtered nodes into storeys and models sections (for multi-model mode)
  const { storeysNodes, modelsNodes } = useMemo(
    () => splitNodes(filteredNodes, isMultiModel),
    [filteredNodes, isMultiModel]
  );

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

  // Get all elements for a node (handles type groups, unified storeys, single storeys, model contributions, and elements)
  const getNodeElements = useCallback((node: TreeNode): number[] => {
    if (node.type === 'type-group') {
      // GlobalIds are pre-stored on the node during tree construction — O(1)
      return node.expressIds;
    }
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

  // Persist grouping mode preference
  const handleSetGroupingMode = useCallback((mode: GroupingMode) => {
    setGroupingMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hierarchy-grouping', mode);
    }
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    groupingMode,
    setGroupingMode: handleSetGroupingMode,
    unifiedStoreys,
    treeData,
    filteredNodes,
    storeysNodes,
    modelsNodes,
    toggleExpand,
    getNodeElements,
    getUnifiedStoreyElements,
  };
}

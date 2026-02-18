/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { EntityRef } from './types.js';
import { entityRefToString, stringToEntityRef } from './types.js';
import { useViewerStore } from './index.js';

type ViewerStateSnapshot = ReturnType<typeof useViewerStore.getState>;

const STOREY_TYPE = 'IfcBuildingStorey';
const SPATIAL_CONTAINER_TYPES = new Set(['IfcProject', 'IfcSite', 'IfcBuilding']);

function getDataStoreForModel(state: ViewerStateSnapshot, modelId: string): IfcDataStore | null {
  if (modelId === 'legacy') {
    return state.ifcDataStore;
  }
  return state.models.get(modelId)?.ifcDataStore ?? null;
}

function getEntityTypeName(state: ViewerStateSnapshot, ref: EntityRef): string {
  const dataStore = getDataStoreForModel(state, ref.modelId);
  if (!dataStore) return '';
  return dataStore.entities.getTypeName(ref.expressId) || '';
}

function findSpatialNode(root: SpatialNode, expressId: number): SpatialNode | null {
  const stack: SpatialNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.expressId === expressId) {
      return current;
    }
    for (const child of current.children || []) {
      stack.push(child);
    }
  }
  return null;
}

function getContainerElementIds(dataStore: IfcDataStore, containerExpressId: number): number[] {
  const hierarchy = dataStore.spatialHierarchy;
  if (!hierarchy?.project) return [];

  const startNode = findSpatialNode(hierarchy.project, containerExpressId);
  if (!startNode) return [];

  const elementIds: number[] = [];
  const seen = new Set<number>();
  const stack: SpatialNode[] = [startNode];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === IfcTypeEnum.IfcBuildingStorey) {
      const storeyElements = hierarchy.byStorey.get(current.expressId) as number[] | undefined;
      if (storeyElements) {
        for (const id of storeyElements) {
          if (seen.has(id)) continue;
          seen.add(id);
          elementIds.push(id);
        }
      }
    }
    for (const child of current.children || []) {
      stack.push(child);
    }
  }

  return elementIds;
}

function expandRefToElements(state: ViewerStateSnapshot, ref: EntityRef): EntityRef[] {
  const dataStore = getDataStoreForModel(state, ref.modelId);
  if (!dataStore) return [ref];

  const entityType = dataStore.entities.getTypeName(ref.expressId) || '';
  if (entityType === STOREY_TYPE) {
    const localIds = dataStore.spatialHierarchy?.byStorey.get(ref.expressId) as number[] | undefined;
    if (!localIds || localIds.length === 0) return [];
    return localIds.map((expressId) => ({ modelId: ref.modelId, expressId }));
  }

  if (SPATIAL_CONTAINER_TYPES.has(entityType)) {
    const localIds = getContainerElementIds(dataStore, ref.expressId);
    if (localIds.length === 0) return [];
    return localIds.map((expressId) => ({ modelId: ref.modelId, expressId }));
  }

  return [ref];
}

function globalIdToRef(state: ViewerStateSnapshot, globalId: number): EntityRef | null {
  const resolved = state.resolveGlobalIdFromModels(globalId);
  if (resolved) {
    return { modelId: resolved.modelId, expressId: resolved.expressId };
  }

  if (state.models.size > 0) {
    const firstModelId = state.models.keys().next().value as string | undefined;
    if (firstModelId) {
      return { modelId: firstModelId, expressId: globalId };
    }
  }

  if (state.ifcDataStore) {
    return { modelId: 'legacy', expressId: globalId };
  }

  return null;
}

function dedupeRefs(refs: EntityRef[]): EntityRef[] {
  const out: EntityRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = entityRefToString(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function getSelectedStoreyElementRefs(state: ViewerStateSnapshot): EntityRef[] {
  if (state.selectedStoreys.size === 0) return [];

  const refs: EntityRef[] = [];
  const selectedStoreys = Array.from(state.selectedStoreys);

  if (state.models.size > 0) {
    for (const [modelId, model] of state.models) {
      const byStorey = model.ifcDataStore?.spatialHierarchy?.byStorey;
      if (!byStorey) continue;
      for (const storeyId of selectedStoreys) {
        const elementIds = byStorey.get(storeyId) as number[] | undefined;
        if (!elementIds) continue;
        for (const expressId of elementIds) {
          refs.push({ modelId, expressId });
        }
      }
    }
  } else if (state.ifcDataStore?.spatialHierarchy) {
    for (const storeyId of selectedStoreys) {
      const elementIds = state.ifcDataStore.spatialHierarchy.byStorey.get(storeyId) as number[] | undefined;
      if (!elementIds) continue;
      for (const expressId of elementIds) {
        refs.push({ modelId: 'legacy', expressId });
      }
    }
  }

  return dedupeRefs(refs);
}

/**
 * Resolve current UI selection into basket-ready element refs.
 * Spatial containers/storeys are expanded to their contained elements.
 */
export function getBasketSelectionRefsFromStore(): EntityRef[] {
  const state = useViewerStore.getState();

  let baseRefs: EntityRef[] = [];

  if (state.selectedEntitiesSet.size > 0) {
    for (const str of state.selectedEntitiesSet) {
      baseRefs.push(stringToEntityRef(str));
    }
  } else if (state.selectedEntityIds.size > 0) {
    for (const globalId of state.selectedEntityIds) {
      const ref = globalIdToRef(state, globalId);
      if (ref) baseRefs.push(ref);
    }
  } else if (state.selectedEntities.length > 0) {
    baseRefs = [...state.selectedEntities];
  } else if (state.selectedEntity) {
    baseRefs = [state.selectedEntity];
  }

  const hasExplicitElementSelection = baseRefs.some((ref) => {
    const typeName = getEntityTypeName(state, ref);
    return typeName !== STOREY_TYPE && !SPATIAL_CONTAINER_TYPES.has(typeName);
  });
  const hasContainerSelection = baseRefs.some((ref) => SPATIAL_CONTAINER_TYPES.has(getEntityTypeName(state, ref)));

  // If the hierarchy storey filter is active (possibly multi-storey), prefer all selected storeys.
  if (
    state.selectedStoreys.size > 0 &&
    state.selectedEntitiesSet.size === 0 &&
    state.selectedEntityIds.size === 0 &&
    !hasExplicitElementSelection &&
    !hasContainerSelection
  ) {
    const storeyRefs = getSelectedStoreyElementRefs(state);
    if (storeyRefs.length > 0) {
      return storeyRefs;
    }
  }

  if (baseRefs.length > 0) {
    const expanded = dedupeRefs(baseRefs.flatMap((ref) => expandRefToElements(state, ref)));
    if (expanded.length > 0) {
      return expanded;
    }
  }

  return getSelectedStoreyElementRefs(state);
}

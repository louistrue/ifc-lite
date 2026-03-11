/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, VisibilityBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { getModelForRef, type ModelLike } from './model-compat.js';
import { collectIfcBuildingStoreyElementsWithIfcSpace } from '../../store/basketVisibleSet.js';

const SPATIAL_TYPES = new Set([
  'IfcBuildingStorey',
  'IfcBuilding',
  'IfcSite',
  'IfcProject',
]);

/**
 * If `ref` points to a spatial structure element (storey, building, etc.),
 * expand it to the local expressIds of all contained elements.
 * Otherwise return the original expressId as-is.
 */
function expandSpatialRef(ref: EntityRef, model: ModelLike): number[] {
  const dataStore = model.ifcDataStore;
  const typeName = dataStore.entities.getTypeName(ref.expressId) || '';
  if (!SPATIAL_TYPES.has(typeName)) return [ref.expressId];

  const hierarchy = dataStore.spatialHierarchy;
  if (!hierarchy) return [ref.expressId];

  if (typeName === 'IfcBuildingStorey') {
    const ids = collectIfcBuildingStoreyElementsWithIfcSpace(hierarchy, ref.expressId);
    return ids && ids.length > 0 ? ids : [ref.expressId];
  }

  // For higher-level containers (IfcBuilding, IfcSite, IfcProject),
  // collect elements from all descendant storeys
  const allIds: number[] = [];
  const seen = new Set<number>();
  for (const [storeyId] of hierarchy.byStorey) {
    const storeyIds = collectIfcBuildingStoreyElementsWithIfcSpace(hierarchy, storeyId);
    if (storeyIds) {
      for (const id of storeyIds) {
        if (!seen.has(id)) {
          seen.add(id);
          allIds.push(id);
        }
      }
    }
  }
  return allIds.length > 0 ? allIds : [ref.expressId];
}

export function createVisibilityAdapter(store: StoreApi): VisibilityBackendMethods {
  return {
    hide(refs: EntityRef[]) {
      const state = store.getState();
      // Convert EntityRef to global IDs — the renderer subscribes to the flat
      // hiddenEntities set (global IDs), not hiddenEntitiesByModel.
      const globalIds: number[] = [];
      for (const ref of refs) {
        const model = getModelForRef(state, ref.modelId);
        if (model) {
          globalIds.push(ref.expressId + model.idOffset);
        }
      }
      if (globalIds.length > 0) {
        state.hideEntities(globalIds);
      }
      return undefined;
    },
    show(refs: EntityRef[]) {
      const state = store.getState();
      const globalIds: number[] = [];
      for (const ref of refs) {
        const model = getModelForRef(state, ref.modelId);
        if (model) {
          globalIds.push(ref.expressId + model.idOffset);
        }
      }
      if (globalIds.length > 0) {
        state.showEntities(globalIds);
      }
      return undefined;
    },
    isolate(refs: EntityRef[]) {
      const state = store.getState();
      const globalIds: number[] = [];
      for (const ref of refs) {
        const model = getModelForRef(state, ref.modelId);
        if (model) {
          const expanded = expandSpatialRef(ref, model);
          for (const id of expanded) {
            globalIds.push(id + model.idOffset);
          }
        }
      }
      if (globalIds.length > 0) {
        state.isolateEntities?.(globalIds);
      }
      return undefined;
    },
    reset() {
      const state = store.getState();
      state.showAllInAllModels?.();
      return undefined;
    },
  };
}

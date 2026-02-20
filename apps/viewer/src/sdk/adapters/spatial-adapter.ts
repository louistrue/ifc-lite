/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { AABB, SpatialFrustum, SpatialBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

export function createSpatialAdapter(store: StoreApi): SpatialBackendMethods {
  return {
    queryBounds(modelId: string, bounds: AABB) {
      const state = store.getState();
      const model = getModelForRef(state, modelId);
      if (!model?.ifcDataStore?.spatialIndex) return [];
      const expressIds = model.ifcDataStore.spatialIndex.queryAABB(bounds);
      return expressIds.map(expressId => ({ modelId, expressId }));
    },
    raycast(modelId: string, origin: [number, number, number], direction: [number, number, number]) {
      const state = store.getState();
      const model = getModelForRef(state, modelId);
      if (!model?.ifcDataStore?.spatialIndex) return [];
      const expressIds = model.ifcDataStore.spatialIndex.raycast(origin, direction);
      return expressIds.map(expressId => ({ modelId, expressId }));
    },
    queryFrustum(modelId: string, frustum: SpatialFrustum) {
      const state = store.getState();
      const model = getModelForRef(state, modelId);
      if (!model?.ifcDataStore?.spatialIndex) return [];
      const index = model.ifcDataStore.spatialIndex as {
        queryFrustum?: (frustum: SpatialFrustum) => number[];
      };
      if (!index.queryFrustum) return [];
      const expressIds = index.queryFrustum(frustum);
      return expressIds.map((expressId: number) => ({ modelId, expressId }));
    },
  };
}

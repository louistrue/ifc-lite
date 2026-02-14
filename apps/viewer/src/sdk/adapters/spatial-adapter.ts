/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { AABB, SpatialFrustum } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

export function createSpatialAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      const modelId = args[0] as string;
      const model = getModelForRef(state, modelId);
      if (!model?.ifcDataStore?.spatialIndex) return [];

      switch (method) {
        case 'queryBounds': {
          const bounds = args[1] as AABB;
          const expressIds = model.ifcDataStore.spatialIndex.queryAABB(bounds);
          return expressIds.map(expressId => ({ modelId, expressId }));
        }
        case 'raycast': {
          const origin = args[1] as [number, number, number];
          const direction = args[2] as [number, number, number];
          const expressIds = model.ifcDataStore.spatialIndex.raycast(origin, direction);
          return expressIds.map(expressId => ({ modelId, expressId }));
        }
        case 'queryFrustum': {
          const frustum = args[1] as SpatialFrustum;
          const index = model.ifcDataStore.spatialIndex as {
            queryFrustum?: (frustum: SpatialFrustum) => number[];
          };
          if (!index.queryFrustum) return [];
          const expressIds = index.queryFrustum(frustum);
          return expressIds.map((expressId: number) => ({ modelId, expressId }));
        }
        default:
          throw new Error(`Unknown spatial method: ${method}`);
      }
    },
  };
}

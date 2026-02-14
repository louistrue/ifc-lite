/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';

export function createVisibilityAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'hide': {
          const refs = args[0] as EntityRef[];
          for (const ref of refs) {
            state.hideEntityInModel?.(ref.modelId, ref.expressId);
          }
          return undefined;
        }
        case 'show': {
          const refs = args[0] as EntityRef[];
          for (const ref of refs) {
            state.showEntityInModel?.(ref.modelId, ref.expressId);
          }
          return undefined;
        }
        case 'isolate': {
          const refs = args[0] as EntityRef[];
          const globalIds: number[] = [];
          for (const ref of refs) {
            const model = state.models.get(ref.modelId);
            if (model) {
              globalIds.push(ref.expressId + model.idOffset);
            }
          }
          if (globalIds.length > 0) {
            state.isolateEntities?.(globalIds);
          }
          return undefined;
        }
        case 'reset':
          state.showAllInAllModels?.();
          return undefined;
        default:
          throw new Error(`Unknown visibility method: ${method}`);
      }
    },
  };
}

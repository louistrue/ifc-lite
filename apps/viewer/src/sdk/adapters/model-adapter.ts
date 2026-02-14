/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ModelInfo } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';

export function createModelAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string): unknown {
      const state = store.getState();
      switch (method) {
        case 'list': {
          const result: ModelInfo[] = [];
          for (const [, model] of state.models) {
            result.push({
              id: model.id,
              name: model.name,
              schemaVersion: model.schemaVersion,
              entityCount: model.ifcDataStore?.entities?.count ?? 0,
              fileSize: model.fileSize,
              loadedAt: model.loadedAt,
            });
          }
          return result;
        }
        case 'activeId':
          return state.activeModelId;
        default:
          throw new Error(`Unknown model method: ${method}`);
      }
    },
  };
}

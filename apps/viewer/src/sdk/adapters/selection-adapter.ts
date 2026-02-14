/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';

export function createSelectionAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'get':
          return state.selectedEntities ?? [];
        case 'set': {
          const refs = args[0] as EntityRef[];
          if (refs.length === 0) {
            state.clearEntitySelection?.();
          } else if (refs.length === 1) {
            state.setSelectedEntity?.(refs[0]);
          } else {
            state.clearEntitySelection?.();
            for (const ref of refs) {
              state.addEntityToSelection?.(ref);
            }
          }
          return undefined;
        }
        default:
          throw new Error(`Unknown selection method: ${method}`);
      }
    },
  };
}

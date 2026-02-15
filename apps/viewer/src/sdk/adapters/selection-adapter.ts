/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, SelectionBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';

export function createSelectionAdapter(store: StoreApi): SelectionBackendMethods {
  return {
    get() {
      const state = store.getState();
      return state.selectedEntities ?? [];
    },
    set(refs: EntityRef[]) {
      const state = store.getState();
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
    },
  };
}

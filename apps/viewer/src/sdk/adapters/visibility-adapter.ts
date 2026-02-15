/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef } from '@ifc-lite/sdk';
import type { Adapter, StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

export function createVisibilityAdapter(store: StoreApi): Adapter {
  return {
    hide(refs: EntityRef[]) {
      const state = store.getState();
      for (const ref of refs) {
        state.hideEntityInModel?.(ref.modelId, ref.expressId);
      }
      return undefined;
    },
    show(refs: EntityRef[]) {
      const state = store.getState();
      for (const ref of refs) {
        state.showEntityInModel?.(ref.modelId, ref.expressId);
      }
      return undefined;
    },
    isolate(refs: EntityRef[]) {
      const state = store.getState();
      const globalIds: number[] = [];
      for (const ref of refs) {
        const model = getModelForRef(state, ref.modelId);
        if (model) {
          globalIds.push(ref.expressId + model.idOffset);
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, VisibilityBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

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

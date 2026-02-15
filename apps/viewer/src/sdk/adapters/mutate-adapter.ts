/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, MutateBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';

export function createMutateAdapter(store: StoreApi): MutateBackendMethods {
  return {
    setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean) {
      const state = store.getState();
      state.setProperty?.(ref.modelId, ref.expressId, psetName, propName, value);
      return undefined;
    },
    deleteProperty(ref: EntityRef, psetName: string, propName: string) {
      const state = store.getState();
      state.deleteProperty?.(ref.modelId, ref.expressId, psetName, propName);
      return undefined;
    },
    undo(modelId: string) {
      const state = store.getState();
      if (state.canUndo?.(modelId)) {
        state.undo?.(modelId);
        return true;
      }
      return false;
    },
    redo(modelId: string) {
      const state = store.getState();
      if (state.canRedo?.(modelId)) {
        state.redo?.(modelId);
        return true;
      }
      return false;
    },
    batchBegin() {
      // TODO: Implement batch grouping when the mutation store supports it.
      // For now, individual mutations each create their own undo step.
      return undefined;
    },
    batchEnd() {
      return undefined;
    },
  };
}

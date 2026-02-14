/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';

export function createMutateAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'setProperty': {
          const ref = args[0] as EntityRef;
          const psetName = args[1] as string;
          const propName = args[2] as string;
          const value = args[3] as string | number | boolean;
          state.setProperty?.(ref.modelId, ref.expressId, psetName, propName, value);
          return undefined;
        }
        case 'deleteProperty': {
          const ref = args[0] as EntityRef;
          const psetName = args[1] as string;
          const propName = args[2] as string;
          state.deleteProperty?.(ref.modelId, ref.expressId, psetName, propName);
          return undefined;
        }
        case 'undo': {
          const modelId = args[0] as string;
          if (state.canUndo?.(modelId)) {
            state.undo?.(modelId);
            return true;
          }
          return false;
        }
        case 'redo': {
          const modelId = args[0] as string;
          if (state.canRedo?.(modelId)) {
            state.redo?.(modelId);
            return true;
          }
          return false;
        }
        case 'batchBegin':
          // TODO: Implement batch grouping when the mutation store supports it.
          // For now, individual mutations each create their own undo step.
          return undefined;
        case 'batchEnd':
          return undefined;
        default:
          throw new Error(`Unknown mutate method: ${method}`);
      }
    },
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { NamespaceAdapter, StoreApi } from './types.js';
import { BUILTIN_LENSES } from '@ifc-lite/lens';

export function createLensAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, _args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'presets':
          return BUILTIN_LENSES;
        case 'create': {
          const lens = _args[0] as Record<string, unknown>;
          const id = `lens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          return { ...lens, id };
        }
        case 'activate': {
          const lensId = _args[0] as string;
          state.setActiveLensId?.(lensId);
          return undefined;
        }
        case 'deactivate':
          state.setActiveLensId?.(null);
          return undefined;
        case 'getActive':
          return state.activeLensId ?? null;
        default:
          throw new Error(`Unknown lens method: ${method}`);
      }
    },
  };
}

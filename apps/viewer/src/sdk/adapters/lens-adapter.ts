/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { NamespaceAdapter, StoreApi } from './types.js';
import { BUILTIN_LENSES } from '@ifc-lite/lens';

/** Type guard for lens config object */
function isLensConfig(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function createLensAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'presets':
          return BUILTIN_LENSES;
        case 'create': {
          if (!isLensConfig(args[0])) {
            throw new Error('lens.create: argument must be a lens configuration object');
          }
          const lens = args[0];
          const id = crypto.randomUUID();
          return { ...lens, id };
        }
        case 'activate': {
          const lensId = args[0];
          if (typeof lensId !== 'string') {
            throw new Error('lens.activate: argument must be a lens ID string');
          }
          state.setActiveLens?.(lensId);
          return undefined;
        }
        case 'deactivate':
          state.setActiveLens?.(null);
          return undefined;
        case 'getActive':
          return state.activeLensId ?? null;
        default:
          throw new Error(`Unknown lens method: ${method}`);
      }
    },
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { LensBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { BUILTIN_LENSES } from '@ifc-lite/lens';

/** Type guard for lens config object */
function isLensConfig(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function createLensAdapter(store: StoreApi): LensBackendMethods {
  return {
    presets() {
      return BUILTIN_LENSES;
    },
    create(config: unknown) {
      if (!isLensConfig(config)) {
        throw new Error('lens.create: argument must be a lens configuration object');
      }
      const id = crypto.randomUUID();
      return { ...config, id };
    },
    activate(lensId: unknown) {
      if (typeof lensId !== 'string') {
        throw new Error('lens.activate: argument must be a lens ID string');
      }
      const state = store.getState();
      state.setActiveLens?.(lensId);
      return undefined;
    },
    deactivate() {
      const state = store.getState();
      state.setActiveLens?.(null);
      return undefined;
    },
    getActive() {
      const state = store.getState();
      return state.activeLensId ?? null;
    },
  };
}

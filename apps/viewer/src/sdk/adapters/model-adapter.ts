/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ModelInfo, ModelBackendMethods } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { getAllModelEntries, LEGACY_MODEL_ID } from './model-compat.js';

export function createModelAdapter(store: StoreApi): ModelBackendMethods {
  return {
    list() {
      const state = store.getState();
      const result: ModelInfo[] = [];
      for (const [, model] of getAllModelEntries(state)) {
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
    },
    activeId() {
      const state = store.getState();
      // For legacy single-model, return the sentinel ID when no active model is set
      return state.activeModelId ?? (state.models.size === 0 && state.ifcDataStore ? LEGACY_MODEL_ID : null);
    },
  };
}

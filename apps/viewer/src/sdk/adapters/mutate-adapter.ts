/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, MutateBackendMethods } from '@ifc-lite/sdk';
import { PropertyValueType } from '@ifc-lite/data';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { extractPropertiesOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import type { StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

/**
 * Ensure a MutablePropertyView exists for the given model and return it.
 * Scripts call setProperty before the user ever clicks an element,
 * so the PropertiesPanel lazy-init hasn't run yet.
 */
function ensureMutationView(store: StoreApi, modelId: string): MutablePropertyView | null {
  const state = store.getState();
  const existing = state.mutationViews.get(modelId);
  if (existing) return existing;

  const model = getModelForRef(state, modelId);
  if (!model?.ifcDataStore) return null;

  const dataStore = model.ifcDataStore;
  const view = new MutablePropertyView(dataStore.properties || null, modelId);

  if (dataStore.onDemandPropertyMap && dataStore.source?.length > 0) {
    view.setOnDemandExtractor((entityId: number) => {
      return extractPropertiesOnDemand(dataStore as IfcDataStore, entityId);
    });
  }

  state.registerMutationView?.(modelId, view);
  return view;
}

export function createMutateAdapter(store: StoreApi): MutateBackendMethods {
  return {
    setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean) {
      const view = ensureMutationView(store, ref.modelId);
      if (!view) return undefined;

      // Auto-detect PropertyValueType from value type so that numeric
      // quantities stored via setProperty are persisted as Real, not String.
      const valueType = typeof value === 'number' ? PropertyValueType.Real
        : typeof value === 'boolean' ? PropertyValueType.Boolean
        : PropertyValueType.String;

      // Write directly to the MutablePropertyView — avoids creating a
      // per-call undo entry when scripts set hundreds of properties at once.
      view.setProperty(ref.expressId, psetName, propName, value, valueType);

      // Mark model as dirty and bump mutation version so the UI refreshes.
      const state = store.getState();
      state.bumpMutationVersion?.();

      return undefined;
    },
    deleteProperty(ref: EntityRef, psetName: string, propName: string) {
      const view = ensureMutationView(store, ref.modelId);
      if (!view) return undefined;

      view.deleteProperty(ref.expressId, psetName, propName);

      const state = store.getState();
      state.bumpMutationVersion?.();

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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Model state slice for multi-model federation
 * Manages the collection of loaded IFC models
 */

import type { StateCreator } from 'zustand';
import type { FederatedModel } from '../types.js';

export interface ModelSlice {
  // State
  /** Map of all loaded models by ID */
  models: Map<string, FederatedModel>;
  /** ID of the currently active model (for property panel focus) */
  activeModelId: string | null;
  /** Map expressId to modelId for fast lookup during selection */
  entityToModelMap: Map<number, string>;

  // Actions
  /** Add a new model to the federation */
  addModel: (model: FederatedModel) => void;
  /** Remove a model from the federation */
  removeModel: (modelId: string) => void;
  /** Clear all models */
  clearAllModels: () => void;
  /** Set the active model for property panel focus */
  setActiveModel: (modelId: string | null) => void;
  /** Toggle model visibility */
  setModelVisibility: (modelId: string, visible: boolean) => void;
  /** Toggle model collapsed state in hierarchy */
  setModelCollapsed: (modelId: string, collapsed: boolean) => void;
  /** Rename a model */
  setModelName: (modelId: string, name: string) => void;
  /** Get a model by ID */
  getModel: (modelId: string) => FederatedModel | undefined;
  /** Get the currently active model */
  getActiveModel: () => FederatedModel | undefined;
  /** Get all visible models */
  getAllVisibleModels: () => FederatedModel[];
  /** Check if any models are loaded */
  hasModels: () => boolean;
  /** Register entity IDs to a model for fast lookup */
  registerEntityIds: (modelId: string, expressIds: number[]) => void;
  /** Find which model contains an entity */
  findModelForEntity: (expressId: number) => string | null;
}

export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set, get) => ({
  // Initial state
  models: new Map(),
  activeModelId: null,
  entityToModelMap: new Map(),

  // Actions
  addModel: (model) => set((state) => {
    const newModels = new Map(state.models);
    newModels.set(model.id, model);

    // If first model, make it active
    // If adding more models, collapse all existing by default
    if (state.models.size === 0) {
      return { models: newModels, activeModelId: model.id };
    } else {
      // Collapse existing models when adding new ones
      for (const [id, m] of newModels) {
        if (id !== model.id) {
          newModels.set(id, { ...m, collapsed: true });
        }
      }
      return { models: newModels };
    }
  }),

  removeModel: (modelId) => set((state) => {
    const newModels = new Map(state.models);
    newModels.delete(modelId);

    // Update activeModelId if removed model was active
    let newActiveId = state.activeModelId;
    if (state.activeModelId === modelId) {
      const remaining = Array.from(newModels.keys());
      newActiveId = remaining.length > 0 ? remaining[0] : null;
    }

    // Clean up entityToModelMap for removed model
    const newEntityMap = new Map(state.entityToModelMap);
    for (const [expressId, mId] of newEntityMap) {
      if (mId === modelId) {
        newEntityMap.delete(expressId);
      }
    }

    return { models: newModels, activeModelId: newActiveId, entityToModelMap: newEntityMap };
  }),

  clearAllModels: () => set({
    models: new Map(),
    activeModelId: null,
    entityToModelMap: new Map(),
  }),

  setActiveModel: (modelId) => set({ activeModelId: modelId }),

  setModelVisibility: (modelId, visible) => set((state) => {
    const model = state.models.get(modelId);
    if (!model) return {};

    const newModels = new Map(state.models);
    newModels.set(modelId, { ...model, visible });
    return { models: newModels };
  }),

  setModelCollapsed: (modelId, collapsed) => set((state) => {
    const model = state.models.get(modelId);
    if (!model) return {};

    const newModels = new Map(state.models);
    newModels.set(modelId, { ...model, collapsed });
    return { models: newModels };
  }),

  setModelName: (modelId, name) => set((state) => {
    const model = state.models.get(modelId);
    if (!model) return {};

    const newModels = new Map(state.models);
    newModels.set(modelId, { ...model, name });
    return { models: newModels };
  }),

  // Getters (synchronous access via get())
  getModel: (modelId) => get().models.get(modelId),

  getActiveModel: () => {
    const state = get();
    return state.activeModelId ? state.models.get(state.activeModelId) : undefined;
  },

  getAllVisibleModels: () => {
    return Array.from(get().models.values()).filter(m => m.visible);
  },

  hasModels: () => get().models.size > 0,

  registerEntityIds: (modelId, expressIds) => set((state) => {
    const newEntityMap = new Map(state.entityToModelMap);
    for (const expressId of expressIds) {
      newEntityMap.set(expressId, modelId);
    }
    return { entityToModelMap: newEntityMap };
  }),

  findModelForEntity: (expressId) => {
    return get().entityToModelMap.get(expressId) ?? null;
  },
});

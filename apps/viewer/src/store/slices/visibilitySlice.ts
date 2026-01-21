/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Visibility state slice
 */

import type { StateCreator } from 'zustand';
import type { TypeVisibility } from '../types.js';
import { TYPE_VISIBILITY_DEFAULTS } from '../constants.js';

export interface VisibilitySlice {
  // State
  hiddenEntities: Set<number>;
  isolatedEntities: Set<number> | null;
  typeVisibility: TypeVisibility;

  // Actions
  hideEntity: (id: number) => void;
  hideEntities: (ids: number[]) => void;
  showEntity: (id: number) => void;
  showEntities: (ids: number[]) => void;
  toggleEntityVisibility: (id: number) => void;
  isolateEntity: (id: number) => void;
  isolateEntities: (ids: number[]) => void;
  clearIsolation: () => void;
  showAll: () => void;
  isEntityVisible: (id: number) => boolean;
  toggleTypeVisibility: (type: 'spaces' | 'openings' | 'site') => void;
}

export const createVisibilitySlice: StateCreator<VisibilitySlice, [], [], VisibilitySlice> = (set, get) => ({
  // Initial state
  hiddenEntities: new Set(),
  isolatedEntities: null,
  typeVisibility: {
    spaces: TYPE_VISIBILITY_DEFAULTS.SPACES,
    openings: TYPE_VISIBILITY_DEFAULTS.OPENINGS,
    site: TYPE_VISIBILITY_DEFAULTS.SITE,
  },

  // Actions
  hideEntity: (id) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    newHidden.add(id);
    return { hiddenEntities: newHidden };
  }),

  hideEntities: (ids) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    ids.forEach(id => newHidden.add(id));
    return { hiddenEntities: newHidden };
  }),

  showEntity: (id) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    newHidden.delete(id);
    return { hiddenEntities: newHidden };
  }),

  showEntities: (ids) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    ids.forEach(id => newHidden.delete(id));
    return { hiddenEntities: newHidden };
  }),

  toggleEntityVisibility: (id) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    if (newHidden.has(id)) {
      newHidden.delete(id);
    } else {
      newHidden.add(id);
    }
    return { hiddenEntities: newHidden };
  }),

  isolateEntity: (id) => set((state) => {
    // Toggle isolate: if this entity is already the only isolated one, clear isolation
    const isAlreadyIsolated = state.isolatedEntities !== null &&
      state.isolatedEntities.size === 1 &&
      state.isolatedEntities.has(id);

    if (isAlreadyIsolated) {
      return { isolatedEntities: null };
    } else {
      // Isolate this entity (and unhide it)
      const newHidden = new Set(state.hiddenEntities);
      newHidden.delete(id);
      return {
        isolatedEntities: new Set([id]),
        hiddenEntities: newHidden,
      };
    }
  }),

  isolateEntities: (ids) => set((state) => {
    // Toggle isolate: if these exact entities are already isolated, clear isolation
    const idsSet = new Set(ids);
    const isAlreadyIsolated = state.isolatedEntities !== null &&
      state.isolatedEntities.size === idsSet.size &&
      ids.every(id => state.isolatedEntities!.has(id));

    if (isAlreadyIsolated) {
      return { isolatedEntities: null };
    } else {
      // Isolate these entities (and unhide them)
      const newHidden = new Set(state.hiddenEntities);
      ids.forEach(id => newHidden.delete(id));
      return {
        isolatedEntities: idsSet,
        hiddenEntities: newHidden,
      };
    }
  }),

  clearIsolation: () => set({ isolatedEntities: null }),

  showAll: () => set({ hiddenEntities: new Set(), isolatedEntities: null }),

  isEntityVisible: (id) => {
    const state = get();
    if (state.hiddenEntities.has(id)) return false;
    if (state.isolatedEntities !== null && !state.isolatedEntities.has(id)) return false;
    return true;
  },

  toggleTypeVisibility: (type) => set((state) => ({
    typeVisibility: {
      ...state.typeVisibility,
      [type]: !state.typeVisibility[type],
    },
  })),
});

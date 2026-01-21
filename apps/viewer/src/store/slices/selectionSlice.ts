/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Selection state slice
 */

import type { StateCreator } from 'zustand';

export interface SelectionSlice {
  // State
  selectedEntityId: number | null;
  selectedEntityIds: Set<number>;
  selectedStoreys: Set<number>;

  // Actions
  setSelectedEntityId: (id: number | null) => void;
  toggleStoreySelection: (id: number) => void;
  setStoreySelection: (id: number) => void;
  setStoreysSelection: (ids: number[]) => void;
  clearStoreySelection: () => void;
  addToSelection: (id: number) => void;
  removeFromSelection: (id: number) => void;
  toggleSelection: (id: number) => void;
  setSelectedEntityIds: (ids: number[]) => void;
  clearSelection: () => void;
}

export const createSelectionSlice: StateCreator<SelectionSlice, [], [], SelectionSlice> = (set) => ({
  // Initial state
  selectedEntityId: null,
  selectedEntityIds: new Set(),
  selectedStoreys: new Set(),

  // Actions
  setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),

  toggleStoreySelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedStoreys);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    return { selectedStoreys: newSelection };
  }),

  setStoreySelection: (id) => set((state) => {
    // If already the only selected storey, deselect it (toggle behavior)
    if (state.selectedStoreys.size === 1 && state.selectedStoreys.has(id)) {
      return { selectedStoreys: new Set() };
    }
    // Otherwise, select only this storey
    return { selectedStoreys: new Set([id]) };
  }),

  setStoreysSelection: (ids) => set({ selectedStoreys: new Set(ids) }),

  clearStoreySelection: () => set({ selectedStoreys: new Set() }),

  addToSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    newSelection.add(id);
    return { selectedEntityIds: newSelection, selectedEntityId: id };
  }),

  removeFromSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    newSelection.delete(id);
    const remaining = Array.from(newSelection);
    return {
      selectedEntityIds: newSelection,
      selectedEntityId: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    };
  }),

  toggleSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    const remaining = Array.from(newSelection);
    return {
      selectedEntityIds: newSelection,
      selectedEntityId: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    };
  }),

  setSelectedEntityIds: (ids) => set({
    selectedEntityIds: new Set(ids),
    selectedEntityId: ids.length > 0 ? ids[ids.length - 1] : null,
  }),

  clearSelection: () => set({
    selectedEntityIds: new Set(),
    selectedEntityId: null,
  }),
});

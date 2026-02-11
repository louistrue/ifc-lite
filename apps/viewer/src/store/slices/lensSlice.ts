/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens state slice
 *
 * Rule-based 3D filtering and coloring system.
 * Types, constants, presets, and evaluation logic live in @ifc-lite/lens.
 * This slice manages Zustand state, CRUD actions, and localStorage persistence.
 */

import type { StateCreator } from 'zustand';
import type { Lens, LensRule, LensCriteria } from '@ifc-lite/lens';
import { BUILTIN_LENSES } from '@ifc-lite/lens';

// Re-export types so existing consumer imports from this file still work
export type { Lens, LensRule, LensCriteria };

// Re-export constants for consumers that import from this file
export { COMMON_IFC_TYPES, LENS_PALETTE } from '@ifc-lite/lens';

/** localStorage key for persisting custom lenses */
const STORAGE_KEY = 'ifc-lite-custom-lenses';

/** Load user-created lenses from localStorage */
function loadCustomLenses(): Lens[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Lens[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(l => l.id && l.name && Array.isArray(l.rules));
  } catch {
    return [];
  }
}

/** Persist custom (non-builtin) lenses to localStorage */
function saveCustomLenses(lenses: Lens[]): void {
  try {
    const custom = lenses.filter(l => !l.builtin);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export interface LensSlice {
  // State
  savedLenses: Lens[];
  activeLensId: string | null;
  lensPanelVisible: boolean;
  /** Computed: globalId → hex color for entities matched by active lens */
  lensColorMap: Map<number, string>;
  /** Computed: globalIds to hide via lens rules */
  lensHiddenIds: Set<number>;
  /** Computed: ruleId → matched entity count for the active lens */
  lensRuleCounts: Map<string, number>;

  // Actions
  createLens: (lens: Lens) => void;
  updateLens: (id: string, patch: Partial<Lens>) => void;
  deleteLens: (id: string) => void;
  setActiveLens: (id: string | null) => void;
  toggleLensPanel: () => void;
  setLensPanelVisible: (visible: boolean) => void;
  setLensColorMap: (map: Map<number, string>) => void;
  setLensHiddenIds: (ids: Set<number>) => void;
  setLensRuleCounts: (counts: Map<string, number>) => void;
  /** Get the active lens configuration */
  getActiveLens: () => Lens | null;
  /** Import lenses from parsed JSON array */
  importLenses: (lenses: Lens[]) => void;
  /** Export all lenses (builtins + custom) as serializable array */
  exportLenses: () => Lens[];
}

export const createLensSlice: StateCreator<LensSlice, [], [], LensSlice> = (set, get) => ({
  // Initial state — builtins + any previously saved custom lenses
  savedLenses: [...BUILTIN_LENSES, ...loadCustomLenses()],
  activeLensId: null,
  lensPanelVisible: false,
  lensColorMap: new Map(),
  lensHiddenIds: new Set(),
  lensRuleCounts: new Map(),

  // Actions
  createLens: (lens) => set((state) => {
    const next = [...state.savedLenses, lens];
    saveCustomLenses(next);
    return { savedLenses: next };
  }),

  updateLens: (id, patch) => set((state) => {
    const next = state.savedLenses.map(l => l.id === id ? { ...l, ...patch } : l);
    saveCustomLenses(next);
    return { savedLenses: next };
  }),

  deleteLens: (id) => set((state) => {
    const lens = state.savedLenses.find(l => l.id === id);
    if (lens?.builtin) return {};
    const next = state.savedLenses.filter(l => l.id !== id);
    saveCustomLenses(next);
    return {
      savedLenses: next,
      activeLensId: state.activeLensId === id ? null : state.activeLensId,
    };
  }),

  setActiveLens: (activeLensId) => set({ activeLensId }),

  toggleLensPanel: () => set((state) => ({ lensPanelVisible: !state.lensPanelVisible })),
  setLensPanelVisible: (lensPanelVisible) => set({ lensPanelVisible }),

  setLensColorMap: (lensColorMap) => set({ lensColorMap }),
  setLensHiddenIds: (lensHiddenIds) => set({ lensHiddenIds }),
  setLensRuleCounts: (lensRuleCounts) => set({ lensRuleCounts }),

  getActiveLens: () => {
    const { savedLenses, activeLensId } = get();
    return savedLenses.find(l => l.id === activeLensId) ?? null;
  },

  importLenses: (lenses) => set((state) => {
    // Merge: skip duplicates by id, strip builtin flag from imports
    const existingIds = new Set(state.savedLenses.map(l => l.id));
    const newLenses = lenses
      .filter(l => l.id && l.name && Array.isArray(l.rules) && !existingIds.has(l.id))
      .map(l => ({ ...l, builtin: false }));
    const next = [...state.savedLenses, ...newLenses];
    saveCustomLenses(next);
    return { savedLenses: next };
  }),

  exportLenses: () => {
    return get().savedLenses.map(({ id, name, rules }) => ({ id, name, rules }));
  },
});

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
export { COMMON_IFC_CLASSES, COMMON_IFC_TYPES, LENS_PALETTE } from '@ifc-lite/lens';

/** localStorage key for persisting custom lenses */
const STORAGE_KEY = 'ifc-lite-custom-lenses';

/** Built-in lens IDs — used to detect overrides */
const BUILTIN_IDS = new Set(BUILTIN_LENSES.map(l => l.id));

/**
 * Load saved lenses from localStorage.
 * Returns both custom lenses and built-in overrides (user edits to builtin lenses).
 * Built-in overrides replace the default builtin when merging in initial state.
 */
function loadSavedLenses(): { custom: Lens[]; builtinOverrides: Map<string, Lens> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { custom: [], builtinOverrides: new Map() };
    const parsed = JSON.parse(raw) as Lens[];
    if (!Array.isArray(parsed)) return { custom: [], builtinOverrides: new Map() };
    const valid = parsed.filter(l => l.id && l.name && Array.isArray(l.rules));
    const builtinOverrides = new Map<string, Lens>();
    const custom: Lens[] = [];
    for (const l of valid) {
      if (BUILTIN_IDS.has(l.id)) {
        builtinOverrides.set(l.id, { ...l, builtin: true });
      } else {
        custom.push(l);
      }
    }
    return { custom, builtinOverrides };
  } catch {
    return { custom: [], builtinOverrides: new Map() };
  }
}

/**
 * Persist lenses to localStorage.
 * Saves custom lenses + any built-in lenses the user has edited (overrides).
 */
function saveLenses(lenses: Lens[]): void {
  try {
    // Save non-builtin custom lenses
    const custom = lenses.filter(l => !l.builtin);
    // Also save built-in lenses that differ from their defaults (user overrides)
    const builtinOverrides = lenses.filter(l => {
      if (!l.builtin) return false;
      const original = BUILTIN_LENSES.find(b => b.id === l.id);
      if (!original) return false;
      // Quick check: has the user changed the rules or name?
      return l.name !== original.name ||
        JSON.stringify(l.rules) !== JSON.stringify(original.rules);
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...custom, ...builtinOverrides]));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

/** Build initial lens list: builtins (with overrides applied) + custom */
function buildInitialLenses(): Lens[] {
  const { custom, builtinOverrides } = loadSavedLenses();
  const builtins = BUILTIN_LENSES.map(l =>
    builtinOverrides.has(l.id) ? builtinOverrides.get(l.id)! : { ...l },
  );
  return [...builtins, ...custom];
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
  /** Computed: ruleId → matched entity global IDs for the active lens */
  lensRuleEntityIds: Map<string, number[]>;

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
  setLensRuleEntityIds: (ids: Map<string, number[]>) => void;
  /** Get the active lens configuration */
  getActiveLens: () => Lens | null;
  /** Import lenses from parsed JSON array */
  importLenses: (lenses: Lens[]) => void;
  /** Export all lenses (builtins + custom) as serializable array */
  exportLenses: () => Lens[];
}

export const createLensSlice: StateCreator<LensSlice, [], [], LensSlice> = (set, get) => ({
  // Initial state — builtins (with user overrides applied) + custom lenses
  savedLenses: buildInitialLenses(),
  activeLensId: null,
  lensPanelVisible: false,
  lensColorMap: new Map(),
  lensHiddenIds: new Set(),
  lensRuleCounts: new Map(),
  lensRuleEntityIds: new Map(),

  // Actions
  createLens: (lens) => set((state) => {
    const next = [...state.savedLenses, lens];
    saveLenses(next);
    return { savedLenses: next };
  }),

  updateLens: (id, patch) => set((state) => {
    const next = state.savedLenses.map(l => l.id === id ? { ...l, ...patch } : l);
    saveLenses(next);
    return { savedLenses: next };
  }),

  deleteLens: (id) => set((state) => {
    const lens = state.savedLenses.find(l => l.id === id);
    if (lens?.builtin) return {};
    const next = state.savedLenses.filter(l => l.id !== id);
    saveLenses(next);
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
  setLensRuleEntityIds: (lensRuleEntityIds) => set({ lensRuleEntityIds }),

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
    saveLenses(next);
    return { savedLenses: next };
  }),

  exportLenses: () => {
    return get().savedLenses.map(({ id, name, rules }) => ({ id, name, rules }));
  },
});

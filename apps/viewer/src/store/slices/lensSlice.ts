/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens state slice
 *
 * Rule-based 3D filtering and coloring system.
 * Users define rules matching IFC type/property/material criteria,
 * and entities are colorized, hidden, or made transparent accordingly.
 * Unmatched entities are ghosted (semi-transparent) for context.
 */

import type { StateCreator } from 'zustand';

/** Criteria for matching entities */
export interface LensCriteria {
  type: 'ifcType' | 'property' | 'material';
  /** IFC type name (e.g., 'IfcWall') - used when type === 'ifcType' */
  ifcType?: string;
  /** Property set name (e.g., 'Pset_WallCommon') - used when type === 'property' */
  propertySet?: string;
  /** Property name (e.g., 'IsExternal') - used when type === 'property' */
  propertyName?: string;
  /** Comparison operator for property value */
  operator?: 'equals' | 'contains' | 'exists';
  /** Property value to compare against */
  propertyValue?: string;
  /** Material name pattern - used when type === 'material' */
  materialName?: string;
}

/** A single rule within a Lens */
export interface LensRule {
  id: string;
  name: string;
  enabled: boolean;
  criteria: LensCriteria;
  action: 'colorize' | 'hide' | 'transparent';
  /** Hex color for colorize action */
  color: string;
}

/** A saved Lens configuration */
export interface Lens {
  id: string;
  name: string;
  rules: LensRule[];
  /** Built-in presets cannot be deleted */
  builtin?: boolean;
  /** Auto-color mode: color entities by distinct property values */
  autoColorProperty?: {
    propertySetName: string;
    propertyName: string;
  };
}

/** Common IFC types for the lens rule editor */
export const COMMON_IFC_TYPES = [
  'IfcWall', 'IfcWallStandardCase',
  'IfcSlab', 'IfcSlabStandardCase',
  'IfcColumn', 'IfcColumnStandardCase',
  'IfcBeam', 'IfcBeamStandardCase',
  'IfcDoor', 'IfcWindow',
  'IfcStairFlight', 'IfcStair',
  'IfcRoof', 'IfcRamp', 'IfcRampFlight',
  'IfcRailing', 'IfcCovering',
  'IfcCurtainWall', 'IfcPlate',
  'IfcFooting', 'IfcPile',
  'IfcMember', 'IfcBuildingElementProxy',
  'IfcFurnishingElement', 'IfcSpace',
  'IfcFlowSegment', 'IfcFlowTerminal', 'IfcFlowFitting',
  'IfcDistributionElement',
  'IfcOpeningElement',
] as const;

/** Preset colors for new lens rules — high contrast, perceptually distinct */
export const LENS_PALETTE = [
  '#E53935', '#1E88E5', '#FDD835', '#43A047',
  '#8E24AA', '#00ACC1', '#FF8F00', '#6D4C41',
  '#EC407A', '#5C6BC0', '#26A69A', '#78909C',
] as const;

/** Built-in Lens presets */
const BUILTIN_LENSES: Lens[] = [
  {
    id: 'lens-by-type',
    name: 'By IFC Type',
    builtin: true,
    rules: [
      { id: 'wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#8D6E63' },
      { id: 'slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#607D8B' },
      { id: 'column', name: 'Columns', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcColumn' }, action: 'colorize', color: '#E53935' },
      { id: 'beam', name: 'Beams', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcBeam' }, action: 'colorize', color: '#1E88E5' },
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#00897B' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#42A5F5' },
      { id: 'stair', name: 'Stairs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcStairFlight' }, action: 'colorize', color: '#FF8F00' },
      { id: 'roof', name: 'Roofs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRoof' }, action: 'colorize', color: '#8E24AA' },
    ],
  },
  {
    id: 'lens-structural',
    name: 'Structural',
    builtin: true,
    rules: [
      { id: 'col', name: 'Columns', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcColumn' }, action: 'colorize', color: '#E53935' },
      { id: 'beam', name: 'Beams', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcBeam' }, action: 'colorize', color: '#1E88E5' },
      { id: 'slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#FDD835' },
      { id: 'footing', name: 'Footings', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcFooting' }, action: 'colorize', color: '#43A047' },
    ],
  },
  {
    id: 'lens-envelope',
    name: 'Building Envelope',
    builtin: true,
    rules: [
      { id: 'roof', name: 'Roofs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRoof' }, action: 'colorize', color: '#C62828' },
      { id: 'curtwall', name: 'Curtain Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcCurtainWall' }, action: 'colorize', color: '#0277BD' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#4FC3F7' },
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#00695C' },
      { id: 'wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#8D6E63' },
    ],
  },
  {
    id: 'lens-openings',
    name: 'Openings & Circulation',
    builtin: true,
    rules: [
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#00897B' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#42A5F5' },
      { id: 'stair', name: 'Stairs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcStairFlight' }, action: 'colorize', color: '#FF8F00' },
      { id: 'ramp', name: 'Ramps', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRamp' }, action: 'colorize', color: '#7CB342' },
      { id: 'railing', name: 'Railings', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRailing' }, action: 'colorize', color: '#78909C' },
    ],
  },
];

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

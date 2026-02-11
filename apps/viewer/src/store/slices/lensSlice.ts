/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens state slice
 *
 * Rule-based 3D filtering and coloring system.
 * Users define rules matching IFC type/property/material criteria,
 * and entities are colorized, hidden, or made transparent accordingly.
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
  /** Auto-color mode: color entities by distinct property values */
  autoColorProperty?: {
    propertySetName: string;
    propertyName: string;
  };
}

/** Built-in Lens presets */
const BUILTIN_LENSES: Lens[] = [
  {
    id: 'lens-by-type',
    name: 'By IFC Type',
    rules: [
      { id: 'wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#8B7355' },
      { id: 'slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#A0A0A0' },
      { id: 'column', name: 'Columns', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcColumn' }, action: 'colorize', color: '#CD853F' },
      { id: 'beam', name: 'Beams', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcBeam' }, action: 'colorize', color: '#B8860B' },
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#4682B4' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#87CEEB' },
      { id: 'stair', name: 'Stairs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcStairFlight' }, action: 'colorize', color: '#DEB887' },
      { id: 'roof', name: 'Roofs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRoof' }, action: 'colorize', color: '#CC4444' },
    ],
  },
  {
    id: 'lens-structural',
    name: 'Structural Elements',
    rules: [
      { id: 'col', name: 'Columns', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcColumn' }, action: 'colorize', color: '#FF4444' },
      { id: 'beam', name: 'Beams', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcBeam' }, action: 'colorize', color: '#FF8800' },
      { id: 'slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#FFCC00' },
      { id: 'footing', name: 'Footings', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcFooting' }, action: 'colorize', color: '#88CC44' },
      { id: 'wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'transparent', color: '#CCCCCC' },
    ],
  },
];

export interface LensSlice {
  // State
  savedLenses: Lens[];
  activeLensId: string | null;
  lensPanelVisible: boolean;
  /** Computed: globalId → hex color for entities matched by active lens */
  lensColorMap: Map<number, string>;
  /** Computed: globalIds to hide via lens rules */
  lensHiddenIds: Set<number>;

  // Actions
  createLens: (lens: Lens) => void;
  updateLens: (id: string, patch: Partial<Lens>) => void;
  deleteLens: (id: string) => void;
  setActiveLens: (id: string | null) => void;
  toggleLensPanel: () => void;
  setLensColorMap: (map: Map<number, string>) => void;
  setLensHiddenIds: (ids: Set<number>) => void;
  /** Get the active lens configuration */
  getActiveLens: () => Lens | null;
}

export const createLensSlice: StateCreator<LensSlice, [], [], LensSlice> = (set, get) => ({
  // Initial state
  savedLenses: [...BUILTIN_LENSES],
  activeLensId: null,
  lensPanelVisible: false,
  lensColorMap: new Map(),
  lensHiddenIds: new Set(),

  // Actions
  createLens: (lens) => set((state) => ({
    savedLenses: [...state.savedLenses, lens],
  })),

  updateLens: (id, patch) => set((state) => ({
    savedLenses: state.savedLenses.map(l => l.id === id ? { ...l, ...patch } : l),
  })),

  deleteLens: (id) => set((state) => ({
    savedLenses: state.savedLenses.filter(l => l.id !== id),
    activeLensId: state.activeLensId === id ? null : state.activeLensId,
  })),

  setActiveLens: (activeLensId) => set({ activeLensId }),

  toggleLensPanel: () => set((state) => ({ lensPanelVisible: !state.lensPanelVisible })),

  setLensColorMap: (lensColorMap) => set({ lensColorMap }),
  setLensHiddenIds: (lensHiddenIds) => set({ lensHiddenIds }),

  getActiveLens: () => {
    const { savedLenses, activeLensId } = get();
    return savedLenses.find(l => l.id === activeLensId) ?? null;
  },
});

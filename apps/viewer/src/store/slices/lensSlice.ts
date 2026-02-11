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

/** Preset colors for new lens rules */
export const LENS_PALETTE = [
  '#FF4444', '#FF8800', '#FFCC00', '#88CC44',
  '#44BB88', '#4488CC', '#6644CC', '#CC44AA',
  '#8B7355', '#A0A0A0', '#CD853F', '#87CEEB',
] as const;

/** Built-in Lens presets */
const BUILTIN_LENSES: Lens[] = [
  {
    id: 'lens-by-type',
    name: 'By IFC Type',
    builtin: true,
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
    name: 'Structural',
    builtin: true,
    rules: [
      { id: 'col', name: 'Columns', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcColumn' }, action: 'colorize', color: '#FF4444' },
      { id: 'beam', name: 'Beams', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcBeam' }, action: 'colorize', color: '#FF8800' },
      { id: 'slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#FFCC00' },
      { id: 'footing', name: 'Footings', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcFooting' }, action: 'colorize', color: '#88CC44' },
    ],
  },
  {
    id: 'lens-envelope',
    name: 'Building Envelope',
    builtin: true,
    rules: [
      { id: 'roof', name: 'Roofs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRoof' }, action: 'colorize', color: '#CC4444' },
      { id: 'curtwall', name: 'Curtain Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcCurtainWall' }, action: 'colorize', color: '#4488CC' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#87CEEB' },
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#4682B4' },
      { id: 'wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#D4A76A' },
    ],
  },
  {
    id: 'lens-openings',
    name: 'Openings & Circulation',
    builtin: true,
    rules: [
      { id: 'door', name: 'Doors', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcDoor' }, action: 'colorize', color: '#4682B4' },
      { id: 'window', name: 'Windows', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWindow' }, action: 'colorize', color: '#87CEEB' },
      { id: 'stair', name: 'Stairs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcStairFlight' }, action: 'colorize', color: '#DEB887' },
      { id: 'ramp', name: 'Ramps', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRamp' }, action: 'colorize', color: '#A0D468' },
      { id: 'railing', name: 'Railings', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcRailing' }, action: 'colorize', color: '#888888' },
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
  setLensPanelVisible: (visible: boolean) => void;
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

  deleteLens: (id) => set((state) => {
    const lens = state.savedLenses.find(l => l.id === id);
    if (lens?.builtin) return {};
    return {
      savedLenses: state.savedLenses.filter(l => l.id !== id),
      activeLensId: state.activeLensId === id ? null : state.activeLensId,
    };
  }),

  setActiveLens: (activeLensId) => set({ activeLensId }),

  toggleLensPanel: () => set((state) => ({ lensPanelVisible: !state.lensPanelVisible })),
  setLensPanelVisible: (lensPanelVisible) => set({ lensPanelVisible }),

  setLensColorMap: (lensColorMap) => set({ lensColorMap }),
  setLensHiddenIds: (lensHiddenIds) => set({ lensHiddenIds }),

  getActiveLens: () => {
    const { savedLenses, activeLensId } = get();
    return savedLenses.find(l => l.id === activeLensId) ?? null;
  },
});

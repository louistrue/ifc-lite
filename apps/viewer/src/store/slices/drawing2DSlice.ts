/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 2D Drawing generation state slice
 *
 * Manages state for generating and viewing 2D architectural drawings
 * (floor plans, sections, elevations) from the 3D model.
 */

import type { StateCreator } from 'zustand';
import type { Drawing2D, GraphicOverrideRule, GraphicOverridePreset } from '@ifc-lite/drawing-2d';
import { BUILT_IN_PRESETS } from '@ifc-lite/drawing-2d';

export type Drawing2DStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface Drawing2DState {
  /** Current drawing data (null when not generated) */
  drawing2D: Drawing2D | null;
  /** Generation status */
  drawing2DStatus: Drawing2DStatus;
  /** Generation progress (0-100) */
  drawing2DProgress: number;
  /** Progress phase description */
  drawing2DPhase: string;
  /** Error message if generation failed */
  drawing2DError: string | null;
  /** Whether the 2D panel is visible */
  drawing2DPanelVisible: boolean;
  /** SVG content for export (cached) */
  drawing2DSvgContent: string | null;
  /** Display options */
  drawing2DDisplayOptions: {
    showHiddenLines: boolean;
    showHatching: boolean;
    showAnnotations: boolean;
    show3DOverlay: boolean;
    scale: number;
  };
  /** Available graphic override presets */
  graphicOverridePresets: GraphicOverridePreset[];
  /** Currently active preset ID (null = no preset) */
  activePresetId: string | null;
  /** Custom user-defined override rules */
  customOverrideRules: GraphicOverrideRule[];
  /** Whether to apply graphic overrides */
  overridesEnabled: boolean;
  /** Panel visibility for override editor */
  overridesPanelVisible: boolean;
}

export interface Drawing2DSlice extends Drawing2DState {
  // Drawing Actions
  setDrawing2D: (drawing: Drawing2D | null) => void;
  setDrawing2DStatus: (status: Drawing2DStatus) => void;
  setDrawing2DProgress: (progress: number, phase: string) => void;
  setDrawing2DError: (error: string | null) => void;
  setDrawing2DPanelVisible: (visible: boolean) => void;
  toggleDrawing2DPanel: () => void;
  setDrawing2DSvgContent: (svg: string | null) => void;
  updateDrawing2DDisplayOptions: (options: Partial<Drawing2DState['drawing2DDisplayOptions']>) => void;
  clearDrawing2D: () => void;

  // Graphic Override Actions
  setActivePreset: (presetId: string | null) => void;
  addCustomRule: (rule: GraphicOverrideRule) => void;
  updateCustomRule: (ruleId: string, updates: Partial<GraphicOverrideRule>) => void;
  removeCustomRule: (ruleId: string) => void;
  clearCustomRules: () => void;
  setOverridesEnabled: (enabled: boolean) => void;
  toggleOverridesEnabled: () => void;
  setOverridesPanelVisible: (visible: boolean) => void;
  toggleOverridesPanel: () => void;
  /** Get all active rules (preset + custom) sorted by priority */
  getActiveOverrideRules: () => GraphicOverrideRule[];
}

const getDefaultDisplayOptions = (): Drawing2DState['drawing2DDisplayOptions'] => ({
  showHiddenLines: true,
  showHatching: true,
  showAnnotations: true,
  show3DOverlay: true, // Show 3D overlay by default
  scale: 100, // 1:100 default
});

const getDefaultState = (): Drawing2DState => ({
  drawing2D: null,
  drawing2DStatus: 'idle',
  drawing2DProgress: 0,
  drawing2DPhase: '',
  drawing2DError: null,
  drawing2DPanelVisible: false,
  drawing2DSvgContent: null,
  drawing2DDisplayOptions: getDefaultDisplayOptions(),
  // Graphic overrides
  graphicOverridePresets: BUILT_IN_PRESETS,
  activePresetId: 'preset-3d-colors', // Default to IFC Materials
  customOverrideRules: [],
  overridesEnabled: true,
  overridesPanelVisible: false,
});

export const createDrawing2DSlice: StateCreator<Drawing2DSlice, [], [], Drawing2DSlice> = (set, get) => ({
  // Initial state
  ...getDefaultState(),

  // Drawing Actions
  setDrawing2D: (drawing) => set({
    drawing2D: drawing,
    drawing2DStatus: drawing ? 'ready' : 'idle',
    drawing2DError: null,
  }),

  setDrawing2DStatus: (status) => set({ drawing2DStatus: status }),

  setDrawing2DProgress: (progress, phase) => set({
    drawing2DProgress: progress,
    drawing2DPhase: phase,
  }),

  setDrawing2DError: (error) => set({
    drawing2DError: error,
    drawing2DStatus: error ? 'error' : 'idle',
  }),

  setDrawing2DPanelVisible: (visible) => set({ drawing2DPanelVisible: visible }),

  toggleDrawing2DPanel: () => set((state) => ({ drawing2DPanelVisible: !state.drawing2DPanelVisible })),

  setDrawing2DSvgContent: (svg) => set({ drawing2DSvgContent: svg }),

  updateDrawing2DDisplayOptions: (options) => set((state) => ({
    drawing2DDisplayOptions: { ...state.drawing2DDisplayOptions, ...options },
  })),

  clearDrawing2D: () => set(getDefaultState()),

  // Graphic Override Actions
  setActivePreset: (presetId) => set({ activePresetId: presetId }),

  addCustomRule: (rule) => set((state) => ({
    customOverrideRules: [...state.customOverrideRules, rule],
  })),

  updateCustomRule: (ruleId, updates) => set((state) => ({
    customOverrideRules: state.customOverrideRules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...updates } : rule
    ),
  })),

  removeCustomRule: (ruleId) => set((state) => ({
    customOverrideRules: state.customOverrideRules.filter((rule) => rule.id !== ruleId),
  })),

  clearCustomRules: () => set({ customOverrideRules: [] }),

  setOverridesEnabled: (enabled) => set({ overridesEnabled: enabled }),

  toggleOverridesEnabled: () => set((state) => ({ overridesEnabled: !state.overridesEnabled })),

  setOverridesPanelVisible: (visible) => set({ overridesPanelVisible: visible }),

  toggleOverridesPanel: () => set((state) => ({ overridesPanelVisible: !state.overridesPanelVisible })),

  getActiveOverrideRules: () => {
    const state = get();
    if (!state.overridesEnabled) return [];

    const presetRules: GraphicOverrideRule[] = [];

    // Get rules from active preset
    if (state.activePresetId) {
      const preset = state.graphicOverridePresets.find((p) => p.id === state.activePresetId);
      if (preset) {
        presetRules.push(...preset.rules);
      }
    }

    // Combine with custom rules and sort by priority
    const allRules = [...presetRules, ...state.customOverrideRules];
    return allRules
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.priority - b.priority);
  },
});

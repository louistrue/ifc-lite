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

/** Point in 2D drawing coordinates */
export interface Point2D {
  x: number;
  y: number;
}

/** Measurement result */
export interface Measure2DResult {
  id: string;
  start: Point2D;
  end: Point2D;
  distance: number; // in drawing units (typically meters)
}

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
    /** Use authored symbolic representations (Plan/Annotation) when available instead of section cut */
    useSymbolicRepresentations: boolean;
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

  // 2D Measure Tool
  /** Whether measure mode is active */
  measure2DMode: boolean;
  /** Start point of current measurement (drawing coords) */
  measure2DStart: Point2D | null;
  /** Current/end point of measurement (drawing coords) */
  measure2DCurrent: Point2D | null;
  /** Whether shift is held for orthogonal constraint */
  measure2DShiftLocked: boolean;
  /** Axis locked to when shift is held ('x' | 'y' | null) */
  measure2DLockedAxis: 'x' | 'y' | null;
  /** Completed measurements */
  measure2DResults: Measure2DResult[];
  /** Current snap point (if snapping to geometry) */
  measure2DSnapPoint: Point2D | null;
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

  // 2D Measure Actions
  setMeasure2DMode: (enabled: boolean) => void;
  toggleMeasure2DMode: () => void;
  setMeasure2DStart: (point: Point2D | null) => void;
  setMeasure2DCurrent: (point: Point2D | null) => void;
  setMeasure2DShiftLocked: (locked: boolean, axis?: 'x' | 'y' | null) => void;
  addMeasure2DResult: (result: Measure2DResult) => void;
  removeMeasure2DResult: (id: string) => void;
  clearMeasure2DResults: () => void;
  setMeasure2DSnapPoint: (point: Point2D | null) => void;
  /** Complete current measurement and add to results */
  completeMeasure2D: () => void;
  /** Cancel current measurement */
  cancelMeasure2D: () => void;
}

const getDefaultDisplayOptions = (): Drawing2DState['drawing2DDisplayOptions'] => ({
  showHiddenLines: true,
  showHatching: true,
  showAnnotations: true,
  show3DOverlay: true, // Show 3D overlay by default
  scale: 100, // 1:100 default
  useSymbolicRepresentations: false, // Default to section cut (Body geometry)
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
  // 2D Measure
  measure2DMode: false,
  measure2DStart: null,
  measure2DCurrent: null,
  measure2DShiftLocked: false,
  measure2DLockedAxis: null,
  measure2DResults: [],
  measure2DSnapPoint: null,
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

  // 2D Measure Actions
  setMeasure2DMode: (enabled) => set({
    measure2DMode: enabled,
    // Clear measurement state when disabling
    ...(enabled ? {} : {
      measure2DStart: null,
      measure2DCurrent: null,
      measure2DShiftLocked: false,
      measure2DLockedAxis: null,
      measure2DSnapPoint: null,
    }),
  }),

  toggleMeasure2DMode: () => {
    const state = get();
    set({
      measure2DMode: !state.measure2DMode,
      // Clear measurement state when disabling
      ...(!state.measure2DMode ? {} : {
        measure2DStart: null,
        measure2DCurrent: null,
        measure2DShiftLocked: false,
        measure2DLockedAxis: null,
        measure2DSnapPoint: null,
      }),
    });
  },

  setMeasure2DStart: (point) => set({ measure2DStart: point }),

  setMeasure2DCurrent: (point) => set({ measure2DCurrent: point }),

  setMeasure2DShiftLocked: (locked, axis = null) => set({
    measure2DShiftLocked: locked,
    measure2DLockedAxis: locked ? axis : null,
  }),

  addMeasure2DResult: (result) => set((state) => ({
    measure2DResults: [...state.measure2DResults, result],
  })),

  removeMeasure2DResult: (id) => set((state) => ({
    measure2DResults: state.measure2DResults.filter((r) => r.id !== id),
  })),

  clearMeasure2DResults: () => set({ measure2DResults: [] }),

  setMeasure2DSnapPoint: (point) => set({ measure2DSnapPoint: point }),

  completeMeasure2D: () => {
    const state = get();
    if (state.measure2DStart && state.measure2DCurrent) {
      const start = state.measure2DStart;
      const end = state.measure2DCurrent;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Ignore zero-length measurements (click without drag)
      const MIN_MEASUREMENT_DISTANCE = 0.001; // 1mm minimum
      if (distance < MIN_MEASUREMENT_DISTANCE) {
        // Reset state without saving the measurement
        set({
          measure2DStart: null,
          measure2DCurrent: null,
          measure2DShiftLocked: false,
          measure2DLockedAxis: null,
          measure2DSnapPoint: null,
        });
        return;
      }

      const result: Measure2DResult = {
        id: `measure-${Date.now()}`,
        start,
        end,
        distance,
      };

      set({
        measure2DResults: [...state.measure2DResults, result],
        measure2DStart: null,
        measure2DCurrent: null,
        measure2DShiftLocked: false,
        measure2DLockedAxis: null,
        measure2DSnapPoint: null,
      });
    }
  },

  cancelMeasure2D: () => set({
    measure2DStart: null,
    measure2DCurrent: null,
    measure2DShiftLocked: false,
    measure2DLockedAxis: null,
    measure2DSnapPoint: null,
  }),
});

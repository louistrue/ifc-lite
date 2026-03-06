/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Views state slice — manages saved 2D/3D view definitions (floor plans,
 * sections, elevations) with per-view camera, cut, and drawing settings.
 */

import type { StateCreator } from 'zustand';
import type { SectionPlaneAxis } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type ViewType = 'floorplan' | 'section' | 'elevation';

export interface ViewCameraState {
  /** Named preset: top, front, back, left, right (null = free camera) */
  presetView: 'top' | 'front' | 'back' | 'left' | 'right' | null;
  projectionMode: 'orthographic' | 'perspective';
}

export interface ViewDefinition {
  id: string;
  name: string;
  type: ViewType;

  // Section plane
  sectionAxis: SectionPlaneAxis;
  /** Section cut position as 0–100 percentage of model bounds */
  sectionPosition: number;
  sectionEnabled: boolean;
  sectionFlipped: boolean;

  // IFC storey reference (floor plans only)
  storeyRef?: {
    expressId: number;
    modelId: string;
    /** Stored elevation in world units (m) for display */
    elevation: number;
  };

  // Camera
  camera: ViewCameraState;

  // Drawing/cut parameters (world units, m)
  /** Elevation of the section cut plane */
  cutElevation: number;
  /** Workplane elevation — base for 2D annotation coordinates */
  baseElevation: number;
  /** Geometry depth beyond cut showing as projection lines */
  viewDepth: number;

  // 2D drawing settings
  /** Scale denominator — 100 means 1:100 */
  scale: number;
  includeHiddenLines: boolean;

  /** Timestamp (ms) */
  createdAt: number;
}

// ─── Slice interface ───────────────────────────────────────────────────────

export interface ViewsSlice {
  views: Map<string, ViewDefinition>;
  /** ID of the currently active/displayed view (null = no active view) */
  activeViewId: string | null;
  viewsPanelVisible: boolean;

  addView: (view: ViewDefinition) => void;
  updateView: (id: string, updates: Partial<ViewDefinition>) => void;
  deleteView: (id: string) => void;
  setActiveViewId: (id: string | null) => void;
  setViewsPanelVisible: (visible: boolean) => void;
  toggleViewsPanel: () => void;
}

// ─── ID helper (module-level counter) ─────────────────────────────────────

let _counter = 1;
export function newViewId(): string {
  return `view-${Date.now()}-${_counter++}`;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createViewsSlice: StateCreator<ViewsSlice, [], [], ViewsSlice> = (set) => ({
  views: new Map(),
  activeViewId: null,
  viewsPanelVisible: false,

  addView: (view) =>
    set((s) => {
      const next = new Map(s.views);
      next.set(view.id, view);
      return { views: next };
    }),

  updateView: (id, updates) =>
    set((s) => {
      const existing = s.views.get(id);
      if (!existing) return {};
      const next = new Map(s.views);
      next.set(id, { ...existing, ...updates });
      return { views: next };
    }),

  deleteView: (id) =>
    set((s) => {
      const next = new Map(s.views);
      next.delete(id);
      return {
        views: next,
        activeViewId: s.activeViewId === id ? null : s.activeViewId,
      };
    }),

  setActiveViewId: (activeViewId) => set({ activeViewId }),
  setViewsPanelVisible: (viewsPanelVisible) => set({ viewsPanelVisible }),
  toggleViewsPanel: () => set((s) => ({ viewsPanelVisible: !s.viewsPanelVisible })),
});

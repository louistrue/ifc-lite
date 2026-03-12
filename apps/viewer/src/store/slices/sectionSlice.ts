/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane state slice
 *
 * Manages section cutting state for both axis-aligned and face-based sections.
 * Supports 3D gizmo interaction for dragging the section plane along its axis.
 */

import type { StateCreator } from 'zustand';
import type { SectionPlane, SectionPlaneAxis, SectionMode, SectionFace, SectionGizmoState } from '../types.js';
import { SECTION_PLANE_DEFAULTS } from '../constants.js';

export interface SectionSlice {
  // State
  sectionPlane: SectionPlane;

  // Axis-mode actions
  setSectionPlaneAxis: (axis: SectionPlaneAxis) => void;
  setSectionPlanePosition: (position: number) => void;
  toggleSectionPlane: () => void;
  flipSectionPlane: () => void;
  resetSectionPlane: () => void;

  // Mode switching
  setSectionMode: (mode: SectionMode) => void;

  // Face-based section actions
  setSectionFace: (face: SectionFace) => void;
  setSectionFaceOffset: (offset: number) => void;
  clearSectionFace: () => void;

  // Gizmo interaction
  startGizmoDrag: (screenY: number) => void;
  updateGizmoDrag: (screenY: number, sensitivity: number) => void;
  endGizmoDrag: () => void;
}

const getDefaultSectionPlane = (): SectionPlane => ({
  mode: SECTION_PLANE_DEFAULTS.MODE,
  axis: SECTION_PLANE_DEFAULTS.AXIS,
  position: SECTION_PLANE_DEFAULTS.POSITION,
  enabled: SECTION_PLANE_DEFAULTS.ENABLED,
  flipped: SECTION_PLANE_DEFAULTS.FLIPPED,
  face: SECTION_PLANE_DEFAULTS.FACE,
  gizmo: { ...SECTION_PLANE_DEFAULTS.GIZMO },
});

/** Clamp a value to [0, 100] */
const clampPosition = (value: number): number =>
  Math.min(100, Math.max(0, Number(value) || 0));

export const createSectionSlice: StateCreator<SectionSlice, [], [], SectionSlice> = (set) => ({
  // Initial state
  sectionPlane: getDefaultSectionPlane(),

  // --- Axis-mode actions ---

  setSectionPlaneAxis: (axis) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, axis, mode: 'axis' },
  })),

  setSectionPlanePosition: (position) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, position: clampPosition(position) },
  })),

  toggleSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, enabled: !state.sectionPlane.enabled },
  })),

  flipSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, flipped: !state.sectionPlane.flipped },
  })),

  resetSectionPlane: () => set({ sectionPlane: getDefaultSectionPlane() }),

  // --- Mode switching ---

  setSectionMode: (mode) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, mode },
  })),

  // --- Face-based section actions ---

  setSectionFace: (face) => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      mode: 'face',
      face,
      enabled: true,
    },
  })),

  setSectionFaceOffset: (offset) => set((state) => {
    if (!state.sectionPlane.face) return state;
    return {
      sectionPlane: {
        ...state.sectionPlane,
        face: { ...state.sectionPlane.face, offset },
      },
    };
  }),

  clearSectionFace: () => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      mode: 'axis',
      face: null,
    },
  })),

  // --- Gizmo interaction ---

  startGizmoDrag: (screenY) => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      gizmo: {
        dragging: true,
        startScreenY: screenY,
        startPosition: state.sectionPlane.mode === 'face'
          ? (state.sectionPlane.face?.offset ?? 0)
          : state.sectionPlane.position,
      },
    },
  })),

  updateGizmoDrag: (screenY, sensitivity) => set((state) => {
    const { gizmo } = state.sectionPlane;
    if (!gizmo.dragging) return state;

    const delta = (gizmo.startScreenY - screenY) * sensitivity;

    if (state.sectionPlane.mode === 'face' && state.sectionPlane.face) {
      // Face mode: offset in world units
      return {
        sectionPlane: {
          ...state.sectionPlane,
          face: {
            ...state.sectionPlane.face,
            offset: gizmo.startPosition + delta,
          },
        },
      };
    }

    // Axis mode: offset in percentage [0, 100]
    return {
      sectionPlane: {
        ...state.sectionPlane,
        position: clampPosition(gizmo.startPosition + delta),
      },
    };
  }),

  endGizmoDrag: () => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      gizmo: { dragging: false, startScreenY: 0, startPosition: 0 },
    },
  })),
});

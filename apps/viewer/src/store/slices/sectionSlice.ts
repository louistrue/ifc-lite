/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane state slice
 */

import type { StateCreator } from 'zustand';
import type { SectionPlane, SectionPlaneAxis, SectionPlaneMode, SectionPlaneNormal } from '../types.js';
import { SECTION_PLANE_DEFAULTS } from '../constants.js';

export interface SectionSlice {
  // State
  sectionPlane: SectionPlane;

  // Actions
  setSectionPlaneMode: (mode: SectionPlaneMode) => void;
  setSectionPlaneAxis: (axis: SectionPlaneAxis) => void;
  setSectionPlanePosition: (position: number) => void;
  setSectionPlaneFromSurface: (normal: SectionPlaneNormal, position: number) => void;
  toggleSectionPlane: () => void;
  flipSectionPlane: () => void;
  resetSectionPlane: () => void;
}

const getDefaultSectionPlane = (): SectionPlane => ({
  mode: SECTION_PLANE_DEFAULTS.MODE,
  axis: SECTION_PLANE_DEFAULTS.AXIS,
  position: SECTION_PLANE_DEFAULTS.POSITION,
  enabled: SECTION_PLANE_DEFAULTS.ENABLED,
  flipped: SECTION_PLANE_DEFAULTS.FLIPPED,
  customNormal: null,
});

export const createSectionSlice: StateCreator<SectionSlice, [], [], SectionSlice> = (set) => ({
  // Initial state
  sectionPlane: getDefaultSectionPlane(),

  // Actions
  setSectionPlaneMode: (mode) => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      mode,
      customNormal: mode === 'axis' ? null : state.sectionPlane.customNormal,
    },
  })),

  setSectionPlaneAxis: (axis) => set((state) => ({
    sectionPlane: {
      ...state.sectionPlane,
      mode: 'axis',
      axis,
      customNormal: null,
    },
  })),

  setSectionPlanePosition: (position) => set((state) => {
    // Clamp position to valid range [0, 100]
    const clampedPosition = Math.min(100, Math.max(0, Number(position) || 0));
    return {
      sectionPlane: { ...state.sectionPlane, position: clampedPosition },
    };
  }),

  setSectionPlaneFromSurface: (normal, position) => set((state) => {
    const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    if (len < 0.000001) {
      return { sectionPlane: state.sectionPlane };
    }

    const clampedPosition = Math.min(100, Math.max(0, Number(position) || 0));

    return {
      sectionPlane: {
        ...state.sectionPlane,
        mode: 'surface',
        position: clampedPosition,
        customNormal: {
          x: normal.x / len,
          y: normal.y / len,
          z: normal.z / len,
        },
      },
    };
  }),

  toggleSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, enabled: !state.sectionPlane.enabled },
  })),

  flipSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, flipped: !state.sectionPlane.flipped },
  })),

  resetSectionPlane: () => set({ sectionPlane: getDefaultSectionPlane() }),
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane state slice
 */

import type { StateCreator } from 'zustand';
import type { SectionPlane, SectionPlaneAxis, SectionMode, FaceSectionPlane, FaceSectionHover, Vec3 } from '../types.js';
import { SECTION_PLANE_DEFAULTS, FACE_SECTION_OFFSET } from '../constants.js';

export interface SectionSlice {
  // State
  sectionPlane: SectionPlane;
  /** Current section mode: axis-aligned or face-pick */
  sectionMode: SectionMode;
  /** Face-picked section plane (independent from axis-aligned) */
  faceSectionPlane: FaceSectionPlane | null;
  /** Hover preview for face section mode */
  faceSectionHover: FaceSectionHover | null;
  /** Whether the user is dragging the face section plane */
  faceSectionDragging: boolean;

  // Actions
  setSectionPlaneAxis: (axis: SectionPlaneAxis) => void;
  setSectionPlanePosition: (position: number) => void;
  toggleSectionPlane: () => void;
  flipSectionPlane: () => void;
  resetSectionPlane: () => void;
  /** Set section mode (down/front/side/face) */
  setSectionMode: (mode: SectionMode) => void;
  /** Set face section hover preview */
  setFaceSectionHover: (hover: FaceSectionHover | null) => void;
  /** Confirm face section cut at the given face */
  confirmFaceSection: (normal: Vec3, point: Vec3) => void;
  /** Clear face section */
  clearFaceSection: () => void;
  /** Toggle face section enabled state */
  toggleFaceSection: () => void;
  /** Update face section distance (for drag-to-move) */
  updateFaceSectionDistance: (distance: number) => void;
  /** Set face section dragging state */
  setFaceSectionDragging: (dragging: boolean) => void;
}

const getDefaultSectionPlane = (): SectionPlane => ({
  axis: SECTION_PLANE_DEFAULTS.AXIS,
  position: SECTION_PLANE_DEFAULTS.POSITION,
  enabled: SECTION_PLANE_DEFAULTS.ENABLED,
  flipped: SECTION_PLANE_DEFAULTS.FLIPPED,
});

export const createSectionSlice: StateCreator<SectionSlice, [], [], SectionSlice> = (set) => ({
  // Initial state
  sectionPlane: getDefaultSectionPlane(),
  sectionMode: SECTION_PLANE_DEFAULTS.MODE,
  faceSectionPlane: null,
  faceSectionHover: null,
  faceSectionDragging: false,

  // Actions
  setSectionPlaneAxis: (axis) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, axis },
    sectionMode: axis,
  })),

  setSectionPlanePosition: (position) => set((state) => {
    // Clamp position to valid range [0, 100]
    const clampedPosition = Math.min(100, Math.max(0, Number(position) || 0));
    return {
      sectionPlane: { ...state.sectionPlane, position: clampedPosition },
    };
  }),

  toggleSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, enabled: !state.sectionPlane.enabled },
  })),

  flipSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, flipped: !state.sectionPlane.flipped },
  })),

  resetSectionPlane: () => set({
    sectionPlane: getDefaultSectionPlane(),
    sectionMode: SECTION_PLANE_DEFAULTS.MODE,
    faceSectionPlane: null,
    faceSectionHover: null,
    faceSectionDragging: false,
  }),

  setSectionMode: (mode) => set({ sectionMode: mode }),

  setFaceSectionHover: (hover) => set({ faceSectionHover: hover }),

  confirmFaceSection: (normal, point) => {
    // Compute signed distance from origin with 0.1mm offset
    const dot = normal.x * point.x + normal.y * point.y + normal.z * point.z;
    const distance = dot + FACE_SECTION_OFFSET;
    set({
      faceSectionPlane: {
        normal,
        point,
        distance,
        enabled: true,
        confirmed: true,
      },
      faceSectionHover: null,
    });
  },

  clearFaceSection: () => set({
    faceSectionPlane: null,
    faceSectionHover: null,
    faceSectionDragging: false,
  }),

  toggleFaceSection: () => set((state) => {
    if (!state.faceSectionPlane) return {};
    return {
      faceSectionPlane: {
        ...state.faceSectionPlane,
        enabled: !state.faceSectionPlane.enabled,
      },
    };
  }),

  updateFaceSectionDistance: (distance) => set((state) => {
    if (!state.faceSectionPlane) return {};
    return {
      faceSectionPlane: {
        ...state.faceSectionPlane,
        distance,
        // Update the point to match the new distance
        point: {
          x: state.faceSectionPlane.normal.x * distance,
          y: state.faceSectionPlane.normal.y * distance,
          z: state.faceSectionPlane.normal.z * distance,
        },
      },
    };
  }),

  setFaceSectionDragging: (dragging) => set({ faceSectionDragging: dragging }),
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera state slice
 */

import type { StateCreator } from 'zustand';
import type { CameraRotation, CameraCallbacks } from '../types.js';
import { CAMERA_DEFAULTS } from '../constants.js';

export interface CameraSlice {
  // State
  cameraRotation: CameraRotation;
  cameraCallbacks: CameraCallbacks;
  onCameraRotationChange: ((rotation: CameraRotation) => void) | null;
  onScaleChange: ((scale: number) => void) | null;

  // Actions
  setCameraRotation: (rotation: CameraRotation) => void;
  setCameraCallbacks: (callbacks: CameraCallbacks) => void;
  setOnCameraRotationChange: (callback: ((rotation: CameraRotation) => void) | null) => void;
  updateCameraRotationRealtime: (rotation: CameraRotation) => void;
  setOnScaleChange: (callback: ((scale: number) => void) | null) => void;
  updateScaleRealtime: (scale: number) => void;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set, get) => ({
  // Initial state
  cameraRotation: {
    azimuth: CAMERA_DEFAULTS.AZIMUTH,
    elevation: CAMERA_DEFAULTS.ELEVATION,
  },
  cameraCallbacks: {},
  onCameraRotationChange: null,
  onScaleChange: null,

  // Actions
  setCameraRotation: (cameraRotation) => set({ cameraRotation }),
  setCameraCallbacks: (cameraCallbacks) => set({ cameraCallbacks }),
  setOnCameraRotationChange: (onCameraRotationChange) => set({ onCameraRotationChange }),

  updateCameraRotationRealtime: (rotation) => {
    const callback = get().onCameraRotationChange;
    if (callback) {
      // Use direct callback - no React state update, no re-renders
      callback(rotation);
    }
    // Don't update store state during real-time updates
  },

  setOnScaleChange: (onScaleChange) => set({ onScaleChange }),

  updateScaleRealtime: (scale) => {
    const callback = get().onScaleChange;
    if (callback) {
      // Use direct callback - no React state update, no re-renders
      callback(scale);
    }
    // Don't update store state during real-time updates
  },
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data state slice (IFC data and geometry)
 */

import type { StateCreator } from 'zustand';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, CoordinateInfo } from '@ifc-lite/geometry';
import { DATA_DEFAULTS } from '../constants.js';

export interface DataSlice {
  // State
  ifcDataStore: IfcDataStore | null;
  geometryResult: GeometryResult | null;
  /** Transient overlay colors (lens/IDS/sdk overlays). */
  pendingColorUpdates: Map<number, [number, number, number, number]> | null;
  /** Persistent mesh color updates (IFC deferred style/material colors). */
  pendingMeshColorUpdates: Map<number, [number, number, number, number]> | null;

  // Actions
  setIfcDataStore: (result: IfcDataStore | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  appendGeometryBatch: (meshes: GeometryResult['meshes'], coordinateInfo?: CoordinateInfo) => void;
  /** Persist mesh color changes in geometryResult (used for IFC style/material updates). */
  updateMeshColors: (updates: Map<number, [number, number, number, number]>) => void;
  /** Set pending color updates for the renderer without cloning mesh data.
   *  Use this for transient overlays (lens, IDS) where the source-of-truth
   *  mesh colors should remain unchanged. */
  setPendingColorUpdates: (updates: Map<number, [number, number, number, number]>) => void;
  clearPendingColorUpdates: () => void;
  clearPendingMeshColorUpdates: () => void;
  updateCoordinateInfo: (coordinateInfo: CoordinateInfo) => void;
}

const getDefaultCoordinateInfo = (): CoordinateInfo => ({
  // Create fresh copies to avoid shared object references
  originShift: { x: DATA_DEFAULTS.ORIGIN_SHIFT.x, y: DATA_DEFAULTS.ORIGIN_SHIFT.y, z: DATA_DEFAULTS.ORIGIN_SHIFT.z },
  originalBounds: {
    min: { x: DATA_DEFAULTS.ORIGIN_SHIFT.x, y: DATA_DEFAULTS.ORIGIN_SHIFT.y, z: DATA_DEFAULTS.ORIGIN_SHIFT.z },
    max: { x: DATA_DEFAULTS.ORIGIN_SHIFT.x, y: DATA_DEFAULTS.ORIGIN_SHIFT.y, z: DATA_DEFAULTS.ORIGIN_SHIFT.z },
  },
  shiftedBounds: {
    min: { x: DATA_DEFAULTS.ORIGIN_SHIFT.x, y: DATA_DEFAULTS.ORIGIN_SHIFT.y, z: DATA_DEFAULTS.ORIGIN_SHIFT.z },
    max: { x: DATA_DEFAULTS.ORIGIN_SHIFT.x, y: DATA_DEFAULTS.ORIGIN_SHIFT.y, z: DATA_DEFAULTS.ORIGIN_SHIFT.z },
  },
  hasLargeCoordinates: DATA_DEFAULTS.HAS_LARGE_COORDINATES,
});

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set) => ({
  // Initial state
  ifcDataStore: null,
  geometryResult: null,
  pendingColorUpdates: null,
  pendingMeshColorUpdates: null,

  // Actions
  setIfcDataStore: (ifcDataStore) => set({ ifcDataStore }),

  setGeometryResult: (geometryResult) => set({ geometryResult }),

  appendGeometryBatch: (meshes, coordinateInfo) => set((state) => {
    // Incremental totals: O(batch_size) instead of O(total_accumulated) .reduce()
    let batchTriangles = 0;
    let batchVertices = 0;
    for (let i = 0; i < meshes.length; i++) {
      batchTriangles += meshes[i].indices.length / 3;
      batchVertices += meshes[i].positions.length / 3;
    }

    if (!state.geometryResult) {
      return {
        geometryResult: {
          meshes: meshes.slice(),
          totalTriangles: batchTriangles,
          totalVertices: batchVertices,
          coordinateInfo: coordinateInfo || getDefaultCoordinateInfo(),
        },
      };
    }

    // New array reference (required for React/Zustand change detection) but
    // only O(n) pointer copies — the expensive part was the .reduce() calls
    // which are now replaced by the incremental counters above.
    return {
      geometryResult: {
        ...state.geometryResult,
        meshes: [...state.geometryResult.meshes, ...meshes],
        totalTriangles: state.geometryResult.totalTriangles + batchTriangles,
        totalVertices: state.geometryResult.totalVertices + batchVertices,
        coordinateInfo: coordinateInfo || state.geometryResult.coordinateInfo,
      },
    };
  }),

  updateMeshColors: (updates) => set((state) => {
    // Clone the Map to prevent external mutation
    const clonedUpdates = new Map(updates);

    if (!state.geometryResult) {
      // Federation mode: no local geometryResult (geometry lives in models Map).
      // Still queue renderer updates for scene batch recoloring.
      return { pendingMeshColorUpdates: clonedUpdates };
    }

    // New array reference so useGeometryStreaming's useEffect detects the change.
    // Only runs once at 'complete' (not per-batch), so O(n) .map() is fine.
    const updatedMeshes = state.geometryResult.meshes.map(mesh => {
      const newColor = clonedUpdates.get(mesh.expressId);
      if (newColor) {
        return { ...mesh, color: newColor };
      }
      return mesh;
    });
    return {
      geometryResult: {
        ...state.geometryResult,
        meshes: updatedMeshes,
      },
      pendingMeshColorUpdates: clonedUpdates,
    };
  }),

  setPendingColorUpdates: (updates) => set({ pendingColorUpdates: new Map(updates) }),

  clearPendingColorUpdates: () => set({ pendingColorUpdates: null }),

  clearPendingMeshColorUpdates: () => set({ pendingMeshColorUpdates: null }),

  updateCoordinateInfo: (coordinateInfo) => set((state) => {
    if (!state.geometryResult) return {};
    return {
      geometryResult: {
        ...state.geometryResult,
        coordinateInfo,
      },
    };
  }),
});

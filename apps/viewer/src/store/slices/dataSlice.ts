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
    // Compute batch totals (O(batch_size), NOT O(total_accumulated))
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

    // O(batch_size) push instead of O(total) spread + re-allocate
    const existing = state.geometryResult.meshes;
    for (let i = 0; i < meshes.length; i++) existing.push(meshes[i]);

    return {
      geometryResult: {
        ...state.geometryResult,
        meshes: existing,
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

    // In-place color update: O(n) scan but no array/object allocation per mesh
    const meshes = state.geometryResult.meshes;
    for (const mesh of meshes) {
      const newColor = clonedUpdates.get(mesh.expressId);
      if (newColor) {
        mesh.color = newColor;
      }
    }
    return {
      geometryResult: {
        ...state.geometryResult,
        meshes,
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data state slice (IFC data and geometry)
 */

import type { StateCreator } from 'zustand';
import type { IfcDataStore } from '@ifc-lite/parser';
import type {
  GeometryResult,
  CoordinateInfo,
  HugeGeometryChunk,
  HugeGeometryEntityInfo,
  HugeGeometryStats,
} from '@ifc-lite/geometry';
import { DATA_DEFAULTS } from '../constants.js';

export interface DataSlice {
  // State
  ifcDataStore: IfcDataStore | null;
  geometryResult: GeometryResult | null;
  hugeGeometryMode: boolean;
  hugeGeometryStats: HugeGeometryStats | null;
  hugeGeometryEntities: Map<number, HugeGeometryEntityInfo>;
  pendingHugeGeometryChunks: HugeGeometryChunk[] | null;
  hugeGeometryVersion: number;
  /** Transient overlay colors (lens/IDS/sdk overlays). */
  pendingColorUpdates: Map<number, [number, number, number, number]> | null;
  /** Persistent mesh color updates (IFC deferred style/material colors). */
  pendingMeshColorUpdates: Map<number, [number, number, number, number]> | null;

  // Actions
  setIfcDataStore: (result: IfcDataStore | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  setHugeGeometryState: (
    mode: boolean,
    stats?: HugeGeometryStats | null,
    entities?: Map<number, HugeGeometryEntityInfo>
  ) => void;
  appendHugeGeometryChunks: (chunks: HugeGeometryChunk[], stats?: HugeGeometryStats | null) => void;
  clearPendingHugeGeometryChunks: () => void;
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
  hugeGeometryMode: false,
  hugeGeometryStats: null,
  hugeGeometryEntities: new Map(),
  pendingHugeGeometryChunks: null,
  hugeGeometryVersion: 0,
  pendingColorUpdates: null,
  pendingMeshColorUpdates: null,

  // Actions
  setIfcDataStore: (ifcDataStore) => set({ ifcDataStore }),

  setGeometryResult: (geometryResult) => set({
    geometryResult,
    hugeGeometryMode: false,
    hugeGeometryStats: null,
    hugeGeometryEntities: new Map(),
    pendingHugeGeometryChunks: null,
    hugeGeometryVersion: 0,
  }),

  setHugeGeometryState: (mode, stats = null, entities = new Map()) => set(() => ({
    hugeGeometryMode: mode,
    hugeGeometryStats: stats,
    hugeGeometryEntities: new Map(entities),
  })),

  appendHugeGeometryChunks: (chunks, stats = null) => set((state) => {
    if (chunks.length === 0) return {};

    const nextEntities = new Map(state.hugeGeometryEntities);
    for (const chunk of chunks) {
      for (const element of chunk.elements) {
        nextEntities.set(element.expressId, {
          expressId: element.expressId,
          ifcType: element.ifcType,
          modelIndex: element.modelIndex,
          color: element.color,
          boundsMin: element.boundsMin,
          boundsMax: element.boundsMax,
        });
      }
    }

    return {
      hugeGeometryMode: true,
      hugeGeometryStats: stats ?? state.hugeGeometryStats,
      hugeGeometryEntities: nextEntities,
      pendingHugeGeometryChunks: state.pendingHugeGeometryChunks
        ? [...state.pendingHugeGeometryChunks, ...chunks]
        : chunks.slice(),
      hugeGeometryVersion: state.hugeGeometryVersion + chunks.length,
    };
  }),

  clearPendingHugeGeometryChunks: () => set({ pendingHugeGeometryChunks: null }),

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
        hugeGeometryMode: false,
        hugeGeometryStats: null,
        hugeGeometryEntities: new Map(),
        pendingHugeGeometryChunks: null,
        hugeGeometryVersion: 0,
      };
    }

    // PERF FIX: Push into existing array — O(batch_size) instead of O(total).
    // The old [...old, ...new] spread copied ALL accumulated meshes every batch,
    // causing O(N²) total work (e.g., 176K meshes × 350 batches = 31M copies).
    // Zustand detects changes via the new geometryResult object reference below.
    const existing = state.geometryResult.meshes;
    for (let i = 0; i < meshes.length; i++) {
      existing.push(meshes[i]);
    }

    return {
      geometryResult: {
        ...state.geometryResult,
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

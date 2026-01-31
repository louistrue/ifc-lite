/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data state slice (IFC data and geometry)
 */

import type { StateCreator } from 'zustand';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, CoordinateInfo, MeshData } from '@ifc-lite/geometry';
import { DATA_DEFAULTS } from '../constants.js';

export interface DataSlice {
  // State
  ifcDataStore: IfcDataStore | null;
  geometryResult: GeometryResult | null;
  pendingColorUpdates: Map<number, [number, number, number, number]> | null;
  /** Set of expressIds that have been edited (for export) */
  editedGeometryIds: Set<number>;

  // Actions
  setIfcDataStore: (result: IfcDataStore | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  appendGeometryBatch: (meshes: GeometryResult['meshes'], coordinateInfo?: CoordinateInfo) => void;
  updateMeshColors: (updates: Map<number, [number, number, number, number]>) => void;
  clearPendingColorUpdates: () => void;
  updateCoordinateInfo: (coordinateInfo: CoordinateInfo) => void;
  /** Replace a mesh's geometry data (for geometry editing) */
  updateMeshGeometry: (expressId: number, newMesh: MeshData) => void;
  /** Get edited meshes for export */
  getEditedMeshes: () => Map<number, MeshData>;
  /** Clear edited geometry tracking (e.g., on model reload) */
  clearEditedGeometry: () => void;
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

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set, get) => ({
  // Initial state
  ifcDataStore: null,
  geometryResult: null,
  pendingColorUpdates: null,
  editedGeometryIds: new Set<number>(),

  // Actions
  setIfcDataStore: (ifcDataStore) => set({ ifcDataStore }),

  setGeometryResult: (geometryResult) => set({ geometryResult }),

  appendGeometryBatch: (meshes, coordinateInfo) => set((state) => {
    if (!state.geometryResult) {
      const totalTriangles = meshes.reduce((sum, m) => sum + (m.indices.length / 3), 0);
      const totalVertices = meshes.reduce((sum, m) => sum + (m.positions.length / 3), 0);
      return {
        geometryResult: {
          meshes,
          totalTriangles,
          totalVertices,
          coordinateInfo: coordinateInfo || getDefaultCoordinateInfo(),
        },
      };
    }
    const allMeshes = [...state.geometryResult.meshes, ...meshes];
    const totalTriangles = allMeshes.reduce((sum, m) => sum + (m.indices.length / 3), 0);
    const totalVertices = allMeshes.reduce((sum, m) => sum + (m.positions.length / 3), 0);
    return {
      geometryResult: {
        ...state.geometryResult,
        meshes: allMeshes,
        totalTriangles,
        totalVertices,
        coordinateInfo: coordinateInfo || state.geometryResult.coordinateInfo,
      },
    };
  }),

  updateMeshColors: (updates) => set((state) => {
    if (!state.geometryResult) return {};
    // Clone the Map to prevent external mutation of pendingColorUpdates
    const clonedUpdates = new Map(updates);
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
      pendingColorUpdates: clonedUpdates,
    };
  }),

  clearPendingColorUpdates: () => set({ pendingColorUpdates: null }),

  updateCoordinateInfo: (coordinateInfo) => set((state) => {
    if (!state.geometryResult) return {};
    return {
      geometryResult: {
        ...state.geometryResult,
        coordinateInfo,
      },
    };
  }),

  updateMeshGeometry: (expressId, newMesh) => set((state) => {
    if (!state.geometryResult) return {};

    const updatedMeshes = state.geometryResult.meshes.map(mesh => {
      if (mesh.expressId === expressId) {
        // Replace with new mesh data, preserving color if not provided
        return {
          ...newMesh,
          color: newMesh.color || mesh.color,
        };
      }
      return mesh;
    });

    // Recalculate totals
    const totalTriangles = updatedMeshes.reduce((sum, m) => sum + (m.indices.length / 3), 0);
    const totalVertices = updatedMeshes.reduce((sum, m) => sum + (m.positions.length / 3), 0);

    // Track this as an edited mesh
    const newEditedIds = new Set(state.editedGeometryIds);
    newEditedIds.add(expressId);

    console.log('[DataSlice] Updated mesh geometry for expressId:', expressId, '- total edited:', newEditedIds.size);

    return {
      geometryResult: {
        ...state.geometryResult,
        meshes: updatedMeshes,
        totalTriangles,
        totalVertices,
      },
      editedGeometryIds: newEditedIds,
    };
  }),

  getEditedMeshes: () => {
    const state = get();
    const editedMeshes = new Map<number, MeshData>();
    if (!state.geometryResult || state.editedGeometryIds.size === 0) {
      return editedMeshes;
    }
    for (const mesh of state.geometryResult.meshes) {
      if (state.editedGeometryIds.has(mesh.expressId)) {
        editedMeshes.set(mesh.expressId, mesh);
      }
    }
    return editedMeshes;
  },

  clearEditedGeometry: () => set({ editedGeometryIds: new Set<number>() }),
});

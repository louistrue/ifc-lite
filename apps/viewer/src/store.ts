/**
 * Zustand store for viewer state
 */

import { create } from 'zustand';
import type { ParseResult } from '@ifc-lite/parser';
import type { GeometryResult, CoordinateInfo } from '@ifc-lite/geometry';

interface ViewerState {
  // Loading state
  loading: boolean;
  progress: { phase: string; percent: number } | null;
  error: string | null;

  // Data
  parseResult: ParseResult | null;
  geometryResult: GeometryResult | null;

  // Selection
  selectedEntityId: number | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { phase: string; percent: number } | null) => void;
  setError: (error: string | null) => void;
  setParseResult: (result: ParseResult | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  appendGeometryBatch: (meshes: GeometryResult['meshes'], coordinateInfo?: CoordinateInfo) => void;
  updateCoordinateInfo: (coordinateInfo: CoordinateInfo) => void;
  setSelectedEntityId: (id: number | null) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  loading: false,
  progress: null,
  error: null,
  parseResult: null,
  geometryResult: null,
  selectedEntityId: null,

  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setParseResult: (parseResult) => set({ parseResult }),
  setGeometryResult: (geometryResult) => set({ geometryResult }),
  appendGeometryBatch: (meshes, coordinateInfo) => set((state) => {
    console.log('[Store] appendGeometryBatch called with', meshes.length, 'meshes', coordinateInfo ? 'with coordinateInfo' : 'without coordinateInfo');
    if (!state.geometryResult) {
      // Initialize geometry result with first batch
      console.log('[Store] Initializing geometry result with first batch');
      const totalTriangles = meshes.reduce((sum, m) => sum + (m.indices.length / 3), 0);
      const totalVertices = meshes.reduce((sum, m) => sum + (m.positions.length / 3), 0);
      const result = {
        geometryResult: {
          meshes,
          totalTriangles,
          totalVertices,
          coordinateInfo: coordinateInfo || {
            originShift: { x: 0, y: 0, z: 0 },
            originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            isGeoReferenced: false,
          },
        },
      };
      console.log('[Store] Created initial geometry result:', result.geometryResult.meshes.length, 'meshes');
      return result;
    }
    // Append to existing geometry
    console.log('[Store] Appending to existing geometry:', state.geometryResult.meshes.length, 'existing +', meshes.length, 'new');
    const existingMeshes = state.geometryResult.meshes;
    const allMeshes = [...existingMeshes, ...meshes];
    const totalTriangles = allMeshes.reduce((sum, m) => sum + (m.indices.length / 3), 0);
    const totalVertices = allMeshes.reduce((sum, m) => sum + (m.positions.length / 3), 0);
    const result = {
      geometryResult: {
        ...state.geometryResult,
        meshes: allMeshes,
        totalTriangles,
        totalVertices,
        // Update coordinateInfo if provided (it accumulates bounds incrementally)
        coordinateInfo: coordinateInfo || state.geometryResult.coordinateInfo,
      },
    };
    console.log('[Store] Updated geometry result:', result.geometryResult.meshes.length, 'total meshes');
    return result;
  }),
  updateCoordinateInfo: (coordinateInfo) => set((state) => {
    console.log('[Store] updateCoordinateInfo called');
    if (!state.geometryResult) {
      console.warn('[Store] updateCoordinateInfo called but no geometryResult');
      return {};
    }
    return {
      geometryResult: {
        ...state.geometryResult,
        coordinateInfo,
      },
    };
  }),
  setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),
}));

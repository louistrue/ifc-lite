/**
 * Zustand store for viewer state
 */

import { create } from 'zustand';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, CoordinateInfo } from '@ifc-lite/geometry';

interface ViewerState {
  // Loading state
  loading: boolean;
  progress: { phase: string; percent: number } | null;
  error: string | null;

  // Data
  ifcDataStore: IfcDataStore | null;
  geometryResult: GeometryResult | null;

  // Selection
  selectedEntityId: number | null;
  selectedStorey: number | null;

  // UI State
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  activeTool: string;

  // Actions
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { phase: string; percent: number } | null) => void;
  setError: (error: string | null) => void;
  setIfcDataStore: (result: IfcDataStore | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  appendGeometryBatch: (meshes: GeometryResult['meshes'], coordinateInfo?: CoordinateInfo) => void;
  updateCoordinateInfo: (coordinateInfo: CoordinateInfo) => void;
  setSelectedEntityId: (id: number | null) => void;
  setSelectedStorey: (id: number | null) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setActiveTool: (tool: string) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  loading: false,
  progress: null,
  error: null,
  ifcDataStore: null,
  geometryResult: null,
  selectedEntityId: null,
  selectedStorey: null,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  activeTool: 'select',

  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
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
          coordinateInfo: coordinateInfo || {
            originShift: { x: 0, y: 0, z: 0 },
            originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            isGeoReferenced: false,
          },
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
  updateCoordinateInfo: (coordinateInfo) => set((state) => {
    if (!state.geometryResult) return {};
    return {
      geometryResult: {
        ...state.geometryResult,
        coordinateInfo,
      },
    };
  }),
  setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),
  setSelectedStorey: (selectedStorey) => set({ selectedStorey }),
  setLeftPanelCollapsed: (leftPanelCollapsed) => set({ leftPanelCollapsed }),
  setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
  setActiveTool: (activeTool) => set({ activeTool }),
}));

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zustand store for viewer state
 */

import { create } from 'zustand';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, CoordinateInfo } from '@ifc-lite/geometry';

// Measurement types
export interface MeasurePoint {
  x: number;
  y: number;
  z: number;
  screenX: number;
  screenY: number;
}

export interface Measurement {
  id: string;
  start: MeasurePoint;
  end: MeasurePoint;
  distance: number;
}

// Section plane types
export interface SectionPlane {
  axis: 'x' | 'y' | 'z';
  position: number; // 0-100 percentage of model bounds
  enabled: boolean;
}

// Hover state
export interface HoverState {
  entityId: number | null;
  screenX: number;
  screenY: number;
}

// Context menu state
export interface ContextMenuState {
  isOpen: boolean;
  entityId: number | null;
  screenX: number;
  screenY: number;
}

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
  selectedEntityIds: Set<number>; // Multi-selection support
  selectedStorey: number | null;

  // Visibility
  hiddenEntities: Set<number>;
  isolatedEntities: Set<number> | null; // null = show all, Set = only show these
  
  // Type-based visibility (for spatial elements)
  typeVisibility: {
    spaces: boolean;    // IfcSpace - off by default
    openings: boolean;  // IfcOpeningElement - off by default
    site: boolean;      // IfcSite - on by default (when has geometry)
  };

  // UI State
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  activeTool: string;
  theme: 'light' | 'dark';
  isMobile: boolean;
  hoverTooltipsEnabled: boolean;

  // Hover state
  hoverState: HoverState;

  // Context menu state
  contextMenu: ContextMenuState;

  // Measurement state
  measurements: Measurement[];
  pendingMeasurePoint: MeasurePoint | null;

  // Section plane state
  sectionPlane: SectionPlane;

  // Camera state (for ViewCube sync)
  cameraRotation: { azimuth: number; elevation: number };
  cameraCallbacks: {
    setPresetView?: (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right') => void;
    fitAll?: () => void;
    home?: () => void;  // Reset to isometric view
    zoomIn?: () => void;
    zoomOut?: () => void;
    frameSelection?: () => void;  // Center view on selected element (F key)
    orbit?: (deltaX: number, deltaY: number) => void;  // Orbit camera by delta
  };
  // Direct callback for real-time ViewCube updates (bypasses React state)
  onCameraRotationChange: ((rotation: { azimuth: number; elevation: number }) => void) | null;
  // Direct callback for real-time scale bar updates (bypasses React state)
  onScaleChange: ((scale: number) => void) | null;

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
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setIsMobile: (isMobile: boolean) => void;
  toggleHoverTooltips: () => void;

  // Camera actions
  setCameraRotation: (rotation: { azimuth: number; elevation: number }) => void;
  setCameraCallbacks: (callbacks: ViewerState['cameraCallbacks']) => void;
  setOnCameraRotationChange: (callback: ((rotation: { azimuth: number; elevation: number }) => void) | null) => void;
  // Call this for real-time updates (uses callback if available, skips state)
  updateCameraRotationRealtime: (rotation: { azimuth: number; elevation: number }) => void;
  setOnScaleChange: (callback: ((scale: number) => void) | null) => void;
  updateScaleRealtime: (scale: number) => void;

  // Visibility actions
  hideEntity: (id: number) => void;
  hideEntities: (ids: number[]) => void;
  showEntity: (id: number) => void;
  showEntities: (ids: number[]) => void;
  toggleEntityVisibility: (id: number) => void;
  isolateEntity: (id: number) => void;
  isolateEntities: (ids: number[]) => void;
  clearIsolation: () => void;
  showAll: () => void;
  isEntityVisible: (id: number) => boolean;
  
  // Type visibility actions
  toggleTypeVisibility: (type: 'spaces' | 'openings' | 'site') => void;

  // Multi-selection actions
  addToSelection: (id: number) => void;
  removeFromSelection: (id: number) => void;
  toggleSelection: (id: number) => void;
  setSelectedEntityIds: (ids: number[]) => void;
  clearSelection: () => void;

  // Hover actions
  setHoverState: (state: HoverState) => void;
  clearHover: () => void;

  // Context menu actions
  openContextMenu: (entityId: number | null, screenX: number, screenY: number) => void;
  closeContextMenu: () => void;

  // Measurement actions
  addMeasurePoint: (point: MeasurePoint) => void;
  completeMeasurement: (endPoint: MeasurePoint) => void;
  deleteMeasurement: (id: string) => void;
  clearMeasurements: () => void;

  // Section plane actions
  setSectionPlaneAxis: (axis: 'x' | 'y' | 'z') => void;
  setSectionPlanePosition: (position: number) => void;
  toggleSectionPlane: () => void;
  flipSectionPlane: () => void;
  resetSectionPlane: () => void;

  // Reset all viewer state (called when loading new file)
  resetViewerState: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  loading: false,
  progress: null,
  error: null,
  ifcDataStore: null,
  geometryResult: null,
  selectedEntityId: null,
  selectedEntityIds: new Set(),
  selectedStorey: null,
  hiddenEntities: new Set(),
  isolatedEntities: null,
  typeVisibility: {
    spaces: false,    // Off by default
    openings: false, // Off by default
    site: true,      // On by default (when has geometry)
  },
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  activeTool: 'select',
  theme: 'dark',
  isMobile: false,
  hoverTooltipsEnabled: false,
  hoverState: { entityId: null, screenX: 0, screenY: 0 },
  contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },
  measurements: [],
  pendingMeasurePoint: null,
  sectionPlane: { axis: 'y', position: 50, enabled: false },
  cameraRotation: { azimuth: 45, elevation: 25 },
  cameraCallbacks: {},
  onCameraRotationChange: null,
  onScaleChange: null,

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
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },
  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    set({ theme: newTheme });
  },
  setIsMobile: (isMobile) => set({ isMobile }),
  toggleHoverTooltips: () => set((state) => ({ hoverTooltipsEnabled: !state.hoverTooltipsEnabled })),

  // Camera actions
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

  // Visibility actions
  hideEntity: (id) => set((state) => {
    // Toggle hide: if already hidden, show it; otherwise hide it
    const newHidden = new Set(state.hiddenEntities);
    if (newHidden.has(id)) {
      newHidden.delete(id);
    } else {
      newHidden.add(id);
    }
    return { hiddenEntities: newHidden };
  }),
  hideEntities: (ids) => set((state) => {
    // Toggle hide for each entity: if already hidden, show it; otherwise hide it
    const newHidden = new Set(state.hiddenEntities);
    ids.forEach(id => {
      if (newHidden.has(id)) {
        newHidden.delete(id);
      } else {
        newHidden.add(id);
      }
    });
    return { hiddenEntities: newHidden };
  }),
  showEntity: (id) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    newHidden.delete(id);
    return { hiddenEntities: newHidden };
  }),
  showEntities: (ids) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    ids.forEach(id => newHidden.delete(id));
    return { hiddenEntities: newHidden };
  }),
  toggleEntityVisibility: (id) => set((state) => {
    const newHidden = new Set(state.hiddenEntities);
    if (newHidden.has(id)) {
      newHidden.delete(id);
    } else {
      newHidden.add(id);
    }
    return { hiddenEntities: newHidden };
  }),
  isolateEntity: (id) => set((state) => {
    // Toggle isolate: if this entity is already the only isolated one, clear isolation
    // Otherwise, isolate it (and unhide it for good UX)
    const isAlreadyIsolated = state.isolatedEntities !== null && 
      state.isolatedEntities.size === 1 && 
      state.isolatedEntities.has(id);
    
    if (isAlreadyIsolated) {
      // Toggle off: clear isolation
      return { isolatedEntities: null };
    } else {
      // Toggle on: isolate this entity (and unhide it)
      const newHidden = new Set(state.hiddenEntities);
      newHidden.delete(id);
      return { 
        isolatedEntities: new Set([id]),
        hiddenEntities: newHidden,
      };
    }
  }),
  isolateEntities: (ids) => set((state) => {
    // Toggle isolate: if these exact entities are already isolated, clear isolation
    // Otherwise, isolate them (and unhide them for good UX)
    const idsSet = new Set(ids);
    const isAlreadyIsolated = state.isolatedEntities !== null &&
      state.isolatedEntities.size === idsSet.size &&
      ids.every(id => state.isolatedEntities!.has(id));
    
    if (isAlreadyIsolated) {
      // Toggle off: clear isolation
      return { isolatedEntities: null };
    } else {
      // Toggle on: isolate these entities (and unhide them)
      const newHidden = new Set(state.hiddenEntities);
      ids.forEach(id => newHidden.delete(id));
      return { 
        isolatedEntities: idsSet,
        hiddenEntities: newHidden,
      };
    }
  }),
  clearIsolation: () => set({ isolatedEntities: null }),
  showAll: () => set({ hiddenEntities: new Set(), isolatedEntities: null }),
  isEntityVisible: (id) => {
    const state = get();
    if (state.hiddenEntities.has(id)) return false;
    if (state.isolatedEntities !== null && !state.isolatedEntities.has(id)) return false;
    return true;
  },

  // Type visibility actions
  toggleTypeVisibility: (type) => set((state) => ({
    typeVisibility: {
      ...state.typeVisibility,
      [type]: !state.typeVisibility[type],
    },
  })),

  // Multi-selection actions
  addToSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    newSelection.add(id);
    return { selectedEntityIds: newSelection, selectedEntityId: id };
  }),
  removeFromSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    newSelection.delete(id);
    const remaining = Array.from(newSelection);
    return {
      selectedEntityIds: newSelection,
      selectedEntityId: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    };
  }),
  toggleSelection: (id) => set((state) => {
    const newSelection = new Set(state.selectedEntityIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    const remaining = Array.from(newSelection);
    return {
      selectedEntityIds: newSelection,
      selectedEntityId: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    };
  }),
  setSelectedEntityIds: (ids) => set({
    selectedEntityIds: new Set(ids),
    selectedEntityId: ids.length > 0 ? ids[ids.length - 1] : null,
  }),
  clearSelection: () => set({
    selectedEntityIds: new Set(),
    selectedEntityId: null,
  }),

  // Hover actions
  setHoverState: (hoverState) => set({ hoverState }),
  clearHover: () => set({ hoverState: { entityId: null, screenX: 0, screenY: 0 } }),

  // Context menu actions
  openContextMenu: (entityId, screenX, screenY) => set({
    contextMenu: { isOpen: true, entityId, screenX, screenY },
  }),
  closeContextMenu: () => set({
    contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },
  }),

  // Measurement actions
  addMeasurePoint: (point) => set({ pendingMeasurePoint: point }),
  completeMeasurement: (endPoint) => set((state) => {
    if (!state.pendingMeasurePoint) return {};
    const start = state.pendingMeasurePoint;
    const distance = Math.sqrt(
      Math.pow(endPoint.x - start.x, 2) +
      Math.pow(endPoint.y - start.y, 2) +
      Math.pow(endPoint.z - start.z, 2)
    );
    const measurement: Measurement = {
      id: `m-${Date.now()}`,
      start,
      end: endPoint,
      distance,
    };
    return {
      measurements: [...state.measurements, measurement],
      pendingMeasurePoint: null,
    };
  }),
  deleteMeasurement: (id) => set((state) => ({
    measurements: state.measurements.filter((m) => m.id !== id),
  })),
  clearMeasurements: () => set({ measurements: [], pendingMeasurePoint: null }),

  // Section plane actions
  setSectionPlaneAxis: (axis) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, axis },
  })),
  setSectionPlanePosition: (position) => set((state) => ({
    sectionPlane: { ...state.sectionPlane, position },
  })),
  toggleSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, enabled: !state.sectionPlane.enabled },
  })),
  flipSectionPlane: () => set((state) => ({
    sectionPlane: { ...state.sectionPlane, position: 100 - state.sectionPlane.position },
  })),
  resetSectionPlane: () => set({
    sectionPlane: { axis: 'y', position: 50, enabled: false },
  }),

  // Reset all viewer state when loading new file
  resetViewerState: () => set({
    selectedEntityId: null,
    selectedEntityIds: new Set(),
    selectedStorey: null,
    hiddenEntities: new Set(),
    isolatedEntities: null,
    typeVisibility: {
      spaces: false,
      openings: false,
      site: true,
    },
    hoverState: { entityId: null, screenX: 0, screenY: 0 },
    contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },
    measurements: [],
    pendingMeasurePoint: null,
    sectionPlane: { axis: 'y', position: 50, enabled: false },
    cameraRotation: { azimuth: 45, elevation: 25 },
    activeTool: 'select',
  }),
}));

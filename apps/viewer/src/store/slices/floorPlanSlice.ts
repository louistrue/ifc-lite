/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Floor Plan to 3D state slice
 *
 * Manages state for converting 2D floor plan images/PDFs into 3D building models.
 */

import type { StateCreator } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export type FloorPlanStatus = 'idle' | 'loading' | 'detecting' | 'ready' | 'generating' | 'error';

/** Detected wall from floor plan image */
export interface DetectedWall {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thickness: number;
  wallType: 'exterior' | 'interior' | 'partition';
}

/** Detected room from floor plan image */
export interface DetectedRoom {
  id: string;
  label: string;
  vertices: Array<{ x: number; y: number }>;
  area: number;
}

/** Detected opening (door/window) */
export interface DetectedOpening {
  id: string;
  openingType: 'door' | 'window';
  x: number;
  y: number;
  width: number;
  height: number;
  wallId: string | null;
}

/** Single floor plan with detection results */
export interface FloorPlanPage {
  /** Unique ID */
  id: string;
  /** Page index in PDF (0-based) */
  pageIndex: number;
  /** Display name (editable by user) */
  name: string;
  /** Original image data (RGBA) */
  imageData: ImageData | null;
  /** Thumbnail for UI display (small canvas) */
  thumbnailUrl: string | null;
  /** Detection results */
  walls: DetectedWall[];
  rooms: DetectedRoom[];
  openings: DetectedOpening[];
  /** Whether detection has run */
  detected: boolean;
  /** Scale factor: pixels per meter */
  scale: number;
}

/** Storey configuration for 3D generation */
export interface StoreyConfig {
  /** Reference to floor plan page */
  floorPlanId: string;
  /** Storey name (e.g., "Ground Floor") */
  name: string;
  /** Floor-to-floor height in meters */
  height: number;
  /** Elevation from ground level in meters */
  elevation: number;
  /** Order index for stacking (0 = bottom) */
  order: number;
}

/** Generated 3D mesh data for a storey */
export interface StoreyMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Generated building result */
export interface GeneratedBuilding {
  totalHeight: number;
  storeyCount: number;
  storeyMeshes: Map<number, StoreyMeshData>;
}

// ============================================================================
// State & Slice Types
// ============================================================================

export interface FloorPlanState {
  /** Overall status */
  floorPlanStatus: FloorPlanStatus;
  /** Progress (0-100) */
  floorPlanProgress: number;
  /** Current phase description */
  floorPlanPhase: string;
  /** Error message */
  floorPlanError: string | null;
  /** Whether panel is visible */
  floorPlanPanelVisible: boolean;

  /** Loaded PDF file name */
  pdfFileName: string | null;
  /** All floor plan pages */
  floorPlanPages: FloorPlanPage[];
  /** Selected page ID for editing */
  selectedPageId: string | null;

  /** Storey configurations for 3D generation */
  storeyConfigs: StoreyConfig[];
  /** Default floor-to-floor height */
  defaultStoreyHeight: number;

  /** Generated building (after 3D generation) */
  generatedBuilding: GeneratedBuilding | null;
  /** Whether the generated building is loaded into viewer */
  buildingLoaded: boolean;
}

export interface FloorPlanSlice extends FloorPlanState {
  // Status Actions
  setFloorPlanStatus: (status: FloorPlanStatus) => void;
  setFloorPlanProgress: (progress: number, phase: string) => void;
  setFloorPlanError: (error: string | null) => void;
  setFloorPlanPanelVisible: (visible: boolean) => void;
  toggleFloorPlanPanel: () => void;

  // PDF/Page Actions
  setPdfFileName: (name: string | null) => void;
  addFloorPlanPage: (page: FloorPlanPage) => void;
  updateFloorPlanPage: (pageId: string, updates: Partial<FloorPlanPage>) => void;
  removeFloorPlanPage: (pageId: string) => void;
  setSelectedPageId: (pageId: string | null) => void;
  clearAllPages: () => void;

  // Storey Config Actions
  addStoreyConfig: (config: StoreyConfig) => void;
  updateStoreyConfig: (floorPlanId: string, updates: Partial<StoreyConfig>) => void;
  removeStoreyConfig: (floorPlanId: string) => void;
  reorderStoreys: (newOrder: string[]) => void;
  setDefaultStoreyHeight: (height: number) => void;
  autoCreateStoreyConfigs: () => void;

  // Generation Actions
  setGeneratedBuilding: (building: GeneratedBuilding | null) => void;
  setBuildingLoaded: (loaded: boolean) => void;

  // Reset
  clearFloorPlan: () => void;
}

// ============================================================================
// Default State
// ============================================================================

const getDefaultState = (): FloorPlanState => ({
  floorPlanStatus: 'idle',
  floorPlanProgress: 0,
  floorPlanPhase: '',
  floorPlanError: null,
  floorPlanPanelVisible: false,

  pdfFileName: null,
  floorPlanPages: [],
  selectedPageId: null,

  storeyConfigs: [],
  defaultStoreyHeight: 3.0,

  generatedBuilding: null,
  buildingLoaded: false,
});

// ============================================================================
// Slice Creator
// ============================================================================

export const createFloorPlanSlice: StateCreator<FloorPlanSlice, [], [], FloorPlanSlice> = (set, get) => ({
  // Initial state
  ...getDefaultState(),

  // Status Actions
  setFloorPlanStatus: (status) => set({ floorPlanStatus: status }),

  setFloorPlanProgress: (progress, phase) => set({
    floorPlanProgress: progress,
    floorPlanPhase: phase,
  }),

  setFloorPlanError: (error) => set({
    floorPlanError: error,
    floorPlanStatus: error ? 'error' : 'idle',
  }),

  setFloorPlanPanelVisible: (visible) => set({ floorPlanPanelVisible: visible }),

  toggleFloorPlanPanel: () => set((state) => ({ floorPlanPanelVisible: !state.floorPlanPanelVisible })),

  // PDF/Page Actions
  setPdfFileName: (name) => set({ pdfFileName: name }),

  addFloorPlanPage: (page) => set((state) => ({
    floorPlanPages: [...state.floorPlanPages, page],
  })),

  updateFloorPlanPage: (pageId, updates) => set((state) => ({
    floorPlanPages: state.floorPlanPages.map((page) =>
      page.id === pageId ? { ...page, ...updates } : page
    ),
  })),

  removeFloorPlanPage: (pageId) => set((state) => ({
    floorPlanPages: state.floorPlanPages.filter((page) => page.id !== pageId),
    storeyConfigs: state.storeyConfigs.filter((config) => config.floorPlanId !== pageId),
    selectedPageId: state.selectedPageId === pageId ? null : state.selectedPageId,
  })),

  setSelectedPageId: (pageId) => set({ selectedPageId: pageId }),

  clearAllPages: () => set({
    floorPlanPages: [],
    storeyConfigs: [],
    selectedPageId: null,
    pdfFileName: null,
    generatedBuilding: null,
    buildingLoaded: false,
  }),

  // Storey Config Actions
  addStoreyConfig: (config) => set((state) => ({
    storeyConfigs: [...state.storeyConfigs, config],
  })),

  updateStoreyConfig: (floorPlanId, updates) => set((state) => ({
    storeyConfigs: state.storeyConfigs.map((config) =>
      config.floorPlanId === floorPlanId ? { ...config, ...updates } : config
    ),
  })),

  removeStoreyConfig: (floorPlanId) => set((state) => ({
    storeyConfigs: state.storeyConfigs.filter((config) => config.floorPlanId !== floorPlanId),
  })),

  reorderStoreys: (newOrder) => set((state) => {
    // Create a map for quick lookup
    const configMap = new Map(state.storeyConfigs.map((c) => [c.floorPlanId, c]));

    // Rebuild configs in new order with updated elevations
    let currentElevation = 0;
    const reorderedConfigs: StoreyConfig[] = [];

    for (let i = 0; i < newOrder.length; i++) {
      const floorPlanId = newOrder[i];
      const config = configMap.get(floorPlanId);
      if (config) {
        reorderedConfigs.push({
          ...config,
          order: i,
          elevation: currentElevation,
        });
        currentElevation += config.height;
      }
    }

    return { storeyConfigs: reorderedConfigs };
  }),

  setDefaultStoreyHeight: (height) => set({ defaultStoreyHeight: height }),

  autoCreateStoreyConfigs: () => {
    const state = get();
    const { floorPlanPages, defaultStoreyHeight } = state;

    // Create a storey config for each page that doesn't have one
    const existingIds = new Set(state.storeyConfigs.map((c) => c.floorPlanId));
    let currentElevation = state.storeyConfigs.reduce(
      (sum, c) => sum + c.height,
      0
    );
    let nextOrder = state.storeyConfigs.length;

    const newConfigs: StoreyConfig[] = [];

    for (const page of floorPlanPages) {
      if (!existingIds.has(page.id)) {
        newConfigs.push({
          floorPlanId: page.id,
          name: page.name || `Floor ${nextOrder + 1}`,
          height: defaultStoreyHeight,
          elevation: currentElevation,
          order: nextOrder,
        });
        currentElevation += defaultStoreyHeight;
        nextOrder++;
      }
    }

    if (newConfigs.length > 0) {
      set((s) => ({
        storeyConfigs: [...s.storeyConfigs, ...newConfigs],
      }));
    }
  },

  // Generation Actions
  setGeneratedBuilding: (building) => set({
    generatedBuilding: building,
    floorPlanStatus: building ? 'ready' : 'idle',
  }),

  setBuildingLoaded: (loaded) => set({ buildingLoaded: loaded }),

  // Reset
  clearFloorPlan: () => set(getDefaultState()),
});

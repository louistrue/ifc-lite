/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Combined Zustand store for viewer state
 *
 * This file combines all domain-specific slices into a single store.
 * Each slice manages a specific domain of state (loading, selection, etc.)
 */

import { create } from 'zustand';

// Import slices
import { createLoadingSlice, type LoadingSlice } from './slices/loadingSlice.js';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice.js';
import { createVisibilitySlice, type VisibilitySlice } from './slices/visibilitySlice.js';
import { createUISlice, type UISlice } from './slices/uiSlice.js';
import { createHoverSlice, type HoverSlice } from './slices/hoverSlice.js';
import { createCameraSlice, type CameraSlice } from './slices/cameraSlice.js';
import { createSectionSlice, type SectionSlice } from './slices/sectionSlice.js';
import { createMeasurementSlice, type MeasurementSlice } from './slices/measurementSlice.js';
import { createDataSlice, type DataSlice } from './slices/dataSlice.js';
import { createModelSlice, type ModelSlice } from './slices/modelSlice.js';

// Import constants for reset function
import { CAMERA_DEFAULTS, SECTION_PLANE_DEFAULTS, UI_DEFAULTS, TYPE_VISIBILITY_DEFAULTS } from './constants.js';

// Re-export types for consumers
export type * from './types.js';

// Explicitly re-export multi-model types that need to be imported by name
export type { EntityRef, SchemaVersion, FederatedModel } from './types.js';

// Re-export utility functions for entity references
export { entityRefToString, stringToEntityRef, entityRefEquals, isIfcxDataStore } from './types.js';

// Combined store type
export type ViewerState = LoadingSlice &
  SelectionSlice &
  VisibilitySlice &
  UISlice &
  HoverSlice &
  CameraSlice &
  SectionSlice &
  MeasurementSlice &
  DataSlice &
  ModelSlice & {
    resetViewerState: () => void;
  };

/**
 * Main viewer store combining all slices
 */
export const useViewerStore = create<ViewerState>()((...args) => ({
  // Spread all slices
  ...createLoadingSlice(...args),
  ...createSelectionSlice(...args),
  ...createVisibilitySlice(...args),
  ...createUISlice(...args),
  ...createHoverSlice(...args),
  ...createCameraSlice(...args),
  ...createSectionSlice(...args),
  ...createMeasurementSlice(...args),
  ...createDataSlice(...args),
  ...createModelSlice(...args),

  // Reset all viewer state when loading new file
  // Note: Does NOT clear models - use clearAllModels() for that
  resetViewerState: () => {
    const [set] = args;
    set({
      // Selection (legacy)
      selectedEntityId: null,
      selectedEntityIds: new Set(),
      selectedStoreys: new Set(),

      // Selection (multi-model)
      selectedEntity: null,
      selectedEntitiesSet: new Set(),

      // Visibility (legacy)
      hiddenEntities: new Set(),
      isolatedEntities: null,
      typeVisibility: {
        spaces: TYPE_VISIBILITY_DEFAULTS.SPACES,
        openings: TYPE_VISIBILITY_DEFAULTS.OPENINGS,
        site: TYPE_VISIBILITY_DEFAULTS.SITE,
      },

      // Visibility (multi-model)
      hiddenEntitiesByModel: new Map(),
      isolatedEntitiesByModel: new Map(),

      // Data
      pendingColorUpdates: null,

      // Hover/Context
      hoverState: { entityId: null, screenX: 0, screenY: 0 },
      contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },

      // Measurements
      measurements: [],
      pendingMeasurePoint: null,
      activeMeasurement: null,
      snapTarget: null,
      edgeLockState: {
        edge: null,
        meshExpressId: null,
        edgeT: 0,
        lockStrength: 0,
        isCorner: false,
        cornerValence: 0,
      },

      // Section plane
      sectionPlane: {
        axis: SECTION_PLANE_DEFAULTS.AXIS,
        position: SECTION_PLANE_DEFAULTS.POSITION,
        enabled: SECTION_PLANE_DEFAULTS.ENABLED,
        flipped: SECTION_PLANE_DEFAULTS.FLIPPED,
      },

      // Camera
      cameraRotation: {
        azimuth: CAMERA_DEFAULTS.AZIMUTH,
        elevation: CAMERA_DEFAULTS.ELEVATION,
      },

      // UI
      activeTool: UI_DEFAULTS.ACTIVE_TOOL,
    });
  },
}));

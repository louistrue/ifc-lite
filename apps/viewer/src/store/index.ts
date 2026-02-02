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
import { createMutationSlice, type MutationSlice } from './slices/mutationSlice.js';
import { createDrawing2DSlice, type Drawing2DSlice } from './slices/drawing2DSlice.js';
import { createSheetSlice, type SheetSlice } from './slices/sheetSlice.js';
import { createBcfSlice, type BCFSlice } from './slices/bcfSlice.js';
import { createIdsSlice, type IDSSlice } from './slices/idsSlice.js';

// Import constants for reset function
import { CAMERA_DEFAULTS, SECTION_PLANE_DEFAULTS, UI_DEFAULTS, TYPE_VISIBILITY_DEFAULTS } from './constants.js';

// Re-export types for consumers
export type * from './types.js';

// Explicitly re-export multi-model types that need to be imported by name
export type { EntityRef, SchemaVersion, FederatedModel, MeasurementConstraintEdge } from './types.js';

// Re-export utility functions for entity references
export { entityRefToString, stringToEntityRef, entityRefEquals, isIfcxDataStore } from './types.js';

// Re-export Drawing2D types
export type { Drawing2DState, Drawing2DStatus } from './slices/drawing2DSlice.js';

// Re-export Sheet types
export type { SheetState } from './slices/sheetSlice.js';

// Re-export BCF types
export type { BCFSlice, BCFSliceState } from './slices/bcfSlice.js';

// Re-export IDS types
export type { IDSSlice, IDSSliceState, IDSDisplayOptions, IDSFilterMode } from './slices/idsSlice.js';

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
  ModelSlice &
  MutationSlice &
  Drawing2DSlice &
  SheetSlice &
  BCFSlice &
  IDSSlice & {
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
  ...createMutationSlice(...args),
  ...createDrawing2DSlice(...args),
  ...createSheetSlice(...args),
  ...createBcfSlice(...args),
  ...createIdsSlice(...args),

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

      // Drawing 2D
      drawing2D: null,
      drawing2DStatus: 'idle' as const,
      drawing2DProgress: 0,
      drawing2DPhase: '',
      drawing2DError: null,
      drawing2DPanelVisible: false,
      drawing2DSvgContent: null,
      drawing2DDisplayOptions: {
        showHiddenLines: true,
        showHatching: true,
        showAnnotations: true,
        show3DOverlay: true,
        scale: 100,
      },
      // Graphic overrides (keep presets, reset active and custom)
      activePresetId: 'preset-3d-colors',
      customOverrideRules: [],
      overridesEnabled: true,
      overridesPanelVisible: false,
      // 2D Measure
      measure2DMode: false,
      measure2DStart: null,
      measure2DCurrent: null,
      measure2DShiftLocked: false,
      measure2DLockedAxis: null,
      measure2DResults: [],
      measure2DSnapPoint: null,
      // Drawing Sheet
      activeSheet: null,
      sheetEnabled: false,
      sheetPanelVisible: false,
      titleBlockEditorVisible: false,
      // Keep savedSheetTemplates - don't reset user's templates

      // BCF - reset panel but keep project and author
      bcfPanelVisible: false,
      bcfLoading: false,
      bcfError: null,
      activeTopicId: null,
      activeViewpointId: null,
      // Keep bcfProject and bcfAuthor - user's work

      // IDS - reset panel but keep document and results
      idsPanelVisible: false,
      idsLoading: false,
      idsProgress: null,
      idsError: null,
      idsActiveSpecificationId: null,
      idsActiveEntityId: null,
      // Keep idsDocument, idsValidationReport, idsLocale - user's work
    });
  },
}));

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Store constants - extracted magic numbers for maintainability
 */

// ============================================================================
// Camera Defaults
// ============================================================================

export const CAMERA_DEFAULTS = {
  /** Default azimuth angle in degrees (horizontal rotation) */
  AZIMUTH: 45,
  /** Default elevation angle in degrees (vertical rotation) */
  ELEVATION: 25,
} as const;

// ============================================================================
// Section Plane Defaults
// ============================================================================

export const SECTION_PLANE_DEFAULTS = {
  /** Default section plane axis */
  AXIS: 'down' as const,
  /** Default section plane position (percentage of model bounds) */
  POSITION: 50,
  /** Default enabled state */
  ENABLED: true,
  /** Default flipped state */
  FLIPPED: false,
} as const;

// ============================================================================
// Edge Lock / Magnetic Snapping
// ============================================================================

export const EDGE_LOCK_DEFAULTS = {
  /** Initial position along edge (0-1, where 0.5 = midpoint) */
  INITIAL_T: 0.5,
  /** Initial lock strength when edge is first locked */
  INITIAL_STRENGTH: 0.5,
  /** Strength increment per update */
  STRENGTH_INCREMENT: 0.1,
  /** Maximum lock strength */
  MAX_STRENGTH: 1.5,
} as const;

// ============================================================================
// UI Defaults
// ============================================================================

export const UI_DEFAULTS = {
  /** Default active tool */
  ACTIVE_TOOL: 'select',
  /** Default theme */
  THEME: 'dark' as const,
  /** Default hover tooltips state */
  HOVER_TOOLTIPS_ENABLED: false,
} as const;

// ============================================================================
// Type Visibility Defaults
// ============================================================================

export const TYPE_VISIBILITY_DEFAULTS = {
  /** IfcSpace visibility - off by default */
  SPACES: false,
  /** IfcOpeningElement visibility - off by default */
  OPENINGS: false,
  /** IfcSite visibility - on by default (when has geometry) */
  SITE: true,
} as const;

// ============================================================================
// Data Defaults
// ============================================================================

export const DATA_DEFAULTS = {
  /** Default origin shift (no shift) */
  ORIGIN_SHIFT: { x: 0, y: 0, z: 0 },
  /** Default geo-referenced state */
  IS_GEO_REFERENCED: false,
} as const;

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared types for the viewer store
 */

// ============================================================================
// Measurement Types
// ============================================================================

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

/** Active measurement for drag-based interaction */
export interface ActiveMeasurement {
  start: MeasurePoint;
  current: MeasurePoint;
  distance: number;
}

// ============================================================================
// Edge Lock Types (Magnetic Snapping)
// ============================================================================

export interface EdgeLockState {
  /** The locked edge vertices (in world space) */
  edge: { v0: { x: number; y: number; z: number }; v1: { x: number; y: number; z: number } } | null;
  /** Which mesh the edge belongs to */
  meshExpressId: number | null;
  /** Current position along the edge (0-1, where 0 = v0, 1 = v1) */
  edgeT: number;
  /** Lock strength (increases over time while locked, affects escape threshold) */
  lockStrength: number;
  /** Is this a corner (vertex where 2+ edges meet)? */
  isCorner: boolean;
  /** Number of edges meeting at corner (valence) */
  cornerValence: number;
}

// ============================================================================
// Section Plane Types
// ============================================================================

/** Semantic axis names: down (Y), front (Z), side (X) for intuitive user experience */
export type SectionPlaneAxis = 'down' | 'front' | 'side';

export interface SectionPlane {
  axis: SectionPlaneAxis;
  /** 0-100 percentage of model bounds */
  position: number;
  enabled: boolean;
  /** If true, show the opposite side of the cut */
  flipped: boolean;
}

// ============================================================================
// Hover & Context Menu Types
// ============================================================================

export interface HoverState {
  entityId: number | null;
  screenX: number;
  screenY: number;
}

export interface ContextMenuState {
  isOpen: boolean;
  entityId: number | null;
  screenX: number;
  screenY: number;
}

// ============================================================================
// Snap Visualization Types
// ============================================================================

export interface SnapVisualization {
  /** 3D world coordinates for edge (projected to screen by renderer) */
  edgeLine3D?: { v0: { x: number; y: number; z: number }; v1: { x: number; y: number; z: number } };
  /** Face snap indicator */
  planeIndicator?: { x: number; y: number; normal: { x: number; y: number; z: number } };
  /** Position on edge (t = 0-1), projected from edgeLine3D */
  slidingDot?: { t: number };
  /** Corner indicator: true = at v0, false = at v1 */
  cornerRings?: { atStart: boolean; valence: number };
}

// ============================================================================
// Type Visibility
// ============================================================================

export interface TypeVisibility {
  /** IfcSpace - off by default */
  spaces: boolean;
  /** IfcOpeningElement - off by default */
  openings: boolean;
  /** IfcSite - on by default (when has geometry) */
  site: boolean;
}

// ============================================================================
// Camera Types
// ============================================================================

export interface CameraRotation {
  azimuth: number;
  elevation: number;
}

export interface CameraCallbacks {
  setPresetView?: (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right') => void;
  fitAll?: () => void;
  home?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  frameSelection?: () => void;
  orbit?: (deltaX: number, deltaY: number) => void;
  projectToScreen?: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null;
}

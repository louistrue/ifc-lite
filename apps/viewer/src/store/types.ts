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

// ============================================================================
// Multi-Model Federation Types
// ============================================================================

import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';

/** Compound identifier for entities across multiple models */
export interface EntityRef {
  modelId: string;
  expressId: number;
}

/** IFC schema version enum for type safety */
export type SchemaVersion = 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5';

/** Complete model container for federation */
export interface FederatedModel {
  /** Unique identifier (UUID generated on load) */
  id: string;
  /** Display name (filename by default, user can rename) */
  name: string;
  /** Parsed IFC data model */
  ifcDataStore: IfcDataStore;
  /** Pre-tessellated geometry (with globalIds, not original expressIds) */
  geometryResult: GeometryResult;
  /** Model-level visibility toggle */
  visible: boolean;
  /** UI collapse state in hierarchy panel */
  collapsed: boolean;
  /** IFC schema version */
  schemaVersion: SchemaVersion;
  /** Load timestamp */
  loadedAt: number;
  /** Original file size in bytes */
  fileSize: number;
  /**
   * ID offset for this model (from FederationRegistry)
   * All mesh expressIds are globalIds = originalExpressId + idOffset
   * Use this to convert back to original IDs for property lookup
   */
  idOffset: number;
  /** Maximum original expressId in this model (for range validation) */
  maxExpressId: number;
}

/** Convert EntityRef to string for use as Map/Set key */
export function entityRefToString(ref: EntityRef): string {
  return `${ref.modelId}:${ref.expressId}`;
}

/** Parse string back to EntityRef */
export function stringToEntityRef(str: string): EntityRef {
  const colonIndex = str.indexOf(':');
  if (colonIndex === -1) {
    // Invalid format - return a sentinel value
    return { modelId: '', expressId: -1 };
  }
  const modelId = str.substring(0, colonIndex);
  const expressId = parseInt(str.substring(colonIndex + 1), 10);
  // Handle NaN case (malformed expressId)
  if (Number.isNaN(expressId)) {
    return { modelId, expressId: -1 };
  }
  return { modelId, expressId };
}

/** Check if two EntityRefs are equal */
export function entityRefEquals(a: EntityRef | null, b: EntityRef | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.modelId === b.modelId && a.expressId === b.expressId;
}

/**
 * Type guard to check if a data store has IFC5 schema version.
 * IFCX files are stored with schemaVersion: 'IFC5' which extends the parser's IfcDataStore type.
 */
export function isIfcxDataStore(dataStore: unknown): boolean {
  return (
    dataStore !== null &&
    typeof dataStore === 'object' &&
    'schemaVersion' in dataStore &&
    dataStore.schemaVersion === 'IFC5'
  );
}

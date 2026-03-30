/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Types for IFC clash detection
 */

/**
 * Detection mode for clash checking:
 * - collision: elements touch or overlap (AABB intersection)
 * - clearance: elements come within a distance threshold
 * - intersection: elements penetrate each other (triangle-level)
 */
export type ClashMode = 'collision' | 'clearance' | 'intersection';

/**
 * A group of elements to check for clashes.
 * Each group references an IfcDataStore and optional type filters.
 */
export interface ClashGroup {
  /** Path to the IFC file (for reporting; store must be pre-loaded) */
  file: string;
  /** Optional IFC type filter (e.g. 'IfcWall', 'IfcBeam'). Accepts multiple. */
  types?: string[];
  /** Optional GlobalId whitelist — only check these elements */
  globalIds?: string[];
}

/**
 * A clash set defines what to check: group A vs group B.
 * If group B is omitted, clashes are detected within group A itself.
 */
export interface ClashSet {
  /** Descriptive name for this clash set */
  name: string;
  /** Source group */
  a: ClashGroup;
  /** Target group (optional — omit for intra-group detection) */
  b?: ClashGroup;
}

/**
 * Settings for clash detection, modeled after IfcOpenShell's IfcClash.
 */
export interface ClashSettings {
  /** Clash detection mode */
  mode?: ClashMode;
  /**
   * Tolerance for ignoring small intersections (meters).
   * Intersections smaller than this are filtered out.
   * Useful for distinguishing touching elements from true clashes.
   * Default: 0.002
   */
  tolerance?: number;
  /**
   * Clearance distance threshold (meters).
   * Only used when mode is 'clearance'.
   * Default: 0.05
   */
  clearance?: number;
  /**
   * Whether touching surfaces (zero gap) are considered clashes.
   * Default: false
   */
  allowTouching?: boolean;
  /**
   * Check all combinations even after finding first clash per pair.
   * Default: true
   */
  checkAll?: boolean;
}

export const DEFAULT_CLASH_SETTINGS: Required<ClashSettings> = {
  mode: 'collision',
  tolerance: 0.002,
  clearance: 0.05,
  allowTouching: false,
  checkAll: true,
};

/**
 * A single detected clash between two elements.
 */
export interface Clash {
  /** Source element */
  a: ClashElement;
  /** Target element */
  b: ClashElement;
  /** Distance between elements. Negative = penetration depth. Zero = touching. */
  distance: number;
  /** Approximate clash point (midpoint between closest surfaces) */
  point: [number, number, number];
  /** The clash set name this clash belongs to */
  clashSet: string;
}

export interface ClashElement {
  expressId: number;
  globalId: string;
  type: string;
  name: string;
  file: string;
}

/**
 * Result of a clash detection run.
 */
export interface ClashResult {
  clashes: Clash[];
  summary: {
    totalClashes: number;
    /** Clashes grouped by clash set name */
    byClashSet: Record<string, number>;
    /** Clashes grouped by element type pair (e.g. "IfcWall vs IfcPipe") */
    byTypePair: Record<string, number>;
  };
  settings: Required<ClashSettings>;
}

/**
 * Color presets for clash visualization.
 * RGBA tuples in [0-1] range.
 */
export const CLASH_COLORS = {
  clashA: [1.0, 0.2, 0.2, 1.0] as [number, number, number, number],      // red
  clashB: [1.0, 0.5, 0.0, 1.0] as [number, number, number, number],      // orange
  clearance: [1.0, 1.0, 0.0, 0.8] as [number, number, number, number],   // yellow
  unaffected: [0.7, 0.7, 0.7, 0.15] as [number, number, number, number], // grey, ghosted
} as const;

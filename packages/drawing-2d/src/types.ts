/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for 2D architectural drawing generation
 */

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export type SectionAxis = 'x' | 'y' | 'z';

export interface SectionPlaneConfig {
  /** Axis perpendicular to the section plane */
  axis: SectionAxis;
  /** Position along the axis in world units */
  position: number;
  /** Whether to flip the view direction */
  flipped: boolean;
}

export interface SectionConfig {
  /** Section plane definition */
  plane: SectionPlaneConfig;
  /** Depth range beyond cut plane to include for projection lines (world units) */
  projectionDepth: number;
  /** Whether to compute hidden lines */
  includeHiddenLines: boolean;
  /** Crease angle threshold in degrees (edges sharper than this are feature edges) */
  creaseAngle: number;
  /** Scale factor for output (e.g., 100 for 1:100) */
  scale: number;
}

export const DEFAULT_SECTION_CONFIG: Omit<SectionConfig, 'plane'> = {
  projectionDepth: 10,
  includeHiddenLines: true,
  creaseAngle: 30,
  scale: 100,
};

// ═══════════════════════════════════════════════════════════════════════════
// 2D GEOMETRY PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

export interface Point2D {
  x: number;
  y: number;
}

export interface Line2D {
  start: Point2D;
  end: Point2D;
}

export interface Polyline2D {
  points: Point2D[];
  closed: boolean;
}

export interface Polygon2D {
  /** Outer boundary (counter-clockwise winding) */
  outer: Point2D[];
  /** Inner holes (clockwise winding) */
  holes: Point2D[][];
}

export interface Bounds2D {
  min: Point2D;
  max: Point2D;
}

// ═══════════════════════════════════════════════════════════════════════════
// LINE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Category of line in architectural drawing
 */
export type LineCategory =
  | 'cut'         // Geometry intersected by section plane (thickest lines)
  | 'projection'  // Visible geometry beyond cut plane
  | 'hidden'      // Occluded geometry (rendered as dashed)
  | 'silhouette'  // Outer contour edges
  | 'crease'      // Sharp feature edges (angle > threshold)
  | 'boundary'    // Mesh boundary edges (open edges)
  | 'annotation'; // Dimensions, labels, etc.

/**
 * Visibility state for hidden line removal
 */
export type VisibilityState = 'visible' | 'hidden' | 'partial';

// ═══════════════════════════════════════════════════════════════════════════
// DRAWING ELEMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A classified line segment in the 2D drawing
 */
export interface DrawingLine {
  /** 2D line geometry */
  line: Line2D;
  /** Line classification */
  category: LineCategory;
  /** Visibility after hidden line removal */
  visibility: VisibilityState;
  /** Source IFC entity expressId */
  entityId: number;
  /** IFC type name (e.g., "IfcWall") */
  ifcType: string;
  /** Model index for multi-model federation */
  modelIndex: number;
  /** Distance from section plane (for depth sorting) */
  depth: number;
}

/**
 * A polygon from section cut (used for hatching)
 */
export interface DrawingPolygon {
  /** 2D polygon geometry */
  polygon: Polygon2D;
  /** Source IFC entity expressId */
  entityId: number;
  /** IFC type name */
  ifcType: string;
  /** Model index for multi-model federation */
  modelIndex: number;
  /** True if from section cut, false if projection */
  isCut: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERMEDIATE RESULTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw cut segment before classification
 */
export interface CutSegment {
  /** 3D start point of cut */
  p0: Vec3;
  /** 3D end point of cut */
  p1: Vec3;
  /** 2D projected start point */
  p0_2d: Point2D;
  /** 2D projected end point */
  p1_2d: Point2D;
  /** Source entity ID */
  entityId: number;
  /** IFC type */
  ifcType: string;
  /** Model index */
  modelIndex: number;
}

/**
 * Result from section cutting a single mesh
 */
export interface MeshCutResult {
  /** Cut line segments */
  segments: CutSegment[];
  /** Number of triangles processed */
  trianglesProcessed: number;
  /** Number of triangles that intersected the plane */
  trianglesIntersected: number;
}

/**
 * Result from cutting all meshes
 */
export interface SectionCutResult {
  /** All cut segments */
  segments: CutSegment[];
  /** Reconstructed polygons per entity */
  polygons: DrawingPolygon[];
  /** Processing statistics */
  stats: {
    totalTriangles: number;
    intersectedTriangles: number;
    segmentCount: number;
    polygonCount: number;
    processingTimeMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE DRAWING OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Complete 2D drawing result
 */
export interface Drawing2D {
  /** Section configuration used */
  config: SectionConfig;

  /** All classified lines */
  lines: DrawingLine[];

  /** Cut polygons (for hatching) */
  cutPolygons: DrawingPolygon[];

  /** Projection polygons (visible surfaces beyond cut) */
  projectionPolygons: DrawingPolygon[];

  /** Bounding box in 2D drawing space */
  bounds: Bounds2D;

  /** Processing statistics */
  stats: {
    cutLineCount: number;
    projectionLineCount: number;
    hiddenLineCount: number;
    silhouetteLineCount: number;
    polygonCount: number;
    totalTriangles: number;
    processingTimeMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EDGE DATA (for feature edge extraction)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Edge data with adjacency information
 */
export interface EdgeData {
  /** First vertex */
  v0: Vec3;
  /** Second vertex */
  v1: Vec3;
  /** Normal of first adjacent face (null if boundary) */
  face0Normal: Vec3 | null;
  /** Normal of second adjacent face (null if boundary) */
  face1Normal: Vec3 | null;
  /** Dihedral angle between faces (radians) */
  dihedralAngle: number;
  /** Edge classification */
  type: 'crease' | 'boundary' | 'smooth';
  /** Source entity ID */
  entityId: number;
  /** IFC type */
  ifcType: string;
  /** Model index */
  modelIndex: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Entity key for grouping geometry
 */
export type EntityKey = `${number}:${number}`; // modelIndex:entityId

/**
 * Create entity key from components
 */
export function makeEntityKey(modelIndex: number, entityId: number): EntityKey {
  return `${modelIndex}:${entityId}`;
}

/**
 * Parse entity key back to components
 */
export function parseEntityKey(key: EntityKey): { modelIndex: number; entityId: number } {
  const [modelIndex, entityId] = key.split(':').map(Number);
  return { modelIndex, entityId };
}

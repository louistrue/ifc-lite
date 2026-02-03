/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry types for IFC-Lite
 */

export interface MeshData {
  expressId: number;
  ifcType?: string;          // IFC type name (e.g., "IfcWall", "IfcSpace") - optional for backward compatibility with old caches
  modelIndex?: number;       // Index of the model this mesh belongs to (for multi-model federation)
  positions: Float32Array;  // [x,y,z, x,y,z, ...]
  normals: Float32Array;    // [nx,ny,nz, ...]
  indices: Uint32Array;     // Triangle indices
  color: [number, number, number, number];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Instance data for instanced rendering
 */
export interface InstanceData {
  expressId: number;
  transform: Float32Array; // 16 floats (4x4 matrix, column-major)
  color: [number, number, number, number]; // RGBA
}

/**
 * Instanced geometry - one geometry definition with multiple instances
 * Reduces draw calls by grouping identical geometries with different transforms
 */
export interface InstancedGeometry {
  geometryId: number; // Hash of geometry content
  positions: Float32Array; // [x,y,z, x,y,z, ...]
  normals: Float32Array; // [nx,ny,nz, ...]
  indices: Uint32Array; // Triangle indices
  instance_count: number; // WASM getter - number of instances
  get_instance(index: number): InstanceData | null; // WASM method - get instance at index
}

/**
 * Collection of instanced geometries
 */
export interface InstancedMeshCollection {
  length: number;
  totalGeometries: number;
  totalInstances: number;
  get(index: number): InstancedGeometry | null;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface CoordinateInfo {
  originShift: Vec3;        // Shift applied to positions
  originalBounds: AABB;     // Bounds before shift
  shiftedBounds: AABB;      // Bounds after shift
  /** True if model had large coordinates requiring RTC shift. NOT the same as proper georeferencing via IfcMapConversion. */
  hasLargeCoordinates: boolean;
}

export interface GeometryResult {
  meshes: MeshData[];
  totalTriangles: number;
  totalVertices: number;
  coordinateInfo: CoordinateInfo;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYMBOLIC REPRESENTATION TYPES
// For Plan, Annotation, FootPrint representations (2D curves for drawings)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Representation identifier types for symbolic representations
 */
export type SymbolicRepIdentifier = 'Plan' | 'Annotation' | 'FootPrint' | 'Axis';

/**
 * A 2D polyline from symbolic representations
 * Used for door swings, window cuts, equipment symbols, etc.
 */
export interface SymbolicPolyline {
  /** Express ID of the parent IFC element */
  expressId: number;
  /** IFC type name (e.g., "IfcDoor", "IfcWindow") */
  ifcType: string;
  /** 2D points as Float32Array [x1, y1, x2, y2, ...] */
  points: Float32Array;
  /** Number of points in the polyline */
  pointCount: number;
  /** Whether this is a closed loop */
  isClosed: boolean;
  /** Representation identifier ("Plan", "Annotation", etc.) */
  repIdentifier: string;
}

/**
 * A 2D circle or arc from symbolic representations
 */
export interface SymbolicCircle {
  /** Express ID of the parent IFC element */
  expressId: number;
  /** IFC type name */
  ifcType: string;
  /** Center X coordinate */
  centerX: number;
  /** Center Y coordinate */
  centerY: number;
  /** Radius */
  radius: number;
  /** Start angle in radians (0 for full circle) */
  startAngle: number;
  /** End angle in radians (2π for full circle) */
  endAngle: number;
  /** Whether this is a full circle */
  isFullCircle: boolean;
  /** Representation identifier */
  repIdentifier: string;
}

/**
 * Collection of symbolic representations from an IFC model
 * These are pre-authored 2D representations for architectural drawings
 */
export interface SymbolicRepresentationCollection {
  /** Number of polylines */
  polylineCount: number;
  /** Number of circles/arcs */
  circleCount: number;
  /** Total count of all symbolic items */
  totalCount: number;
  /** Check if collection is empty */
  isEmpty: boolean;
  /** Get polyline at index */
  getPolyline(index: number): SymbolicPolyline | null;
  /** Get circle at index */
  getCircle(index: number): SymbolicCircle | null;
  /** Get all express IDs that have symbolic representations */
  getExpressIds(): number[];
}

/**
 * Converted symbolic data for use in drawing generation
 * Organized by express ID for easy lookup
 */
export interface SymbolicDataByEntity {
  /** Map from expressId to polylines for that entity */
  polylines: Map<number, SymbolicPolyline[]>;
  /** Map from expressId to circles for that entity */
  circles: Map<number, SymbolicCircle[]>;
  /** Set of express IDs that have symbolic representations */
  expressIds: Set<number>;
}

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
  isGeoReferenced: boolean; // True if large coords detected
}

export interface GeometryResult {
  meshes: MeshData[];
  totalTriangles: number;
  totalVertices: number;
  coordinateInfo: CoordinateInfo;
}

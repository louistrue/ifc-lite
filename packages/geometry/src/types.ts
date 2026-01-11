/**
 * Geometry types for IFC-Lite
 */

export interface MeshData {
  expressId: number;
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

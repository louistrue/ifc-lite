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

export interface GeometryResult {
  meshes: MeshData[];
  totalTriangles: number;
  totalVertices: number;
}

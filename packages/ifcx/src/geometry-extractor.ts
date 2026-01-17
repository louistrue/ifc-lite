/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Extractor for IFCX
 * Extracts USD-style mesh data and converts to MeshData format
 */

import type { ComposedNode, UsdMesh, UsdTransform } from './types.js';
import { ATTR } from './types.js';

/**
 * MeshData interface compatible with @ifc-lite/geometry
 */
export interface MeshData {
  expressId: number;
  ifcType?: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
}

/**
 * Extract geometry from composed IFCX nodes.
 *
 * IFC5 geometry is pre-tessellated (unlike IFC4 parametric geometry),
 * so this is straightforward mesh extraction.
 *
 * Note: Meshes are often on child nodes (like "Body", "Axis") that don't
 * have their own bsi::ifc::class. We associate these with the closest
 * ancestor entity that has an expressId.
 */
export function extractGeometry(
  composed: Map<string, ComposedNode>,
  pathToId: Map<string, number>
): MeshData[] {
  const meshes: MeshData[] = [];

  for (const node of composed.values()) {
    const mesh = node.attributes.get(ATTR.MESH) as UsdMesh | undefined;
    if (!mesh) continue;

    // Try to get expressId from this node, or walk up to parent entity
    const expressId = getExpressIdFromHierarchy(node, pathToId);
    if (expressId === undefined) continue;

    // Get IFC type from parent (mesh nodes are usually children of element nodes)
    const ifcType = getIfcTypeFromHierarchy(node);

    // Get accumulated transform
    const transform = getAccumulatedTransform(node);

    // Convert USD mesh to MeshData
    const meshData = convertUsdMesh(mesh, expressId, ifcType, transform);

    // Apply presentation attributes
    applyPresentation(meshData, node);

    meshes.push(meshData);
  }

  return meshes;
}

/**
 * Get expressId by walking up the hierarchy to find an entity with an ID.
 * This handles geometry on child nodes (like "Body") that don't have their own class.
 */
function getExpressIdFromHierarchy(
  node: ComposedNode,
  pathToId: Map<string, number>
): number | undefined {
  let current: ComposedNode | undefined = node;

  while (current) {
    const expressId = pathToId.get(current.path);
    if (expressId !== undefined) {
      return expressId;
    }
    current = current.parent;
  }

  return undefined;
}

/**
 * Get IFC type by walking up the hierarchy to find a classified element.
 */
function getIfcTypeFromHierarchy(node: ComposedNode): string | undefined {
  let current: ComposedNode | undefined = node;

  while (current) {
    const ifcClass = current.attributes.get(ATTR.CLASS) as { code?: string } | undefined;
    if (ifcClass?.code) {
      return ifcClass.code;
    }
    current = current.parent;
  }

  return undefined;
}

/**
 * Convert USD mesh format to MeshData format.
 */
function convertUsdMesh(
  usd: UsdMesh,
  expressId: number,
  ifcType: string | undefined,
  transform: Float32Array | null
): MeshData {
  // Flatten points array
  const positions = new Float32Array(usd.points.length * 3);
  for (let i = 0; i < usd.points.length; i++) {
    const [x, y, z] = usd.points[i];
    if (transform) {
      // Apply transform
      const [tx, ty, tz] = applyTransform(x, y, z, transform);
      positions[i * 3] = tx;
      positions[i * 3 + 1] = ty;
      positions[i * 3 + 2] = tz;
    } else {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
  }

  // Handle face vertex counts if present (for non-triangle faces)
  let indices: Uint32Array;
  if (usd.faceVertexCounts && usd.faceVertexCounts.length > 0) {
    indices = triangulatePolygons(usd.faceVertexIndices, usd.faceVertexCounts);
  } else {
    // Already triangle indices
    indices = new Uint32Array(usd.faceVertexIndices);
  }

  // Compute or use provided normals
  const normals = usd.normals
    ? flattenNormals(usd.normals, transform)
    : computeNormals(positions, indices);

  return {
    expressId,
    ifcType,
    positions,
    indices,
    normals,
    color: [0.8, 0.8, 0.8, 1.0], // Default gray, will be overridden by presentation
  };
}

/**
 * Triangulate polygon faces into triangles.
 */
function triangulatePolygons(faceVertexIndices: number[], faceVertexCounts: number[]): Uint32Array {
  const triangles: number[] = [];
  let indexOffset = 0;

  for (const count of faceVertexCounts) {
    // Fan triangulation
    const v0 = faceVertexIndices[indexOffset];
    for (let i = 1; i < count - 1; i++) {
      triangles.push(v0);
      triangles.push(faceVertexIndices[indexOffset + i]);
      triangles.push(faceVertexIndices[indexOffset + i + 1]);
    }
    indexOffset += count;
  }

  return new Uint32Array(triangles);
}

/**
 * Get accumulated transform from node to root.
 */
function getAccumulatedTransform(node: ComposedNode): Float32Array | null {
  const transforms: Float32Array[] = [];

  let current: ComposedNode | undefined = node;
  while (current) {
    const xform = current.attributes.get(ATTR.TRANSFORM) as UsdTransform | undefined;
    if (xform?.transform) {
      transforms.unshift(flattenMatrix(xform.transform));
    }
    current = current.parent;
  }

  if (transforms.length === 0) return null;
  if (transforms.length === 1) return transforms[0];

  // Multiply transforms (parent * child order)
  let result = transforms[0];
  for (let i = 1; i < transforms.length; i++) {
    result = multiplyMatrices(result, transforms[i]);
  }

  return result;
}

/**
 * Flatten 2D matrix array to 1D Float32Array.
 */
function flattenMatrix(m: number[][]): Float32Array {
  // USD uses row-major 4x4 matrices
  const result = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      result[row * 4 + col] = m[row]?.[col] ?? (row === col ? 1 : 0);
    }
  }
  return result;
}

/**
 * Apply 4x4 transform matrix to a point.
 */
function applyTransform(x: number, y: number, z: number, m: Float32Array): [number, number, number] {
  // Row-major matrix multiplication with perspective divide
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Apply presentation attributes (color, opacity) to mesh.
 */
function applyPresentation(mesh: MeshData, node: ComposedNode): void {
  // Check this node and its ancestors for presentation attributes
  let current: ComposedNode | undefined = node;

  while (current) {
    const diffuse = current.attributes.get(ATTR.DIFFUSE_COLOR) as number[] | undefined;
    const opacity = current.attributes.get(ATTR.OPACITY) as number | undefined;

    if (diffuse) {
      const [r, g, b] = diffuse;
      const a = opacity ?? 1.0;
      mesh.color = [r, g, b, a];
      return;
    }

    current = current.parent;
  }
}

/**
 * Compute normals from triangle mesh.
 */
function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    // Triangle vertices
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // Edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // Cross product
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate (will normalize later)
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }

  return normals;
}

/**
 * Flatten 2D normals array to 1D and optionally transform.
 */
function flattenNormals(normals: number[][], transform: Float32Array | null): Float32Array {
  const result = new Float32Array(normals.length * 3);

  // Extract rotation part of transform matrix (upper 3x3)
  const hasTransform = transform !== null;

  for (let i = 0; i < normals.length; i++) {
    let [nx, ny, nz] = normals[i];

    if (hasTransform && transform) {
      // Transform normal by upper 3x3 of matrix (rotation only)
      const tnx = transform[0] * nx + transform[4] * ny + transform[8] * nz;
      const tny = transform[1] * nx + transform[5] * ny + transform[9] * nz;
      const tnz = transform[2] * nx + transform[6] * ny + transform[10] * nz;

      // Renormalize
      const len = Math.sqrt(tnx ** 2 + tny ** 2 + tnz ** 2);
      if (len > 0) {
        nx = tnx / len;
        ny = tny / len;
        nz = tnz / len;
      } else {
        nx = tnx;
        ny = tny;
        nz = tnz;
      }
    }

    result[i * 3] = nx;
    result[i * 3 + 1] = ny;
    result[i * 3 + 2] = nz;
  }

  return result;
}

/**
 * Multiply two 4x4 matrices (row-major).
 */
function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      result[row * 4 + col] = sum;
    }
  }
  return result;
}

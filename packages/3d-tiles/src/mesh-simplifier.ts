/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mesh simplification via vertex clustering (grid-based decimation).
 *
 * For each input mesh the bounding box is subdivided into a uniform grid.
 * Every vertex is snapped to the nearest grid cell; all vertices that map to
 * the same cell are merged into a single representative vertex (centroid).
 * Degenerate triangles (where two or more indices collapse to the same cell)
 * are removed.
 *
 * This is a fast O(V+T) algorithm well suited for BIM geometry where
 * elements are typically boxes, extrusions, and cylinders.
 */

import type { MeshData } from '@ifc-lite/geometry';

export interface SimplificationOptions {
  /** Target ratio of triangles to keep (0-1). Default 0.25 (keep 25%). */
  targetRatio?: number;
  /** Minimum grid cells along the longest axis. Default 4. */
  minGridCells?: number;
  /** Maximum grid cells along the longest axis. Default 128. */
  maxGridCells?: number;
}

/**
 * Simplify an array of meshes using vertex clustering.
 * Returns a new set of simplified MeshData preserving expressId and color.
 */
export function simplifyMeshes(
  meshes: MeshData[],
  options: SimplificationOptions = {},
): MeshData[] {
  const result: MeshData[] = [];

  for (const mesh of meshes) {
    const simplified = simplifyMesh(mesh, options);
    if (simplified) {
      result.push(simplified);
    }
  }

  return result;
}

/**
 * Simplify a single mesh. Returns null if the mesh degenerates entirely.
 */
export function simplifyMesh(
  mesh: MeshData,
  options: SimplificationOptions = {},
): MeshData | null {
  const targetRatio = options.targetRatio ?? 0.25;
  const minCells = options.minGridCells ?? 4;
  const maxCells = options.maxGridCells ?? 128;

  const positions = mesh.positions;
  const normals = mesh.normals;
  const indices = mesh.indices;

  if (positions.length < 9 || indices.length < 3) return null;

  const vertexCount = positions.length / 3;
  const triCount = indices.length / 3;

  // Trivial meshes: return as-is
  if (triCount <= 4) {
    return {
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      color: mesh.color,
    };
  }

  // Compute mesh bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  const longestAxis = Math.max(sx, sy, sz);

  if (longestAxis < 1e-10) return null;

  // Determine grid resolution from target ratio.
  // For vertex clustering: gridCells ≈ cbrt(targetRatio * vertexCount)
  // This gives a grid that should produce roughly targetRatio of the original triangles.
  let gridCells = Math.round(Math.cbrt(targetRatio * vertexCount));
  gridCells = Math.max(minCells, Math.min(maxCells, gridCells));

  const cellSizeX = sx / gridCells || 1;
  const cellSizeY = sy / gridCells || 1;
  const cellSizeZ = sz / gridCells || 1;

  const gridX = Math.max(1, Math.ceil(sx / cellSizeX));
  const gridY = Math.max(1, Math.ceil(sy / cellSizeY));
  const gridZ = Math.max(1, Math.ceil(sz / cellSizeZ));

  // Map each vertex to a grid cell and accumulate for averaging
  const cellMap = new Map<number, {
    sumX: number; sumY: number; sumZ: number;
    sumNX: number; sumNY: number; sumNZ: number;
    count: number;
    newIndex: number;
  }>();

  const vertexToCellId = new Uint32Array(vertexCount);
  let nextNewIndex = 0;

  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];

    const cx = Math.min(Math.floor((px - minX) / cellSizeX), gridX - 1);
    const cy = Math.min(Math.floor((py - minY) / cellSizeY), gridY - 1);
    const cz = Math.min(Math.floor((pz - minZ) / cellSizeZ), gridZ - 1);

    const cellId = cx + cy * gridX + cz * gridX * gridY;
    vertexToCellId[v] = cellId;

    let cell = cellMap.get(cellId);
    if (!cell) {
      cell = {
        sumX: 0, sumY: 0, sumZ: 0,
        sumNX: 0, sumNY: 0, sumNZ: 0,
        count: 0,
        newIndex: nextNewIndex++,
      };
      cellMap.set(cellId, cell);
    }

    cell.sumX += px;
    cell.sumY += py;
    cell.sumZ += pz;

    if (normals.length > v * 3 + 2) {
      cell.sumNX += normals[v * 3];
      cell.sumNY += normals[v * 3 + 1];
      cell.sumNZ += normals[v * 3 + 2];
    }

    cell.count++;
  }

  // Build new vertex arrays
  const newVertexCount = cellMap.size;
  const newPositions = new Float32Array(newVertexCount * 3);
  const newNormals = new Float32Array(newVertexCount * 3);

  for (const cell of cellMap.values()) {
    const idx = cell.newIndex * 3;
    newPositions[idx] = cell.sumX / cell.count;
    newPositions[idx + 1] = cell.sumY / cell.count;
    newPositions[idx + 2] = cell.sumZ / cell.count;

    // Normalize the averaged normal
    let nx = cell.sumNX, ny = cell.sumNY, nz = cell.sumNZ;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-10) {
      nx /= len; ny /= len; nz /= len;
    } else {
      nx = 0; ny = 0; nz = 1;
    }
    newNormals[idx] = nx;
    newNormals[idx + 1] = ny;
    newNormals[idx + 2] = nz;
  }

  // Remap indices and discard degenerate triangles
  const newIndices: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const cellA = cellMap.get(vertexToCellId[indices[t]])!;
    const cellB = cellMap.get(vertexToCellId[indices[t + 1]])!;
    const cellC = cellMap.get(vertexToCellId[indices[t + 2]])!;

    const a = cellA.newIndex;
    const b = cellB.newIndex;
    const c = cellC.newIndex;

    // Skip degenerate triangles
    if (a !== b && b !== c && a !== c) {
      newIndices.push(a, b, c);
    }
  }

  if (newIndices.length < 3) return null;

  return {
    expressId: mesh.expressId,
    ifcType: mesh.ifcType,
    modelIndex: mesh.modelIndex,
    positions: newPositions,
    normals: newNormals,
    indices: new Uint32Array(newIndices),
    color: mesh.color,
  };
}

/**
 * Create a single merged and simplified mesh from multiple meshes.
 * Used to generate LOD content for parent tiles.
 * Returns simplified meshes (one per input) rather than one merged mesh,
 * to preserve per-element expressId tracking.
 */
export function simplifyForParentTile(
  meshes: MeshData[],
  parentDepth: number,
  maxDepth: number,
): MeshData[] {
  // More aggressive simplification for higher parent tiles (closer to root)
  // Root gets ~5% of geometry, mid-levels ~15-25%
  const depthFraction = maxDepth > 0 ? parentDepth / maxDepth : 0;
  const targetRatio = 0.05 + 0.20 * depthFraction; // 5% at root -> 25% at deepest parent

  return simplifyMeshes(meshes, {
    targetRatio,
    minGridCells: 2,
    maxGridCells: 64,
  });
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Spatial index builder - builds BVH from geometry results
 */

import { BVH, type MeshWithBounds } from './bvh.js';
import type { AABB } from './aabb.js';
import type { MeshData } from '@ifc-lite/geometry';

/**
 * Build BVH spatial index from geometry meshes
 */
export function buildSpatialIndex(meshes: MeshData[]): BVH {
  const meshesWithBounds: MeshWithBounds[] = meshes.map(mesh => {
    const bounds = computeMeshBounds(mesh);
    return {
      expressId: mesh.expressId,
      bounds,
    };
  });

  return BVH.build(meshesWithBounds);
}

/**
 * Compute AABB bounds for a mesh from its positions
 */
function computeMeshBounds(mesh: MeshData): AABB {
  const positions = mesh.positions;
  
  if (positions.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  // Positions are stored as [x, y, z, x, y, z, ...]
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.spatial — Spatial queries (BVH-accelerated)
 *
 * Provides AABB queries, raycasting, and frustum culling against the
 * spatial index built from model geometry.
 *
 * All methods return EntityRef[] — local express IDs scoped to their model.
 */

import type { BimBackend, EntityRef, AABB, SpatialFrustum } from '../types.js';

/** bim.spatial — Spatial queries on model geometry */
export class SpatialNamespace {
  constructor(private backend: BimBackend) {}

  queryBounds(modelId: string, bounds: AABB): EntityRef[] {
    return this.backend.spatial.queryBounds(modelId, bounds);
  }

  raycast(modelId: string, origin: [number, number, number], direction: [number, number, number]): EntityRef[] {
    return this.backend.spatial.raycast(modelId, origin, direction);
  }

  queryFrustum(modelId: string, frustum: SpatialFrustum): EntityRef[] {
    return this.backend.spatial.queryFrustum(modelId, frustum);
  }

  /** Convenience: find entities near a point within a radius. */
  queryRadius(modelId: string, center: [number, number, number], radius: number): EntityRef[] {
    const bounds: AABB = {
      min: [center[0] - radius, center[1] - radius, center[2] - radius],
      max: [center[0] + radius, center[1] + radius, center[2] + radius],
    };
    return this.backend.spatial.queryBounds(modelId, bounds);
  }
}

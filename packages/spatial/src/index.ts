/**
 * @ifc-lite/spatial - Spatial indexing
 */

export { AABBUtils } from './aabb.js';
export type { AABB } from './aabb.js';
export { BVH, type BVHNode, type MeshWithBounds } from './bvh.js';
export { FrustumUtils, type Frustum, type Plane } from './frustum.js';
export { buildSpatialIndex } from './spatial-index-builder.js';

import type { AABB } from './aabb.js';

/**
 * Spatial index interface for IfcDataStore
 * Matches BVH interface for type-safe integration
 */
export interface SpatialIndex {
    /**
     * Query AABB - returns expressIds of meshes that intersect the query bounds
     */
    queryAABB(bounds: AABB): number[];

    /**
     * Raycast - returns expressIds of meshes hit by ray
     */
    raycast(origin: [number, number, number], direction: [number, number, number]): number[];
}

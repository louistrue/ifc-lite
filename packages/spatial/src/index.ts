/**
 * @ifc-lite/spatial - Spatial indexing
 */

export { AABBUtils } from './aabb.js';
export type { AABB } from './aabb.js';
export { BVH, type BVHNode, type MeshWithBounds } from './bvh.js';
export { FrustumUtils, type Frustum, type Plane } from './frustum.js';
export { buildSpatialIndex } from './spatial-index-builder.js';

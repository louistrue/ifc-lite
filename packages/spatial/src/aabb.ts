/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Axis-aligned bounding box
 */

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export class AABBUtils {
  /**
   * Check if two AABBs intersect
   */
  static intersects(a: AABB, b: AABB): boolean {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
           a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
           a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  }
  
  /**
   * Compute union of two AABBs
   */
  static union(a: AABB, b: AABB): AABB {
    return {
      min: [
        Math.min(a.min[0], b.min[0]),
        Math.min(a.min[1], b.min[1]),
        Math.min(a.min[2], b.min[2]),
      ],
      max: [
        Math.max(a.max[0], b.max[0]),
        Math.max(a.max[1], b.max[1]),
        Math.max(a.max[2], b.max[2]),
      ],
    };
  }
  
  /**
   * Compute center of AABB
   */
  static center(aabb: AABB): [number, number, number] {
    return [
      (aabb.min[0] + aabb.max[0]) / 2,
      (aabb.min[1] + aabb.max[1]) / 2,
      (aabb.min[2] + aabb.max[2]) / 2,
    ];
  }
  
  /**
   * Compute size of AABB
   */
  static size(aabb: AABB): [number, number, number] {
    return [
      aabb.max[0] - aabb.min[0],
      aabb.max[1] - aabb.min[1],
      aabb.max[2] - aabb.min[2],
    ];
  }
  
  /**
   * Compute surface area of AABB
   */
  static surfaceArea(aabb: AABB): number {
    const [w, h, d] = this.size(aabb);
    return 2 * (w * h + w * d + h * d);
  }
  
  /**
   * Check if point is inside AABB
   */
  static contains(aabb: AABB, point: [number, number, number]): boolean {
    return point[0] >= aabb.min[0] && point[0] <= aabb.max[0] &&
           point[1] >= aabb.min[1] && point[1] <= aabb.max[1] &&
           point[2] >= aabb.min[2] && point[2] <= aabb.max[2];
  }
}

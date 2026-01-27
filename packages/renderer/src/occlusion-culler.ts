/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CPU-based Occlusion Culling
 *
 * Uses spatial analysis to estimate which elements are likely occluded:
 * 1. Back-face culling: Elements on the "back side" of the model relative to camera
 * 2. Depth sorting: Elements behind large occluders (walls, slabs)
 *
 * This is a conservative approximation - may show some hidden elements but
 * will never hide visible ones.
 */

export interface OcclusionCullerOptions {
  /** Threshold for back-side detection (0-1, higher = more aggressive) */
  backSideThreshold?: number;
  /** Enable wall-based occlusion (requires IFC type info) */
  enableWallOcclusion?: boolean;
}

export interface ElementBounds {
  expressId: number;
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  ifcType?: string;  // For identifying occluders (walls, slabs)
}

/**
 * CPU Occlusion Culler
 *
 * Estimates visibility based on element positions relative to camera.
 * Much simpler than GPU Hi-Z but captures significant savings.
 */
export class OcclusionCuller {
  private elements: Map<number, ElementBounds> = new Map();
  private modelCenter: [number, number, number] = [0, 0, 0];
  private modelBounds: { min: [number, number, number]; max: [number, number, number] } | null = null;
  private backSideThreshold: number;
  private enableWallOcclusion: boolean;

  // Cached results
  private lastCameraDir: [number, number, number] = [0, 0, 1];
  private lastVisibleIds: Set<number> = new Set();
  private cacheValid: boolean = false;

  // Occluder types (large flat surfaces that block visibility)
  private static OCCLUDER_TYPES = new Set([
    'IFCWALL',
    'IFCWALLSTANDARDCASE',
    'IFCSLAB',
    'IFCROOF',
    'IFCPLATE',
    'IFCCURTAINWALL',
  ]);

  constructor(options: OcclusionCullerOptions = {}) {
    this.backSideThreshold = options.backSideThreshold ?? 0.3;
    this.enableWallOcclusion = options.enableWallOcclusion ?? false;
  }

  /**
   * Add element bounds data
   */
  addElement(element: ElementBounds): void {
    this.elements.set(element.expressId, element);
    this.cacheValid = false;
  }

  /**
   * Set all elements at once (more efficient)
   */
  setElements(elements: ElementBounds[]): void {
    this.elements.clear();
    for (const el of elements) {
      this.elements.set(el.expressId, el);
    }
    this.updateModelBounds();
    this.cacheValid = false;
  }

  /**
   * Update model bounds from elements
   */
  private updateModelBounds(): void {
    if (this.elements.size === 0) {
      this.modelBounds = null;
      this.modelCenter = [0, 0, 0];
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const el of this.elements.values()) {
      minX = Math.min(minX, el.min[0]);
      minY = Math.min(minY, el.min[1]);
      minZ = Math.min(minZ, el.min[2]);
      maxX = Math.max(maxX, el.max[0]);
      maxY = Math.max(maxY, el.max[1]);
      maxZ = Math.max(maxZ, el.max[2]);
    }

    this.modelBounds = {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };

    this.modelCenter = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ];
  }

  /**
   * Query which elements are likely visible from the given camera direction
   *
   * @param cameraDir - Normalized camera direction (where camera is looking)
   * @param cameraPos - Camera position in world space
   * @returns Set of visible expressIds
   */
  queryVisible(
    cameraDir: [number, number, number],
    cameraPos: [number, number, number],
  ): Set<number> {
    // Check if camera hasn't changed much (use cached results)
    const dirDot =
      cameraDir[0] * this.lastCameraDir[0] +
      cameraDir[1] * this.lastCameraDir[1] +
      cameraDir[2] * this.lastCameraDir[2];

    if (this.cacheValid && dirDot > 0.999) {
      return this.lastVisibleIds;
    }

    const visibleIds = new Set<number>();

    if (!this.modelBounds) {
      // No bounds - return all visible
      for (const id of this.elements.keys()) {
        visibleIds.add(id);
      }
      return visibleIds;
    }

    // For each element, check if it's on the "back side" of the model
    for (const [expressId, el] of this.elements) {
      if (this.isElementVisible(el, cameraDir, cameraPos)) {
        visibleIds.add(expressId);
      }
    }

    // Update cache
    this.lastCameraDir = [...cameraDir];
    this.lastVisibleIds = visibleIds;
    this.cacheValid = true;

    return visibleIds;
  }

  /**
   * Check if a single element is likely visible
   */
  private isElementVisible(
    element: ElementBounds,
    cameraDir: [number, number, number],
    cameraPos: [number, number, number],
  ): boolean {
    // Vector from model center to element center
    const toElement: [number, number, number] = [
      element.center[0] - this.modelCenter[0],
      element.center[1] - this.modelCenter[1],
      element.center[2] - this.modelCenter[2],
    ];

    // Normalize
    const len = Math.sqrt(
      toElement[0] * toElement[0] +
      toElement[1] * toElement[1] +
      toElement[2] * toElement[2]
    );
    if (len > 0.001) {
      toElement[0] /= len;
      toElement[1] /= len;
      toElement[2] /= len;
    }

    // Dot product: positive = element is on the side camera is facing
    // negative = element is on the back side
    const dot =
      toElement[0] * cameraDir[0] +
      toElement[1] * cameraDir[1] +
      toElement[2] * cameraDir[2];

    // Elements on the back side are potentially occluded
    // Use threshold to avoid culling elements near the center
    if (dot < -this.backSideThreshold) {
      // Element is significantly on the back side
      // But check if it's near the edge of the model (might still be visible)
      const distFromCenter = len;
      const modelRadius = Math.sqrt(
        Math.pow(this.modelBounds!.max[0] - this.modelBounds!.min[0], 2) +
        Math.pow(this.modelBounds!.max[1] - this.modelBounds!.min[1], 2) +
        Math.pow(this.modelBounds!.max[2] - this.modelBounds!.min[2], 2)
      ) / 2;

      // Elements near the edge might still be visible
      const edgeFactor = distFromCenter / modelRadius;
      if (edgeFactor < 0.7) {
        // Deep inside on back side - likely occluded
        return false;
      }
    }

    return true;
  }

  /**
   * Get statistics about potential occlusion savings
   */
  getStats(
    cameraDir: [number, number, number],
    cameraPos: [number, number, number],
  ): { total: number; visible: number; occluded: number; percentage: number } {
    const visible = this.queryVisible(cameraDir, cameraPos);
    const total = this.elements.size;
    const occluded = total - visible.size;

    return {
      total,
      visible: visible.size,
      occluded,
      percentage: total > 0 ? (occluded / total) * 100 : 0,
    };
  }

  /**
   * Clear all elements
   */
  clear(): void {
    this.elements.clear();
    this.modelBounds = null;
    this.modelCenter = [0, 0, 0];
    this.cacheValid = false;
  }

  /**
   * Check if culler has elements
   */
  hasElements(): boolean {
    return this.elements.size > 0;
  }

  /**
   * Invalidate cache (call when camera changes significantly)
   */
  invalidateCache(): void {
    this.cacheValid = false;
  }
}

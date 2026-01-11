/**
 * Coordinate Handler - handles large coordinate systems by shifting to origin
 * 
 * AEC models often use real-world coordinates (UTM, survey coordinates) with
 * values like X: 500,000m, Y: 5,000,000m. This causes float precision issues.
 * 
 * Solution: Shift model to local origin (centroid) while preserving original
 * coordinates for export/queries.
 */

import type { MeshData } from './types.js';

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
  originShift: Vec3;
  originalBounds: AABB;
  shiftedBounds: AABB;
  isGeoReferenced: boolean;
}

export class CoordinateHandler {
  private originShift: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly THRESHOLD = 10000; // 10km - threshold for large coordinates
  // Maximum reasonable coordinate - 10,000 km covers any georeferenced building on Earth
  // Values beyond this are garbage/corrupted data (safety net)
  private readonly MAX_REASONABLE_COORD = 1e7;

  /**
   * Check if a coordinate value is reasonable (not corrupted garbage)
   */
  private isReasonableValue(value: number): boolean {
    return Number.isFinite(value) && Math.abs(value) < this.MAX_REASONABLE_COORD;
  }

  /**
   * Calculate bounding box from all meshes (filtering out corrupted values)
   */
  calculateBounds(meshes: MeshData[]): AABB {
    const bounds: AABB = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };

    let validVertexCount = 0;
    let corruptedVertexCount = 0;

    for (const mesh of meshes) {
      const positions = mesh.positions;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];

        // Only include reasonable values (filter out corrupted garbage)
        if (this.isReasonableValue(x) && this.isReasonableValue(y) && this.isReasonableValue(z)) {
          bounds.min.x = Math.min(bounds.min.x, x);
          bounds.min.y = Math.min(bounds.min.y, y);
          bounds.min.z = Math.min(bounds.min.z, z);
          bounds.max.x = Math.max(bounds.max.x, x);
          bounds.max.y = Math.max(bounds.max.y, y);
          bounds.max.z = Math.max(bounds.max.z, z);
          validVertexCount++;
        } else {
          corruptedVertexCount++;
        }
      }
    }

    if (corruptedVertexCount > 0) {
      console.log(`[CoordinateHandler] Filtered ${corruptedVertexCount} corrupted vertices, kept ${validVertexCount} valid`);
    }

    return bounds;
  }

  /**
   * Check if coordinate shift is needed
   */
  needsShift(bounds: AABB): boolean {
    const maxCoord = Math.max(
      Math.abs(bounds.min.x), Math.abs(bounds.max.x),
      Math.abs(bounds.min.y), Math.abs(bounds.max.y),
      Math.abs(bounds.min.z), Math.abs(bounds.max.z)
    );

    return maxCoord > this.THRESHOLD;
  }

  /**
   * Calculate centroid (center point) from bounds
   */
  calculateCentroid(bounds: AABB): Vec3 {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
  }

  /**
   * Shift positions in-place by subtracting origin shift
   * Corrupted values are set to 0 (center of shifted coordinate system)
   */
  shiftPositions(positions: Float32Array, shift: Vec3): void {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      // For corrupted values, set to center (0) in shifted space
      if (this.isReasonableValue(x) && this.isReasonableValue(y) && this.isReasonableValue(z)) {
        positions[i] = x - shift.x;
        positions[i + 1] = y - shift.y;
        positions[i + 2] = z - shift.z;
      } else {
        // Corrupted vertex - set to origin to avoid visual artifacts
        positions[i] = 0;
        positions[i + 1] = 0;
        positions[i + 2] = 0;
      }
    }
  }

  /**
   * Shift bounds by subtracting origin shift
   */
  shiftBounds(bounds: AABB, shift: Vec3): AABB {
    return {
      min: {
        x: bounds.min.x - shift.x,
        y: bounds.min.y - shift.y,
        z: bounds.min.z - shift.z,
      },
      max: {
        x: bounds.max.x - shift.x,
        y: bounds.max.y - shift.y,
        z: bounds.max.z - shift.z,
      },
    };
  }

  /**
   * Process meshes: detect large coordinates and shift if needed
   */
  processMeshes(meshes: MeshData[]): CoordinateInfo {
    const emptyResult: CoordinateInfo = {
      originShift: { x: 0, y: 0, z: 0 },
      originalBounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
      shiftedBounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
      isGeoReferenced: false,
    };

    if (meshes.length === 0) {
      return emptyResult;
    }

    // Calculate original bounds (filtering corrupted values)
    const originalBounds = this.calculateBounds(meshes);

    // Check if we got valid bounds
    const hasValidBounds = 
      originalBounds.min.x !== Infinity && originalBounds.max.x !== -Infinity;

    if (!hasValidBounds) {
      console.warn('[CoordinateHandler] No valid coordinates found in geometry');
      return emptyResult;
    }

    const size = {
      x: originalBounds.max.x - originalBounds.min.x,
      y: originalBounds.max.y - originalBounds.min.y,
      z: originalBounds.max.z - originalBounds.min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);

    console.log('[CoordinateHandler] Original bounds:', {
      min: originalBounds.min,
      max: originalBounds.max,
      size,
      maxSize: maxSize.toFixed(2) + 'm',
    });

    // Check if shift is needed (>10km from origin)
    const needsShift = this.needsShift(originalBounds);

    if (!needsShift) {
      // No shift needed - just clean up corrupted values in-place
      console.log('[CoordinateHandler] Coordinates within normal range, no shift needed');
      // Still shift by 0 to clean up corrupted vertices
      const zeroShift = { x: 0, y: 0, z: 0 };
      for (const mesh of meshes) {
        this.shiftPositions(mesh.positions, zeroShift);
      }
      return {
        originShift: zeroShift,
        originalBounds,
        shiftedBounds: originalBounds,
        isGeoReferenced: false,
      };
    }

    // Calculate centroid as origin shift
    const centroid = this.calculateCentroid(originalBounds);
    this.originShift = centroid;

    console.log('[CoordinateHandler] Large coordinates detected, shifting to origin:', {
      centroid,
      maxCoord: Math.max(
        Math.abs(originalBounds.min.x), Math.abs(originalBounds.max.x),
        Math.abs(originalBounds.min.y), Math.abs(originalBounds.max.y),
        Math.abs(originalBounds.min.z), Math.abs(originalBounds.max.z)
      ).toFixed(2) + 'm',
    });

    // Shift all mesh positions
    for (const mesh of meshes) {
      this.shiftPositions(mesh.positions, centroid);
    }

    // Calculate shifted bounds
    const shiftedBounds = this.shiftBounds(originalBounds, centroid);

    console.log('[CoordinateHandler] Shifted bounds:', {
      min: shiftedBounds.min,
      max: shiftedBounds.max,
      maxSize: maxSize.toFixed(2) + 'm',
    });

    return {
      originShift: centroid,
      originalBounds,
      shiftedBounds,
      isGeoReferenced: true,
    };
  }

  /**
   * Convert local (shifted) coordinates back to world coordinates
   */
  toWorldCoordinates(localPos: Vec3): Vec3 {
    return {
      x: localPos.x + this.originShift.x,
      y: localPos.y + this.originShift.y,
      z: localPos.z + this.originShift.z,
    };
  }

  /**
   * Convert world coordinates to local (shifted) coordinates
   */
  toLocalCoordinates(worldPos: Vec3): Vec3 {
    return {
      x: worldPos.x - this.originShift.x,
      y: worldPos.y - this.originShift.y,
      z: worldPos.z - this.originShift.z,
    };
  }

  /**
   * Get current origin shift
   */
  getOriginShift(): Vec3 {
    return { ...this.originShift };
  }
}

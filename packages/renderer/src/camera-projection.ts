/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera projection utilities for screen/world coordinate conversion
 * and view fitting. Extracted from Camera class using composition pattern.
 */

import type { Vec3 } from './types.js';
import type { CameraInternalState } from './camera-controls.js';
import { MathUtils } from './math.js';

/**
 * Handles projection math: screen-to-world and world-to-screen conversions,
 * bounding box fitting, and near/far plane management.
 */
export class CameraProjection {
  constructor(
    private readonly state: CameraInternalState,
    private readonly updateMatrices: () => void,
  ) {}

  /**
   * Project a world position to screen coordinates
   * @param worldPos - Position in world space
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @returns Screen coordinates { x, y } or null if behind camera
   */
  projectToScreen(worldPos: Vec3, canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
    // Transform world position by view-projection matrix
    const m = this.state.viewProjMatrix.m;

    // Manual matrix-vector multiplication for vec4(worldPos, 1.0)
    const clipX = m[0] * worldPos.x + m[4] * worldPos.y + m[8] * worldPos.z + m[12];
    const clipY = m[1] * worldPos.x + m[5] * worldPos.y + m[9] * worldPos.z + m[13];
    const clipZ = m[2] * worldPos.x + m[6] * worldPos.y + m[10] * worldPos.z + m[14];
    const clipW = m[3] * worldPos.x + m[7] * worldPos.y + m[11] * worldPos.z + m[15];

    // Check if behind camera
    if (clipW <= 0) {
      return null;
    }

    // Perspective divide to get NDC
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;

    // Check if outside clip volume
    if (ndcZ < -1 || ndcZ > 1) {
      return null;
    }

    // Convert NDC to screen coordinates
    // NDC: (-1,-1) = bottom-left, (1,1) = top-right
    // Screen: (0,0) = top-left, (width, height) = bottom-right
    const screenX = (ndcX + 1) * 0.5 * canvasWidth;
    const screenY = (1 - ndcY) * 0.5 * canvasHeight; // Flip Y

    return { x: screenX, y: screenY };
  }

  /**
   * Unproject screen coordinates to a ray in world space
   * @param screenX - X position in screen coordinates
   * @param screenY - Y position in screen coordinates
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @returns Ray origin and direction in world space
   */
  unprojectToRay(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): { origin: Vec3; direction: Vec3 } {
    // Convert screen coords to NDC (-1 to 1)
    const ndcX = (screenX / canvasWidth) * 2 - 1;
    const ndcY = 1 - (screenY / canvasHeight) * 2; // Flip Y

    if (this.state.projectionMode === 'orthographic') {
      // Orthographic: rays are parallel. Origin varies with screen position.
      const halfH = this.state.orthoSize;
      const halfW = halfH * this.state.camera.aspect;

      // Forward direction (camera towards target)
      const forward = MathUtils.normalize({
        x: this.state.camera.target.x - this.state.camera.position.x,
        y: this.state.camera.target.y - this.state.camera.position.y,
        z: this.state.camera.target.z - this.state.camera.position.z,
      });

      // Right = forward x up
      const right = MathUtils.normalize(MathUtils.cross(forward, this.state.camera.up));
      // Actual up = right x forward
      const actualUp = MathUtils.cross(right, forward);

      // Ray origin: camera position offset by NDC * view extents
      const origin = {
        x: this.state.camera.position.x + right.x * ndcX * halfW + actualUp.x * ndcY * halfH,
        y: this.state.camera.position.y + right.y * ndcX * halfW + actualUp.y * ndcY * halfH,
        z: this.state.camera.position.z + right.z * ndcX * halfW + actualUp.z * ndcY * halfH,
      };

      return { origin, direction: forward };
    }

    // Perspective: ray origin is always the camera position
    // Direction is computed through the screen point

    // Invert the view-projection matrix
    const invViewProj = MathUtils.invert(this.state.viewProjMatrix);
    if (!invViewProj) {
      // Fallback: return ray from camera position towards target
      const dir = MathUtils.normalize({
        x: this.state.camera.target.x - this.state.camera.position.x,
        y: this.state.camera.target.y - this.state.camera.position.y,
        z: this.state.camera.target.z - this.state.camera.position.z,
      });
      return { origin: { ...this.state.camera.position }, direction: dir };
    }

    // Unproject a point at some depth to get a point on the ray
    // Using z=0.5 (midpoint in Reverse-Z: 1.0=near, 0.0=far) to get a finite point
    const worldPoint = MathUtils.transformPoint(invViewProj, { x: ndcX, y: ndcY, z: 0.5 });

    // Ray origin is camera position, direction is towards unprojected point
    const origin = { ...this.state.camera.position };
    const direction = MathUtils.normalize({
      x: worldPoint.x - origin.x,
      y: worldPoint.y - origin.y,
      z: worldPoint.z - origin.z,
    });

    return { origin, direction };
  }

  /**
   * Fit view to bounding box
   * Sets camera to southeast isometric view (typical BIM starting view)
   * Y-up coordinate system: Y is vertical
   */
  fitToBounds(min: Vec3, max: Vec3): void {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize * 2.0;

    this.state.camera.target = center;

    // Southeast isometric view for Y-up:
    // Position camera above and to the front-right of the model
    this.state.camera.position = {
      x: center.x + distance * 0.6,   // Right
      y: center.y + distance * 0.5,   // Above
      z: center.z + distance * 0.6,   // Front
    };

    // near/far are computed dynamically in updateMatrices() based on distance
    this.updateMatrices();
  }

  /**
   * Update near/far planes dynamically based on camera distance.
   * Now a no-op since updateMatrices() handles this automatically.
   * Kept for API compatibility with CameraAnimator.
   */
  updateNearFarPlanes(_distance: number): void {
    // near/far are computed dynamically in Camera.updateMatrices()
  }
}

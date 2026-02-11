/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera orbit, pan, and zoom controls with spherical coordinate math.
 * Extracted from Camera class using composition pattern.
 */

import type { Camera as CameraType, Vec3, Mat4 } from './types.js';

/** Projection mode for the camera */
export type ProjectionMode = 'perspective' | 'orthographic';

/**
 * Shared mutable state for camera sub-systems.
 * All sub-systems reference the same state object so changes are visible across them.
 */
export interface CameraInternalState {
  camera: CameraType;
  viewMatrix: Mat4;
  projMatrix: Mat4;
  viewProjMatrix: Mat4;
  /** Current projection mode */
  projectionMode: ProjectionMode;
  /** Orthographic half-height in world units (controls zoom level in ortho mode) */
  orthoSize: number;
}

/**
 * Handles core camera movement: orbit, pan, and zoom.
 * Uses spherical coordinates for orbit with Y-up convention.
 */
export class CameraControls {
  /** Dynamic orbit pivot (for orbiting around selected element or cursor point) */
  private orbitPivot: Vec3 | null = null;

  constructor(
    private readonly state: CameraInternalState,
    private readonly updateMatrices: () => void,
  ) {}

  /**
   * Set temporary orbit pivot (for orbiting around selected element or cursor point)
   * When set, orbit() will rotate around this point instead of the camera target
   */
  setOrbitPivot(pivot: Vec3 | null): void {
    this.orbitPivot = pivot ? { ...pivot } : null;
  }

  /**
   * Get current orbit pivot (returns temporary pivot if set, otherwise target)
   */
  getOrbitPivot(): Vec3 {
    return this.orbitPivot ? { ...this.orbitPivot } : { ...this.state.camera.target };
  }

  /**
   * Check if a temporary orbit pivot is set
   */
  hasOrbitPivot(): boolean {
    return this.orbitPivot !== null;
  }

  /**
   * Clear the orbit pivot
   */
  clearOrbitPivot(): void {
    this.orbitPivot = null;
  }

  /**
   * Orbit around target or pivot (Y-up coordinate system).
   * If an orbit pivot is set, orbits around that point.
   *
   * Note: Does not handle velocity or preset view tracking;
   * the Camera class coordinates those concerns.
   */
  orbit(deltaX: number, deltaY: number): void {
    // Always ensure Y-up for consistent orbit behavior
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    // Invert controls: mouse movement direction = model rotation direction
    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    // Use orbit pivot if set, otherwise use target
    const pivotPoint = this.orbitPivot || this.state.camera.target;

    const dir = {
      x: this.state.camera.position.x - pivotPoint.x,
      y: this.state.camera.position.y - pivotPoint.y,
      z: this.state.camera.position.z - pivotPoint.z,
    };

    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (distance < 1e-6) return;

    // Y-up coordinate system using standard spherical coordinates
    // theta: horizontal rotation around Y axis
    // phi: vertical angle from Y axis (0 = top, PI = bottom)
    let currentPhi = Math.acos(Math.max(-1, Math.min(1, dir.y / distance)));

    // When at poles (top/bottom view), use a stable theta based on current direction
    // to avoid gimbal lock issues
    let theta: number;
    const sinPhi = Math.sin(currentPhi);
    if (sinPhi > 0.05) {
      // Normal case - calculate theta from horizontal position
      theta = Math.atan2(dir.x, dir.z);
    } else {
      // At a pole - determine which one and push away
      theta = 0; // Default theta when at pole
      if (currentPhi < Math.PI / 2) {
        // Top pole (phi ~ 0) - push down
        currentPhi = 0.15;
      } else {
        // Bottom pole (phi ~ PI) - push up
        currentPhi = Math.PI - 0.15;
      }
    }

    theta += dx;
    const phi = currentPhi + dy;

    // Clamp phi to prevent gimbal lock (stay away from exact poles)
    const phiClamped = Math.max(0.15, Math.min(Math.PI - 0.15, phi));

    // Calculate new camera position around pivot
    const newPosX = pivotPoint.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    const newPosY = pivotPoint.y + distance * Math.cos(phiClamped);
    const newPosZ = pivotPoint.z + distance * Math.sin(phiClamped) * Math.cos(theta);

    // Update camera position
    this.state.camera.position.x = newPosX;
    this.state.camera.position.y = newPosY;
    this.state.camera.position.z = newPosZ;

    this.updateMatrices();
  }

  /**
   * Pan camera (Y-up coordinate system).
   *
   * Note: Does not handle velocity; the Camera class coordinates that.
   */
  pan(deltaX: number, deltaY: number): void {
    const dir = {
      x: this.state.camera.position.x - this.state.camera.target.x,
      y: this.state.camera.position.y - this.state.camera.target.y,
      z: this.state.camera.position.z - this.state.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Right vector: cross product of direction and up (0,1,0)
    const right = {
      x: -dir.z,
      y: 0,
      z: dir.x,
    };
    const rightLen = Math.sqrt(right.x * right.x + right.z * right.z);
    if (rightLen > 1e-10) {
      right.x /= rightLen;
      right.z /= rightLen;
    }

    // Up vector: cross product of right and direction
    const up = {
      x: (right.z * dir.y - right.y * dir.z),
      y: (right.x * dir.z - right.z * dir.x),
      z: (right.y * dir.x - right.x * dir.y),
    };
    const upLen = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
    if (upLen > 1e-10) {
      up.x /= upLen;
      up.y /= upLen;
      up.z /= upLen;
    }

    const panSpeed = distance * 0.001;
    this.state.camera.target.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.state.camera.target.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.state.camera.target.z += (right.z * deltaX + up.z * deltaY) * panSpeed;
    this.state.camera.position.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.state.camera.position.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.state.camera.position.z += (right.z * deltaX + up.z * deltaY) * panSpeed;

    this.updateMatrices();
  }

  /**
   * Zoom camera towards mouse position.
   * @param delta - Zoom delta (positive = zoom out, negative = zoom in)
   * @param mouseX - Mouse X position in canvas coordinates
   * @param mouseY - Mouse Y position in canvas coordinates
   * @param canvasWidth - Canvas width
   * @param canvasHeight - Canvas height
   *
   * Note: Does not handle velocity; the Camera class coordinates that.
   */
  zoom(delta: number, mouseX?: number, mouseY?: number, canvasWidth?: number, canvasHeight?: number): void {
    const dir = {
      x: this.state.camera.position.x - this.state.camera.target.x,
      y: this.state.camera.position.y - this.state.camera.target.y,
      z: this.state.camera.position.z - this.state.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    // Normalize delta (wheel events can have large values)
    const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.1);
    const zoomFactor = 1 + normalizedDelta;

    // If mouse position provided, zoom towards that point
    if (mouseX !== undefined && mouseY !== undefined && canvasWidth && canvasHeight) {
      // Convert mouse to normalized device coordinates (-1 to 1)
      const ndcX = (mouseX / canvasWidth) * 2 - 1;
      const ndcY = 1 - (mouseY / canvasHeight) * 2; // Flip Y

      // Calculate offset from center in world space
      // Use the camera's right and up vectors
      const forward = {
        x: -dir.x / distance,
        y: -dir.y / distance,
        z: -dir.z / distance,
      };

      // Right = forward x up
      const up = this.state.camera.up;
      const right = {
        x: forward.y * up.z - forward.z * up.y,
        y: forward.z * up.x - forward.x * up.z,
        z: forward.x * up.y - forward.y * up.x,
      };
      const rightLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
      if (rightLen > 1e-10) {
        right.x /= rightLen;
        right.y /= rightLen;
        right.z /= rightLen;
      }

      // Actual up = right x forward
      const actualUp = {
        x: right.y * forward.z - right.z * forward.y,
        y: right.z * forward.x - right.x * forward.z,
        z: right.x * forward.y - right.y * forward.x,
      };

      // Calculate view frustum size at target distance
      const halfHeight = this.state.projectionMode === 'orthographic'
        ? this.state.orthoSize
        : distance * Math.tan(this.state.camera.fov / 2);
      const halfWidth = halfHeight * this.state.camera.aspect;

      // World offset from center towards mouse position
      const worldOffsetX = ndcX * halfWidth;
      const worldOffsetY = ndcY * halfHeight;

      // Point in world space that mouse is pointing at (on the target plane)
      const mouseWorldPoint = {
        x: this.state.camera.target.x + right.x * worldOffsetX + actualUp.x * worldOffsetY,
        y: this.state.camera.target.y + right.y * worldOffsetX + actualUp.y * worldOffsetY,
        z: this.state.camera.target.z + right.z * worldOffsetX + actualUp.z * worldOffsetY,
      };

      // Move both camera and target towards mouse point while zooming
      const moveAmount = (1 - zoomFactor); // Negative when zooming in

      this.state.camera.target.x += (mouseWorldPoint.x - this.state.camera.target.x) * moveAmount;
      this.state.camera.target.y += (mouseWorldPoint.y - this.state.camera.target.y) * moveAmount;
      this.state.camera.target.z += (mouseWorldPoint.z - this.state.camera.target.z) * moveAmount;
    }

    if (this.state.projectionMode === 'orthographic') {
      // Orthographic: scale view volume instead of moving camera
      this.state.orthoSize = Math.max(0.01, this.state.orthoSize * zoomFactor);
      // Still move camera position to keep orbit distance consistent for when switching back
      const newDistance = Math.max(0.1, distance * zoomFactor);
      const scale = newDistance / distance;
      this.state.camera.position.x = this.state.camera.target.x + dir.x * scale;
      this.state.camera.position.y = this.state.camera.target.y + dir.y * scale;
      this.state.camera.position.z = this.state.camera.target.z + dir.z * scale;
    } else {
      // Perspective: scale distance
      const newDistance = Math.max(0.1, distance * zoomFactor);
      const scale = newDistance / distance;
      this.state.camera.position.x = this.state.camera.target.x + dir.x * scale;
      this.state.camera.position.y = this.state.camera.target.y + dir.y * scale;
      this.state.camera.position.z = this.state.camera.target.z + dir.z * scale;
    }

    this.updateMatrices();
  }
}

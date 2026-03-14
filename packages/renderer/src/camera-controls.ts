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
  /**
   * Persistent orbit center. Orbit rotates both camera.position and camera.target
   * around this point. Set by:
   * - Object selection (silently, no camera movement)
   * - Zoom (syncs to camera.target after zoom moves it)
   * - Pan (moves with position/target)
   * Never changed by orbit itself.
   * When null, defaults to camera.target (standard behavior).
   */
  private orbitCenter: Vec3 | null = null;

  constructor(
    private readonly state: CameraInternalState,
    private readonly updateMatrices: () => void,
  ) {}

  /**
   * Set the orbit center (e.g. selected object center).
   * Does NOT move the camera — only affects future orbit rotation.
   */
  setOrbitCenter(center: Vec3 | null): void {
    this.orbitCenter = center ? { ...center } : null;
  }

  /**
   * Get the current effective orbit center.
   */
  getOrbitCenter(): Vec3 {
    return this.orbitCenter ? { ...this.orbitCenter } : { ...this.state.camera.target };
  }

  /**
   * Sync orbit center to current camera.target.
   * Called after zoom (which moves target) to keep orbit center current.
   */
  syncOrbitCenterToTarget(): void {
    if (this.orbitCenter) {
      this.orbitCenter = { ...this.state.camera.target };
    }
  }

  /**
   * Orbit around the orbit center (Y-up coordinate system).
   * Rotates BOTH camera.position and camera.target around the orbit center
   * so the view direction stays consistent (no curved fly paths).
   *
   * The orbit center is persistent — it stays fixed during orbit and only
   * changes via zoom, pan, selection, or explicit setOrbitCenter calls.
   */
  orbit(deltaX: number, deltaY: number): void {
    // Always ensure Y-up for consistent orbit behavior
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    // Invert controls: mouse movement direction = model rotation direction
    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    // Use persistent orbit center, or fall back to camera.target
    const pivot = this.orbitCenter || this.state.camera.target;

    const dir = {
      x: this.state.camera.position.x - pivot.x,
      y: this.state.camera.position.y - pivot.y,
      z: this.state.camera.position.z - pivot.z,
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
    this.state.camera.position.x = pivot.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    this.state.camera.position.y = pivot.y + distance * Math.cos(phiClamped);
    this.state.camera.position.z = pivot.z + distance * Math.sin(phiClamped) * Math.cos(theta);

    // If orbiting around a separate orbit center (not camera.target),
    // apply the same rotation to camera.target so the look direction
    // rotates with the camera (not a translation — a rotation).
    if (this.orbitCenter) {
      const tDir = {
        x: this.state.camera.target.x - pivot.x,
        y: this.state.camera.target.y - pivot.y,
        z: this.state.camera.target.z - pivot.z,
      };
      const tDist = Math.sqrt(tDir.x * tDir.x + tDir.y * tDir.y + tDir.z * tDir.z);
      if (tDist > 1e-6) {
        let tPhi = Math.acos(Math.max(-1, Math.min(1, tDir.y / tDist)));
        const tSinPhi = Math.sin(tPhi);
        let tTheta: number;
        if (tSinPhi > 0.05) {
          tTheta = Math.atan2(tDir.x, tDir.z);
        } else {
          tTheta = 0;
          tPhi = tPhi < Math.PI / 2 ? 0.15 : Math.PI - 0.15;
        }
        // Apply the same angular delta
        tTheta += dx;
        const tPhiNew = Math.max(0.15, Math.min(Math.PI - 0.15, tPhi + dy));
        this.state.camera.target.x = pivot.x + tDist * Math.sin(tPhiNew) * Math.sin(tTheta);
        this.state.camera.target.y = pivot.y + tDist * Math.cos(tPhiNew);
        this.state.camera.target.z = pivot.z + tDist * Math.sin(tPhiNew) * Math.cos(tTheta);
      }
    }

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
    const panX = (right.x * deltaX + up.x * deltaY) * panSpeed;
    const panY = (right.y * deltaX + up.y * deltaY) * panSpeed;
    const panZ = (right.z * deltaX + up.z * deltaY) * panSpeed;
    this.state.camera.target.x += panX;
    this.state.camera.target.y += panY;
    this.state.camera.target.z += panZ;
    this.state.camera.position.x += panX;
    this.state.camera.position.y += panY;
    this.state.camera.position.z += panZ;

    // Move orbit center with pan so orbit stays centered on the same relative point
    if (this.orbitCenter) {
      this.orbitCenter.x += panX;
      this.orbitCenter.y += panY;
      this.orbitCenter.z += panZ;
    }

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

    // Zoom establishes a new orbit center — sync to where target ended up
    this.syncOrbitCenterToTarget();

    this.updateMatrices();
  }
}

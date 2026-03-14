/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera orbit, pan, and zoom controls.
 *
 * Orbit uses a pivot point:
 * - Default pivot = camera.target (standard orbit)
 * - When orbitCenter is set (e.g. selected object), both position AND target
 *   rotate around it. This preserves the viewing direction while orbiting
 *   around the selected object — standard BIM behavior where selecting an
 *   object doesn't move the camera, only changes the orbit pivot.
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
  /** Scene bounding box for tight orthographic near/far computation */
  sceneBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
}

/**
 * Handles core camera movement: orbit, pan, and zoom.
 */
export class CameraControls {
  /** Optional orbit pivot (set on object selection). null = orbit around camera.target. */
  private orbitCenter: Vec3 | null = null;

  constructor(
    private readonly state: CameraInternalState,
    private readonly updateMatrices: () => void,
  ) {}

  /**
   * Set the orbit center without moving the camera.
   * Future orbit() calls will rotate around this point.
   * Pass null to revert to orbiting around camera.target.
   */
  setOrbitCenter(center: Vec3 | null): void {
    this.orbitCenter = center ? { ...center } : null;
  }

  /**
   * Orbit the camera around a pivot point (Y-up turntable style).
   *
   * When orbitCenter is set (selected object), both position AND target
   * rotate around the orbit center. The camera never moves on selection
   * alone — only when the user actually drags to rotate.
   */
  orbit(deltaX: number, deltaY: number): void {
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    if (this.orbitCenter !== null) {
      // Rotate both position and target around the external pivot
      this.orbitAroundExternalPivot(this.orbitCenter, dx, dy);
    } else {
      // Standard: rotate position around target
      this.orbitPositionAroundPivot(this.state.camera.target, dx, dy);
    }

    this.updateMatrices();
  }

  /**
   * Rotate a point around the pivot by the given theta/phi deltas.
   * Returns the new position. Used for orbiting both position and target.
   */
  private rotateAroundPivot(
    point: Vec3, pivot: Vec3, dx: number, dy: number,
  ): { x: number; y: number; z: number } {
    const rx = point.x - pivot.x;
    const ry = point.y - pivot.y;
    const rz = point.z - pivot.z;
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (dist < 1e-6) return { x: point.x, y: point.y, z: point.z };

    let phi = Math.acos(Math.max(-1, Math.min(1, ry / dist)));
    const sinPhi = Math.sin(phi);
    let theta: number;
    if (sinPhi > 0.05) {
      theta = Math.atan2(rx, rz);
    } else {
      theta = 0;
      phi = phi < Math.PI / 2 ? 0.15 : Math.PI - 0.15;
    }

    const newTheta = theta + dx;
    const newPhi = Math.max(0.15, Math.min(Math.PI - 0.15, phi + dy));

    return {
      x: pivot.x + dist * Math.sin(newPhi) * Math.sin(newTheta),
      y: pivot.y + dist * Math.cos(newPhi),
      z: pivot.z + dist * Math.sin(newPhi) * Math.cos(newTheta),
    };
  }

  /**
   * Orbit both camera.position and camera.target around an external pivot.
   * Position rotates fully (theta + phi). Target only rotates horizontally
   * (theta) so vertical dragging changes the viewing angle without moving
   * the model up/down.
   */
  private orbitAroundExternalPivot(pivot: Vec3, dx: number, dy: number): void {
    const newPos = this.rotateAroundPivot(this.state.camera.position, pivot, dx, dy);

    // Target: horizontal rotation only (dx), keep Y fixed
    const tx = this.state.camera.target.x - pivot.x;
    const tz = this.state.camera.target.z - pivot.z;
    const thetaTgt = Math.atan2(tx, tz) + dx;
    const horizDist = Math.sqrt(tx * tx + tz * tz);

    this.state.camera.position.x = newPos.x;
    this.state.camera.position.y = newPos.y;
    this.state.camera.position.z = newPos.z;
    this.state.camera.target.x = pivot.x + horizDist * Math.sin(thetaTgt);
    this.state.camera.target.z = pivot.z + horizDist * Math.cos(thetaTgt);
    // target.y stays unchanged
  }

  /**
   * Standard spherical orbit: rotate camera.position around pivot (= target).
   * Only position changes.
   */
  private orbitPositionAroundPivot(pivot: Vec3, dx: number, dy: number): void {
    const dir = {
      x: this.state.camera.position.x - pivot.x,
      y: this.state.camera.position.y - pivot.y,
      z: this.state.camera.position.z - pivot.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (distance < 1e-6) return;

    let currentPhi = Math.acos(Math.max(-1, Math.min(1, dir.y / distance)));

    let theta: number;
    const sinPhi = Math.sin(currentPhi);
    if (sinPhi > 0.05) {
      theta = Math.atan2(dir.x, dir.z);
    } else {
      theta = 0;
      if (currentPhi < Math.PI / 2) {
        currentPhi = 0.15;
      } else {
        currentPhi = Math.PI - 0.15;
      }
    }

    theta += dx;
    const phiClamped = Math.max(0.15, Math.min(Math.PI - 0.15, currentPhi + dy));

    this.state.camera.position.x = pivot.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    this.state.camera.position.y = pivot.y + distance * Math.cos(phiClamped);
    this.state.camera.position.z = pivot.z + distance * Math.sin(phiClamped) * Math.cos(theta);
  }

  /**
   * Pan camera (Y-up coordinate system).
   * Moves both position and target by the same offset (preserves orbit relationship).
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
    const offsetX = (right.x * deltaX + up.x * deltaY) * panSpeed;
    const offsetY = (right.y * deltaX + up.y * deltaY) * panSpeed;
    const offsetZ = (right.z * deltaX + up.z * deltaY) * panSpeed;

    this.state.camera.target.x += offsetX;
    this.state.camera.target.y += offsetY;
    this.state.camera.target.z += offsetZ;
    this.state.camera.position.x += offsetX;
    this.state.camera.position.y += offsetY;
    this.state.camera.position.z += offsetZ;

    // Also move orbit center if set (so pan doesn't break the orbit pivot)
    if (this.orbitCenter) {
      this.orbitCenter.x += offsetX;
      this.orbitCenter.y += offsetY;
      this.orbitCenter.z += offsetZ;
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

      // World point under mouse cursor (on the target plane)
      const mouseWorldPoint = {
        x: this.state.camera.target.x + right.x * ndcX * halfWidth + actualUp.x * ndcY * halfHeight,
        y: this.state.camera.target.y + right.y * ndcX * halfWidth + actualUp.y * ndcY * halfHeight,
        z: this.state.camera.target.z + right.z * ndcX * halfWidth + actualUp.z * ndcY * halfHeight,
      };

      // Move target towards mouse point while zooming (establishes new orbit center)
      const moveAmount = (1 - zoomFactor); // Negative when zooming in

      this.state.camera.target.x += (mouseWorldPoint.x - this.state.camera.target.x) * moveAmount;
      this.state.camera.target.y += (mouseWorldPoint.y - this.state.camera.target.y) * moveAmount;
      this.state.camera.target.z += (mouseWorldPoint.z - this.state.camera.target.z) * moveAmount;
    }

    if (this.state.projectionMode === 'orthographic') {
      // Orthographic: only scale view volume — camera distance is irrelevant for ortho rendering.
      this.state.orthoSize = Math.max(0.01, this.state.orthoSize * zoomFactor);
      // Reposition camera to maintain same distance/direction from (possibly panned) target
      this.state.camera.position.x = this.state.camera.target.x + dir.x;
      this.state.camera.position.y = this.state.camera.target.y + dir.y;
      this.state.camera.position.z = this.state.camera.target.z + dir.z;
    } else {
      // Perspective: dolly-zoom — combines distance reduction with forward travel.
      // Pure multiplicative zoom suffers from Zeno's paradox: each step covers a smaller
      // absolute distance, so the user asymptotically approaches the target but can never
      // pass it. By splitting each zoom step into distance reduction + forward dolly,
      // the camera always makes real progress through the scene.
      const forward = { x: -dir.x / distance, y: -dir.y / distance, z: -dir.z / distance };
      const zoomStep = distance * (1 - zoomFactor); // positive when zooming in

      // Half the step reduces camera-target distance, half moves both forward
      const dolly = zoomStep * 0.5;
      const newDistance = Math.max(0.001, distance - dolly);

      // Move target forward (traverse through the scene)
      this.state.camera.target.x += forward.x * dolly;
      this.state.camera.target.y += forward.y * dolly;
      this.state.camera.target.z += forward.z * dolly;

      if (this.orbitCenter) {
        this.orbitCenter.x += forward.x * dolly;
        this.orbitCenter.y += forward.y * dolly;
        this.orbitCenter.z += forward.z * dolly;
      }

      // Position camera at new distance from updated target
      this.state.camera.position.x = this.state.camera.target.x - forward.x * newDistance;
      this.state.camera.position.y = this.state.camera.target.y - forward.y * newDistance;
      this.state.camera.position.z = this.state.camera.target.z - forward.z * newDistance;
    }

    this.updateMatrices();
  }
}

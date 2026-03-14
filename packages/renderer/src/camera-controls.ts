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
   * Two modes:
   * 1. No orbitCenter: standard orbit — position rotates around target on a sphere.
   * 2. With orbitCenter: both position AND target rotate around the orbit center.
   *    This preserves the camera's viewing direction while pivoting around
   *    the selected object. No camera jump on selection.
   */
  orbit(deltaX: number, deltaY: number): void {
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    const pivot = this.orbitCenter ?? this.state.camera.target;

    if (this.orbitCenter === null) {
      // Standard orbit: only position moves, target stays fixed
      this.orbitPositionAroundPivot(pivot, dx, dy);
    } else {
      // BIM orbit: rotate both position and target around the orbit center.
      // This keeps the viewing direction stable — no camera jump.
      this.rotateAroundPivot(pivot, dx, dy);
    }

    this.updateMatrices();
  }

  /**
   * Standard spherical orbit: rotate camera.position around pivot (= target).
   * Only position changes. Used when no explicit orbit center is set.
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
   * BIM orbit: rotate both position and target around a pivot.
   *
   * Uses spherical coordinates (same math as standard orbit) to avoid
   * gimbal lock. Computes the angular delta from position's spherical
   * coords, then applies the identical delta to target's spherical coords.
   * Orbit position using spherical coords (pole-safe), then apply the
   * exact same 3D rotation to target so the viewing direction is preserved.
   *
   * Key insight: target must NOT be independently converted to spherical
   * coords — position and target have different theta values, so they'd
   * trace different meridians and the view would wobble.  Instead we:
   *   1. Orbit position via spherical coords (handles poles with clamping)
   *   2. Rotate target around Y axis by dTheta (always stable)
   *   3. Rotate target around the right axis by dPhi — the right axis is
   *      derived from position's new theta (cos θ, 0, −sin θ), which is
   *      a pure number, never degenerate.
   */
  private rotateAroundPivot(pivot: Vec3, dx: number, dy: number): void {
    // --- 1. Position: spherical orbit ---
    const posDir = {
      x: this.state.camera.position.x - pivot.x,
      y: this.state.camera.position.y - pivot.y,
      z: this.state.camera.position.z - pivot.z,
    };
    const posDist = Math.sqrt(posDir.x * posDir.x + posDir.y * posDir.y + posDir.z * posDir.z);
    if (posDist < 1e-6) return;

    let currentPhi = Math.acos(Math.max(-1, Math.min(1, posDir.y / posDist)));
    let theta: number;
    const sinPhi = Math.sin(currentPhi);
    if (sinPhi > 0.05) {
      theta = Math.atan2(posDir.x, posDir.z);
    } else {
      theta = 0;
      currentPhi = currentPhi < Math.PI / 2 ? 0.15 : Math.PI - 0.15;
    }

    const newTheta = theta + dx;
    const newPhi = Math.max(0.15, Math.min(Math.PI - 0.15, currentPhi + dy));
    const dTheta = newTheta - theta;
    const dPhi = newPhi - currentPhi;

    this.state.camera.position.x = pivot.x + posDist * Math.sin(newPhi) * Math.sin(newTheta);
    this.state.camera.position.y = pivot.y + posDist * Math.cos(newPhi);
    this.state.camera.position.z = pivot.z + posDist * Math.sin(newPhi) * Math.cos(newTheta);

    // --- 2. Target: apply the same 3D rotation ---
    // Horizontal: rotate around Y axis through pivot by dTheta
    const cosH = Math.cos(dTheta);
    const sinH = Math.sin(dTheta);
    const tx = this.state.camera.target.x - pivot.x;
    const tz = this.state.camera.target.z - pivot.z;
    this.state.camera.target.x = pivot.x + tx * cosH - tz * sinH;
    this.state.camera.target.z = pivot.z + tx * sinH + tz * cosH;

    // Vertical: rotate around right axis through pivot by dPhi
    // Right axis from position's new theta — always a well-defined horizontal vector
    if (Math.abs(dPhi) > 1e-8) {
      const axis = {
        x: Math.cos(newTheta),
        y: 0,
        z: -Math.sin(newTheta),
      };
      this.rotatePointAroundAxis(this.state.camera.target, pivot, axis, dPhi);
    }
  }

  /**
   * Rotate a point around an arbitrary axis through a pivot by angle theta.
   * Uses Rodrigues' rotation formula:
   *   v' = v cos(θ) + (k × v) sin(θ) + k(k·v)(1 − cos(θ))
   */
  private rotatePointAroundAxis(point: Vec3, pivot: Vec3, axis: Vec3, angle: number): void {
    const vx = point.x - pivot.x;
    const vy = point.y - pivot.y;
    const vz = point.z - pivot.z;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const crossX = axis.y * vz - axis.z * vy;
    const crossY = axis.z * vx - axis.x * vz;
    const crossZ = axis.x * vy - axis.y * vx;
    const dot = axis.x * vx + axis.y * vy + axis.z * vz;
    point.x = pivot.x + vx * cosA + crossX * sinA + axis.x * dot * (1 - cosA);
    point.y = pivot.y + vy * cosA + crossY * sinA + axis.y * dot * (1 - cosA);
    point.z = pivot.z + vz * cosA + crossZ * sinA + axis.z * dot * (1 - cosA);
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

      // World offset from center towards mouse position
      const worldOffsetX = ndcX * halfWidth;
      const worldOffsetY = ndcY * halfHeight;

      // Point in world space that mouse is pointing at (on the target plane)
      const mouseWorldPoint = {
        x: this.state.camera.target.x + right.x * worldOffsetX + actualUp.x * worldOffsetY,
        y: this.state.camera.target.y + right.y * worldOffsetX + actualUp.y * worldOffsetY,
        z: this.state.camera.target.z + right.z * worldOffsetX + actualUp.z * worldOffsetY,
      };

      // Move target towards mouse point while zooming (establishes new orbit center)
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera orbit, pan, and zoom controls.
 * Extracted from Camera class using composition pattern.
 *
 * Orbit uses Rodrigues' rotation (axis-angle) so the same rigid-body
 * rotation is applied to every offset vector around the pivot.
 * This guarantees no "curved fly path" even when the orbit center
 * differs from camera.target.
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

// ── helpers ──────────────────────────────────────────────────────────

/** Rodrigues' rotation: rotate vector `v` around unit axis `k` by `angle` radians. */
function rotateAroundAxis(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = v.x * k.x + v.y * k.y + v.z * k.z;
  // k × v
  const cx = k.y * v.z - k.z * v.y;
  const cy = k.z * v.x - k.x * v.z;
  const cz = k.x * v.y - k.y * v.x;
  return {
    x: v.x * c + cx * s + k.x * dot * (1 - c),
    y: v.y * c + cy * s + k.y * dot * (1 - c),
    z: v.z * c + cz * s + k.z * dot * (1 - c),
  };
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Handles core camera movement: orbit, pan, and zoom.
 */
export class CameraControls {
  /**
   * Persistent orbit center.  When non-null, orbit rotates the whole camera
   * rig (position + target) around this point instead of around camera.target.
   *
   * Set by object selection (silently, no camera movement).
   * Cleared on deselection or model reset.
   * Synced to camera.target after every zoom (zoom establishes a new orbit center).
   * Moved along with position/target on pan.
   */
  private orbitCenter: Vec3 | null = null;

  constructor(
    private readonly state: CameraInternalState,
    private readonly updateMatrices: () => void,
  ) {}

  // ── orbit center management ──────────────────────────────────────

  /** Set the orbit center (e.g. selected object center).  No camera movement. */
  setOrbitCenter(center: Vec3 | null): void {
    this.orbitCenter = center ? { ...center } : null;
  }

  /** Get the current effective orbit center. */
  getOrbitCenter(): Vec3 {
    return this.orbitCenter ? { ...this.orbitCenter } : { ...this.state.camera.target };
  }

  /** After zoom moves camera.target, sync orbit center to match. */
  syncOrbitCenterToTarget(): void {
    if (this.orbitCenter) {
      this.orbitCenter = { ...this.state.camera.target };
    }
  }

  // ── orbit ────────────────────────────────────────────────────────

  /**
   * Orbit the camera around the current orbit center (Y-up turntable style).
   *
   * When orbitCenter is null the pivot is camera.target and only position
   * moves (classic Three.js OrbitControls behaviour).
   *
   * When orbitCenter is set (e.g. selected object), both position AND target
   * are rotated around the pivot using the same rigid-body rotation so the
   * view direction is preserved — no curved fly paths.
   */
  orbit(deltaX: number, deltaY: number): void {
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    const dx = -deltaX * 0.01; // horizontal angle (around Y)
    const dy = -deltaY * 0.01; // vertical angle (around right axis)

    const pivot = this.orbitCenter || this.state.camera.target;

    // Offset from pivot to camera position
    const posOff: Vec3 = {
      x: this.state.camera.position.x - pivot.x,
      y: this.state.camera.position.y - pivot.y,
      z: this.state.camera.position.z - pivot.z,
    };
    const dist = Math.sqrt(posOff.x * posOff.x + posOff.y * posOff.y + posOff.z * posOff.z);
    if (dist < 1e-6) return;

    // Camera right vector = cross(viewDir, worldUp)
    // viewDir points from camera to pivot = -posOff / dist
    const vx = -posOff.x / dist;
    const vy = -posOff.y / dist;
    const vz = -posOff.z / dist;
    // cross(viewDir, (0,1,0))
    let rx = vy * 0 - vz * 1;  // = -vz
    const ry = 0;               // always 0 for Y-up turntable
    let rz = vx * 1 - vy * 0;  // = vx
    const rLen = Math.sqrt(rx * rx + rz * rz);
    if (rLen < 1e-6) return; // degenerate: looking straight up/down
    rx /= rLen;
    rz /= rLen;
    const rightAxis: Vec3 = { x: rx, y: ry, z: rz };

    // Clamp vertical angle to prevent going past the poles
    const currentElev = Math.asin(Math.max(-1, Math.min(1, posOff.y / dist)));
    const maxElev = Math.PI / 2 - 0.15;
    const clampedDy = Math.max(-maxElev - currentElev, Math.min(maxElev - currentElev, dy));

    const yAxis: Vec3 = { x: 0, y: 1, z: 0 };

    // Rotate position offset: first vertical (around right), then horizontal (around Y)
    let newPosOff = rotateAroundAxis(posOff, rightAxis, clampedDy);
    newPosOff = rotateAroundAxis(newPosOff, yAxis, dx);

    this.state.camera.position.x = pivot.x + newPosOff.x;
    this.state.camera.position.y = pivot.y + newPosOff.y;
    this.state.camera.position.z = pivot.z + newPosOff.z;

    // When orbiting around a separate orbit center, apply the exact same
    // rotation to camera.target so the look direction is rigidly preserved.
    if (this.orbitCenter) {
      const targetOff: Vec3 = {
        x: this.state.camera.target.x - pivot.x,
        y: this.state.camera.target.y - pivot.y,
        z: this.state.camera.target.z - pivot.z,
      };
      let newTargetOff = rotateAroundAxis(targetOff, rightAxis, clampedDy);
      newTargetOff = rotateAroundAxis(newTargetOff, yAxis, dx);
      this.state.camera.target.x = pivot.x + newTargetOff.x;
      this.state.camera.target.y = pivot.y + newTargetOff.y;
      this.state.camera.target.z = pivot.z + newTargetOff.z;
    }

    this.updateMatrices();
  }

  // ── pan ──────────────────────────────────────────────────────────

  /**
   * Pan camera (Y-up coordinate system).
   * Moves position, target, and orbit center by the same world-space offset.
   */
  pan(deltaX: number, deltaY: number): void {
    const dir = {
      x: this.state.camera.position.x - this.state.camera.target.x,
      y: this.state.camera.position.y - this.state.camera.target.y,
      z: this.state.camera.position.z - this.state.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Right vector: cross product of direction and up (0,1,0)
    const right = { x: -dir.z, y: 0, z: dir.x };
    const rightLen = Math.sqrt(right.x * right.x + right.z * right.z);
    if (rightLen > 1e-10) {
      right.x /= rightLen;
      right.z /= rightLen;
    }

    // Up vector: cross product of right and direction
    const up = {
      x: right.z * dir.y - right.y * dir.z,
      y: right.x * dir.z - right.z * dir.x,
      z: right.y * dir.x - right.x * dir.y,
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

    if (this.orbitCenter) {
      this.orbitCenter.x += panX;
      this.orbitCenter.y += panY;
      this.orbitCenter.z += panZ;
    }

    this.updateMatrices();
  }

  // ── zoom ─────────────────────────────────────────────────────────

  /**
   * Zoom camera towards mouse position.
   * After zooming, syncs the orbit center to camera.target so zoom
   * establishes a new orbit center.
   */
  zoom(delta: number, mouseX?: number, mouseY?: number, canvasWidth?: number, canvasHeight?: number): void {
    const dir = {
      x: this.state.camera.position.x - this.state.camera.target.x,
      y: this.state.camera.position.y - this.state.camera.target.y,
      z: this.state.camera.position.z - this.state.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.1);
    const zoomFactor = 1 + normalizedDelta;

    // Mouse-to-point zoom: shift target towards the cursor's world position
    if (mouseX !== undefined && mouseY !== undefined && canvasWidth && canvasHeight) {
      const ndcX = (mouseX / canvasWidth) * 2 - 1;
      const ndcY = 1 - (mouseY / canvasHeight) * 2;

      const forward = { x: -dir.x / distance, y: -dir.y / distance, z: -dir.z / distance };
      const up = this.state.camera.up;

      const right = {
        x: forward.y * up.z - forward.z * up.y,
        y: forward.z * up.x - forward.x * up.z,
        z: forward.x * up.y - forward.y * up.x,
      };
      const rightLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
      if (rightLen > 1e-10) { right.x /= rightLen; right.y /= rightLen; right.z /= rightLen; }

      const actualUp = {
        x: right.y * forward.z - right.z * forward.y,
        y: right.z * forward.x - right.x * forward.z,
        z: right.x * forward.y - right.y * forward.x,
      };

      const halfHeight = this.state.projectionMode === 'orthographic'
        ? this.state.orthoSize
        : distance * Math.tan(this.state.camera.fov / 2);
      const halfWidth = halfHeight * this.state.camera.aspect;

      const mouseWorldPoint = {
        x: this.state.camera.target.x + right.x * ndcX * halfWidth + actualUp.x * ndcY * halfHeight,
        y: this.state.camera.target.y + right.y * ndcX * halfWidth + actualUp.y * ndcY * halfHeight,
        z: this.state.camera.target.z + right.z * ndcX * halfWidth + actualUp.z * ndcY * halfHeight,
      };

      const moveAmount = 1 - zoomFactor;
      this.state.camera.target.x += (mouseWorldPoint.x - this.state.camera.target.x) * moveAmount;
      this.state.camera.target.y += (mouseWorldPoint.y - this.state.camera.target.y) * moveAmount;
      this.state.camera.target.z += (mouseWorldPoint.z - this.state.camera.target.z) * moveAmount;
    }

    if (this.state.projectionMode === 'orthographic') {
      this.state.orthoSize = Math.max(0.01, this.state.orthoSize * zoomFactor);
    }
    const newDistance = Math.max(0.1, distance * zoomFactor);
    const scale = newDistance / distance;
    this.state.camera.position.x = this.state.camera.target.x + dir.x * scale;
    this.state.camera.position.y = this.state.camera.target.y + dir.y * scale;
    this.state.camera.position.z = this.state.camera.target.z + dir.z * scale;

    // Zoom establishes a new orbit center
    this.syncOrbitCenterToTarget();

    this.updateMatrices();
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera orbit, pan, and zoom controls.
 *
 * Orbit uses a pivot point:
 * - Default pivot = camera.target (standard orbit — position rotates, target stays)
 * - When orbitCenter is set (raycast hit / selected object), position orbits
 *   around the pivot and the look direction is rotated by the exact same
 *   axis-angle rotation (Rodrigues). A small vertical clamp on the look
 *   direction prevents the view matrix from degenerating (model flip).
 *   Approach mirrors Blender's turntable: Y-axis horizontal + right-axis vertical.
 */

import type { Camera as CameraType, Vec3, Mat4 } from './types.js';
import { CAMERA_CONSTANTS as CC } from './constants.js';

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

// ---------------------------------------------------------------------------
// Tiny vec3 helpers (inline, no allocations beyond the return object)
// ---------------------------------------------------------------------------

/** Subtract a - b */
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return len > 1e-10 ? scale(v, 1 / len) : { x: 0, y: 0, z: 0 };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Rodrigues' rotation: rotate v around unit axis k by angle radians. */
function rodrigues(v: Vec3, k: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const kDotV = dot(k, v);
  const kxv = cross(k, v);
  return {
    x: v.x * cosA + kxv.x * sinA + k.x * kDotV * (1 - cosA),
    y: v.y * cosA + kxv.y * sinA + k.y * kDotV * (1 - cosA),
    z: v.z * cosA + kxv.z * sinA + k.z * kDotV * (1 - cosA),
  };
}

/**
 * Prevent the look direction from being too close to ±Y (vertical),
 * which degenerates the view matrix (cross(forward, up) → 0 → model flips).
 * Preserves the horizontal direction; only pulls the Y component back.
 * Margin of ~0.6° from vertical — user can look 89.4° up/down.
 */
const MAX_LOOK_Y = Math.cos(0.01); // cos(0.01 rad) ≈ 0.99995

function clampLookVertical(look: Vec3): Vec3 {
  const len = length(look);
  if (len < 1e-10) return look;

  const ny = look.y / len;
  if (Math.abs(ny) <= MAX_LOOK_Y) return look;

  const clampedNy = Math.sign(ny) * MAX_LOOK_Y;
  const horizSq = look.x * look.x + look.z * look.z;
  if (horizSq < 1e-20) return look; // purely vertical, can't recover direction

  const targetHoriz = len * Math.sqrt(1 - clampedNy * clampedNy);
  const hScale = targetHoriz / Math.sqrt(horizSq);
  return { x: look.x * hScale, y: clampedNy * len, z: look.z * hScale };
}

/** Add offset to a Vec3 in place */
function addInPlace(v: Vec3, offset: Vec3): void {
  v.x += offset.x;
  v.y += offset.y;
  v.z += offset.z;
}

/** Copy xyz from src into dst */
function copyInto(dst: Vec3, src: Vec3): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

// ---------------------------------------------------------------------------
// Spherical coordinate helpers
// ---------------------------------------------------------------------------

/** Convert a direction vector (from pivot to point) into spherical angles,
 *  handling gimbal lock near the poles. */
function toSpherical(dir: Vec3, dist: number): { theta: number; phi: number } {
  let phi = Math.acos(Math.max(-1, Math.min(1, dir.y / dist)));
  let theta: number;
  const sinPhi = Math.sin(phi);

  if (sinPhi > CC.POLE_THRESHOLD) {
    theta = Math.atan2(dir.x, dir.z);
  } else {
    theta = 0;
    phi = phi < Math.PI / 2 ? CC.MIN_PHI : CC.MAX_PHI;
  }

  return { theta, phi };
}

/** Convert spherical angles back to a Cartesian position relative to a pivot. */
function fromSpherical(pivot: Vec3, dist: number, theta: number, phi: number): Vec3 {
  const sinPhi = Math.sin(phi);
  return {
    x: pivot.x + dist * sinPhi * Math.sin(theta),
    y: pivot.y + dist * Math.cos(phi),
    z: pivot.z + dist * sinPhi * Math.cos(theta),
  };
}

function clampPhi(phi: number): number {
  return Math.max(CC.MIN_PHI, Math.min(CC.MAX_PHI, phi));
}

// ---------------------------------------------------------------------------
// CameraControls
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Orbit
  // -------------------------------------------------------------------------

  /**
   * Orbit the camera around a pivot point (Y-up turntable style).
   *
   * When orbitCenter is set, position orbits around the external pivot and
   * the look direction is rotated by the same axis-angle rotation (Rodrigues).
   * Like Blender's turntable: horizontal = world Y, vertical = camera right.
   * A vertical clamp on the look vector prevents view matrix degeneracy.
   */
  orbit(deltaX: number, deltaY: number): void {
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    const dx = -deltaX * CC.ORBIT_SENSITIVITY;
    const dy = -deltaY * CC.ORBIT_SENSITIVITY;

    if (this.orbitCenter !== null) {
      this.orbitAroundExternalPivot(this.orbitCenter, dx, dy);
    } else {
      // Standard: rotate position around target, target stays fixed
      const newPos = this.rotateAroundPivot(this.state.camera.position, this.state.camera.target, dx, dy);
      copyInto(this.state.camera.position, newPos);
    }

    this.updateMatrices();
  }

  /**
   * Rotate a point around the pivot by the given theta/phi deltas.
   */
  private rotateAroundPivot(point: Vec3, pivot: Vec3, dx: number, dy: number): Vec3 {
    const dir = sub(point, pivot);
    const dist = length(dir);
    if (dist < 1e-6) return { ...point };

    const { theta, phi } = toSpherical(dir, dist);
    return fromSpherical(pivot, dist, theta + dx, clampPhi(phi + dy));
  }

  /**
   * Orbit around an external pivot (Blender-style turntable with Rodrigues).
   *
   * 1. Horizontal: rotate offset + look around world Y (always stable).
   * 2. Vertical: rotate offset + look around the orbit-sphere tangent
   *    (right axis derived from offset's horizontal component). Position
   *    phi is clamped to [MIN_PHI, MAX_PHI] so the right axis never
   *    degenerates (sin(MIN_PHI) ≈ 0.15 → always has XZ component).
   * 3. Clamp the look vector's vertical angle to prevent the view matrix
   *    from degenerating when look ∥ Y. Margin is ~0.6° from vertical,
   *    so the user can look from 89.4° above or below.
   */
  private orbitAroundExternalPivot(pivot: Vec3, dx: number, dy: number): void {
    let offset = sub(this.state.camera.position, pivot);
    const dist = length(offset);
    if (dist < 1e-6) return;
    let look = sub(this.state.camera.target, this.state.camera.position);

    const yAxis: Vec3 = { x: 0, y: 1, z: 0 };

    // 1. Horizontal rotation around world Y (always stable)
    offset = rodrigues(offset, yAxis, dx);
    look = rodrigues(look, yAxis, dx);

    // 2. Vertical rotation, clamped to prevent position from crossing poles
    const offsetDir = scale(offset, 1 / dist);
    const currentPhi = Math.acos(Math.max(-1, Math.min(1, offsetDir.y)));
    const clampedDy = clampPhi(currentPhi + dy) - currentPhi;

    if (Math.abs(clampedDy) > 1e-10) {
      // Right axis = tangent to orbit sphere in the phi-increasing direction.
      // {offset.z, 0, -offset.x} ensures positive angle → phi increases
      // (camera moves down), matching the spherical-coord convention used
      // by clampedDy. Always valid because phi is clamped away from the
      // pole, so offset always has a horizontal component.
      const rightN = normalize({ x: offset.z, y: 0, z: -offset.x });
      offset = rodrigues(offset, rightN, clampedDy);
      look = rodrigues(look, rightN, clampedDy);
    }

    // 3. Prevent view flip: clamp look direction away from ±Y
    look = clampLookVertical(look);

    const newPos = { x: pivot.x + offset.x, y: pivot.y + offset.y, z: pivot.z + offset.z };
    copyInto(this.state.camera.position, newPos);
    copyInto(this.state.camera.target, {
      x: newPos.x + look.x,
      y: newPos.y + look.y,
      z: newPos.z + look.z,
    });
  }

  // -------------------------------------------------------------------------
  // Pan
  // -------------------------------------------------------------------------

  /**
   * Pan camera (Y-up coordinate system).
   * Moves both position and target by the same offset (preserves orbit relationship).
   */
  pan(deltaX: number, deltaY: number): void {
    const dir = sub(this.state.camera.position, this.state.camera.target);
    const dist = length(dir);

    const right = normalize({ x: -dir.z, y: 0, z: dir.x });
    const up = normalize(cross(right, dir));

    const speed = dist * CC.PAN_SPEED_MULTIPLIER;
    const offset = {
      x: (right.x * deltaX + up.x * deltaY) * speed,
      y: (right.y * deltaX + up.y * deltaY) * speed,
      z: (right.z * deltaX + up.z * deltaY) * speed,
    };

    this.translateAll(offset);
    this.updateMatrices();
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  /**
   * Zoom camera towards mouse position.
   * @param delta - Zoom delta (positive = zoom out, negative = zoom in)
   * @param mouseX - Mouse X position in canvas coordinates
   * @param mouseY - Mouse Y position in canvas coordinates
   * @param canvasWidth - Canvas width
   * @param canvasHeight - Canvas height
   */
  zoom(delta: number, mouseX?: number, mouseY?: number, canvasWidth?: number, canvasHeight?: number): void {
    const dir = sub(this.state.camera.position, this.state.camera.target);
    const distance = length(dir);
    if (distance < 1e-6) return; // Degenerate: position ≈ target, nothing to zoom

    const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta) * CC.ZOOM_SENSITIVITY, CC.MAX_ZOOM_DELTA);
    const zoomFactor = 1 + normalizedDelta;
    const forward = scale(dir, -1 / distance);

    if (this.state.projectionMode === 'orthographic') {
      // Compute the effective factor after clamping so mouse anchoring matches
      // the actual zoom applied — prevents drift when orthoSize hits the floor.
      const nextOrthoSize = Math.max(0.01, this.state.orthoSize * zoomFactor);
      const effectiveFactor = nextOrthoSize / this.state.orthoSize;

      if (mouseX !== undefined && mouseY !== undefined && canvasWidth && canvasHeight) {
        this.shiftTargetTowardsMouse(dir, distance, forward, effectiveFactor, mouseX, mouseY, canvasWidth, canvasHeight);
      }
      this.zoomOrthographic(dir, nextOrthoSize);
    } else {
      if (mouseX !== undefined && mouseY !== undefined && canvasWidth && canvasHeight) {
        this.shiftTargetTowardsMouse(dir, distance, forward, zoomFactor, mouseX, mouseY, canvasWidth, canvasHeight);
      }
      this.zoomPerspective(distance, forward, zoomFactor);
    }

    this.updateMatrices();
  }

  /** Orthographic: set view volume size, keep camera distance unchanged. */
  private zoomOrthographic(dir: Vec3, nextOrthoSize: number): void {
    this.state.orthoSize = nextOrthoSize;
    this.state.camera.position.x = this.state.camera.target.x + dir.x;
    this.state.camera.position.y = this.state.camera.target.y + dir.y;
    this.state.camera.position.z = this.state.camera.target.z + dir.z;
  }

  /**
   * Perspective: dolly-zoom — combines distance reduction with forward travel.
   *
   * Pure multiplicative zoom suffers from Zeno's paradox: each step covers a
   * smaller absolute distance, so the user asymptotically approaches the target
   * but can never pass it. By splitting each zoom step into distance reduction +
   * forward dolly, the camera always makes real progress through the scene.
   */
  private zoomPerspective(distance: number, forward: Vec3, zoomFactor: number): void {
    const zoomStep = distance * (1 - zoomFactor); // positive when zooming in
    const dolly = zoomStep * 0.5;
    const newDistance = Math.max(0.001, distance - dolly);

    // Move target (and orbit center) forward to traverse the scene
    const dollyOffset = scale(forward, dolly);
    addInPlace(this.state.camera.target, dollyOffset);
    if (this.orbitCenter) addInPlace(this.orbitCenter, dollyOffset);

    // Position camera at new distance from updated target
    const t = this.state.camera.target;
    copyInto(this.state.camera.position, {
      x: t.x - forward.x * newDistance,
      y: t.y - forward.y * newDistance,
      z: t.z - forward.z * newDistance,
    });
  }

  /** Shift target toward the world point under the mouse cursor. */
  private shiftTargetTowardsMouse(
    dir: Vec3, distance: number, forward: Vec3, zoomFactor: number,
    mouseX: number, mouseY: number, canvasWidth: number, canvasHeight: number,
  ): void {
    const ndcX = (mouseX / canvasWidth) * 2 - 1;
    const ndcY = 1 - (mouseY / canvasHeight) * 2;

    const right = normalize(cross(forward, this.state.camera.up));
    const actualUp = cross(right, forward);

    const halfHeight = this.state.projectionMode === 'orthographic'
      ? this.state.orthoSize
      : distance * Math.tan(this.state.camera.fov / 2);
    const halfWidth = halfHeight * this.state.camera.aspect;

    // World point under mouse cursor (on the target plane)
    const t = this.state.camera.target;
    const mouseWorld = {
      x: t.x + right.x * ndcX * halfWidth + actualUp.x * ndcY * halfHeight,
      y: t.y + right.y * ndcX * halfWidth + actualUp.y * ndcY * halfHeight,
      z: t.z + right.z * ndcX * halfWidth + actualUp.z * ndcY * halfHeight,
    };

    const moveAmount = 1 - zoomFactor;
    t.x += (mouseWorld.x - t.x) * moveAmount;
    t.y += (mouseWorld.y - t.y) * moveAmount;
    t.z += (mouseWorld.z - t.z) * moveAmount;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Translate target, position, and orbit center by the same offset. */
  private translateAll(offset: Vec3): void {
    addInPlace(this.state.camera.target, offset);
    addInPlace(this.state.camera.position, offset);
    if (this.orbitCenter) {
      addInPlace(this.orbitCenter, offset);
    }
  }
}

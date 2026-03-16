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

/** Dot product */
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Rodrigues' rotation: rotate v around unit axis k by angle (radians). */
function rotateAroundAxis(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(k, v);
  const cx = cross(k, v);
  return {
    x: v.x * c + cx.x * s + k.x * d * (1 - c),
    y: v.y * c + cx.y * s + k.y * d * (1 - c),
    z: v.z * c + cx.z * s + k.z * d * (1 - c),
  };
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
   * When orbitCenter is set (selected object), both position AND target
   * rotate around the orbit center. The camera never moves on selection
   * alone — only when the user actually drags to rotate.
   */
  orbit(deltaX: number, deltaY: number): void {
    this.state.camera.up = { x: 0, y: 1, z: 0 };

    const dx = -deltaX * CC.ORBIT_SENSITIVITY;
    const dy = -deltaY * CC.ORBIT_SENSITIVITY;

    if (this.orbitCenter !== null) {
      this.orbitAroundExternalPivot(this.orbitCenter, dx, dy);
    } else {
      // Standard: rotate position around target
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
   * Orbit both position and target around an external pivot using axis-angle
   * rotation. Both undergo the exact same rigid rotation so the view doesn't
   * jump when the pivot is off-center, and vertical orbit is fully free.
   */
  private orbitAroundExternalPivot(pivot: Vec3, dx: number, dy: number): void {
    let posRel = sub(this.state.camera.position, pivot);
    let tgtRel = sub(this.state.camera.target, pivot);

    // Horizontal: rotate both around Y axis
    const yAxis: Vec3 = { x: 0, y: 1, z: 0 };
    posRel = rotateAroundAxis(posRel, yAxis, dx);
    tgtRel = rotateAroundAxis(tgtRel, yAxis, dx);

    // Vertical: rotate both around camera's right axis
    // The right vector formula gives the left-hand perpendicular, so negate
    // dy to match the spherical convention (positive dy = move down = increase phi).
    const right = normalize({ x: -posRel.z, y: 0, z: posRel.x });
    if (length(right) < 1e-6) return; // degenerate (looking straight down/up)

    // Clamp: check if vertical rotation would exceed pole limits
    const dist = length(posRel);
    const currentPhi = Math.acos(Math.max(-1, Math.min(1, posRel.y / dist)));
    const newPhi = currentPhi + dy;
    if (newPhi < CC.MIN_PHI || newPhi > CC.MAX_PHI) {
      // Apply only horizontal rotation
      copyInto(this.state.camera.position, { x: pivot.x + posRel.x, y: pivot.y + posRel.y, z: pivot.z + posRel.z });
      copyInto(this.state.camera.target, { x: pivot.x + tgtRel.x, y: pivot.y + tgtRel.y, z: pivot.z + tgtRel.z });
      return;
    }

    posRel = rotateAroundAxis(posRel, right, -dy);
    tgtRel = rotateAroundAxis(tgtRel, right, -dy);

    copyInto(this.state.camera.position, { x: pivot.x + posRel.x, y: pivot.y + posRel.y, z: pivot.z + posRel.z });
    copyInto(this.state.camera.target, { x: pivot.x + tgtRel.x, y: pivot.y + tgtRel.y, z: pivot.z + tgtRel.z });
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

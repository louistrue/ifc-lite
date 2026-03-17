/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { Vec3, Camera, Mat4 } from './types.ts';
import { CameraControls, type CameraInternalState } from './camera-controls.ts';
import { CAMERA_CONSTANTS as CC } from './constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function approxEqual(a: number, b: number, eps = 1e-6): void {
  assert.ok(
    Math.abs(a - b) < eps,
    `expected ${a} ≈ ${b} (diff=${Math.abs(a - b)})`,
  );
}

/** Angle between two vectors in radians. */
function angleBetween(a: Vec3, b: Vec3): number {
  const d = dot(a, b) / (len(a) * len(b));
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

function makeMat4(): Mat4 {
  return { m: new Float32Array(16) };
}

function makeCamera(pos: Vec3, target: Vec3): Camera {
  return {
    position: { ...pos },
    target: { ...target },
    up: vec3(0, 1, 0),
    fov: Math.PI / 4,
    aspect: 1,
    near: 0.1,
    far: 1000,
  };
}

function makeState(camera: Camera): CameraInternalState {
  return {
    camera,
    viewMatrix: makeMat4(),
    projMatrix: makeMat4(),
    viewProjMatrix: makeMat4(),
    projectionMode: 'perspective',
    orthoSize: 10,
    sceneBounds: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraControls – standard orbit', () => {
  let state: CameraInternalState;
  let controls: CameraControls;

  beforeEach(() => {
    // Camera at (0, 10, 20) looking at origin
    state = makeState(makeCamera(vec3(0, 10, 20), vec3(0, 0, 0)));
    controls = new CameraControls(state, () => {});
  });

  it('preserves distance to target after orbit', () => {
    const distBefore = len(sub(state.camera.position, state.camera.target));
    controls.orbit(50, 30);
    const distAfter = len(sub(state.camera.position, state.camera.target));
    approxEqual(distBefore, distAfter, 1e-4);
  });

  it('target stays fixed during standard orbit', () => {
    const tBefore = { ...state.camera.target };
    controls.orbit(100, -50);
    approxEqual(state.camera.target.x, tBefore.x);
    approxEqual(state.camera.target.y, tBefore.y);
    approxEqual(state.camera.target.z, tBefore.z);
  });

  it('horizontal orbit changes theta without changing phi much', () => {
    const posBefore = { ...state.camera.position };
    controls.orbit(100, 0); // purely horizontal
    // Y should stay roughly the same (small drift from sensitivity)
    const dirBefore = sub(posBefore, state.camera.target);
    const dirAfter = sub(state.camera.position, state.camera.target);
    approxEqual(dirAfter.y, dirBefore.y, 0.5);
  });
});

describe('CameraControls – external pivot orbit', () => {
  let state: CameraInternalState;
  let controls: CameraControls;

  beforeEach(() => {
    // Camera at (0, 10, 20) looking at (0, 5, 15)
    // Pivot (orbit center) at (5, 5, 15) — off to the side
    state = makeState(makeCamera(vec3(0, 10, 20), vec3(0, 5, 15)));
    controls = new CameraControls(state, () => {});
    controls.setOrbitCenter(vec3(5, 5, 15));
  });

  it('preserves distance from position to pivot', () => {
    const pivot = vec3(5, 5, 15);
    const distBefore = len(sub(state.camera.position, pivot));
    controls.orbit(50, 30);
    const distAfter = len(sub(state.camera.position, pivot));
    approxEqual(distBefore, distAfter, 1e-4);
  });

  it('preserves look distance (|target - position|)', () => {
    const lookBefore = len(sub(state.camera.target, state.camera.position));
    controls.orbit(50, 30);
    const lookAfter = len(sub(state.camera.target, state.camera.position));
    approxEqual(lookBefore, lookAfter, 1e-4);
  });

  it('does NOT snap target to pivot', () => {
    const pivot = vec3(5, 5, 15);
    controls.orbit(80, -40);
    const targetDist = len(sub(state.camera.target, pivot));
    assert.ok(targetDist > 0.1, `target should not coincide with pivot (dist=${targetDist})`);
  });

  it('vertical orbit direction matches standard orbit convention', () => {
    // Dragging mouse down (deltaY > 0) should move camera UP (toward top pole)
    // = position.y relative to pivot should increase
    const pivot = vec3(5, 5, 15);
    const yRelBefore = state.camera.position.y - pivot.y;
    // Large positive deltaY = drag down
    controls.orbit(0, 200);
    const yRelAfter = state.camera.position.y - pivot.y;
    assert.ok(
      yRelAfter > yRelBefore,
      `dragging down should move camera up: yRel ${yRelBefore} → ${yRelAfter}`,
    );
  });

  it('vertical orbit opposite direction also works', () => {
    // Dragging mouse up (deltaY < 0) should move camera DOWN
    const pivot = vec3(5, 5, 15);
    const yRelBefore = state.camera.position.y - pivot.y;
    controls.orbit(0, -200);
    const yRelAfter = state.camera.position.y - pivot.y;
    assert.ok(
      yRelAfter < yRelBefore,
      `dragging up should move camera down: yRel ${yRelBefore} → ${yRelAfter}`,
    );
  });

  it('does not get stuck at the top pole', () => {
    // First orbit to near the top pole
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posAfterUp = { ...state.camera.position };

    // Now orbit back down — should actually move
    for (let i = 0; i < 50; i++) controls.orbit(0, -100);
    const posAfterDown = { ...state.camera.position };

    const moved = len(sub(posAfterDown, posAfterUp));
    assert.ok(moved > 1, `camera should move away from pole (moved=${moved})`);
  });

  it('does not get stuck at the bottom pole', () => {
    // Orbit to near the bottom pole
    for (let i = 0; i < 50; i++) controls.orbit(0, -100);
    const posAfterDown = { ...state.camera.position };

    // Now orbit back up — should actually move
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posAfterUp = { ...state.camera.position };

    const moved = len(sub(posAfterUp, posAfterDown));
    assert.ok(moved > 1, `camera should move away from bottom pole (moved=${moved})`);
  });

  it('look direction never becomes vertical (prevents view matrix flip)', () => {
    // Orbit aggressively in all directions — look should never be within ~0.01 rad of ±Y
    const yAxis = vec3(0, 1, 0);
    for (let i = 0; i < 100; i++) {
      controls.orbit(i % 3 === 0 ? 30 : -30, i % 2 === 0 ? 80 : -80);
      const look = sub(state.camera.target, state.camera.position);
      const angle = angleBetween(look, yAxis);
      assert.ok(
        angle > 0.005 && angle < Math.PI - 0.005,
        `look direction too close to vertical: angle=${angle} at step ${i}`,
      );
    }
  });

  it('horizontal orbit works near the top pole', () => {
    // Move to near the top pole
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posBefore = { ...state.camera.position };

    // Horizontal orbit should still work
    controls.orbit(200, 0);
    const posAfter = { ...state.camera.position };

    const moved = len(sub(posAfter, posBefore));
    assert.ok(moved > 0.1, `horizontal orbit should work near pole (moved=${moved})`);
  });

  it('camera can look from above (position.y > pivot.y)', () => {
    // Orbit up repeatedly
    for (let i = 0; i < 40; i++) controls.orbit(0, 100);
    const pivot = vec3(5, 5, 15);
    assert.ok(
      state.camera.position.y > pivot.y,
      `camera should be above pivot (y=${state.camera.position.y}, pivot.y=${pivot.y})`,
    );
  });

  it('camera can look from below (position.y < pivot.y)', () => {
    // Orbit down repeatedly
    for (let i = 0; i < 40; i++) controls.orbit(0, -100);
    const pivot = vec3(5, 5, 15);
    assert.ok(
      state.camera.position.y < pivot.y,
      `camera should be below pivot (y=${state.camera.position.y}, pivot.y=${pivot.y})`,
    );
  });
});

describe('CameraControls – pan', () => {
  it('moves both position and target by the same offset', () => {
    const state = makeState(makeCamera(vec3(0, 10, 20), vec3(0, 0, 0)));
    const controls = new CameraControls(state, () => {});
    const lookBefore = sub(state.camera.target, state.camera.position);
    controls.pan(5, 3);
    const lookAfter = sub(state.camera.target, state.camera.position);
    approxEqual(lookBefore.x, lookAfter.x, 1e-4);
    approxEqual(lookBefore.y, lookAfter.y, 1e-4);
    approxEqual(lookBefore.z, lookAfter.z, 1e-4);
  });
});

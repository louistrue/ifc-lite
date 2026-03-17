/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { Vec3, Camera, Mat4 } from './types.ts';
import { CameraControls, type CameraInternalState } from './camera-controls.ts';

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

  it('horizontal orbit changes position without changing Y much', () => {
    const yBefore = state.camera.position.y;
    controls.orbit(100, 0); // purely horizontal
    approxEqual(state.camera.position.y, yBefore, 0.5);
  });
});

describe('CameraControls – external pivot orbit (no snap)', () => {
  let state: CameraInternalState;
  let controls: CameraControls;
  const pivot = vec3(5, 5, 15);

  beforeEach(() => {
    // Camera looking slightly off-center from the pivot
    state = makeState(makeCamera(vec3(0, 10, 20), vec3(0, 5, 15)));
    controls = new CameraControls(state, () => {});
    controls.setOrbitCenter(pivot);
  });

  it('does NOT snap target to pivot (no view jump)', () => {
    const tBefore = { ...state.camera.target };
    controls.orbit(10, 5);
    // Target should have moved (rotated around pivot), but NOT snapped to pivot
    const distToOriginal = len(sub(state.camera.target, tBefore));
    const distToPivot = len(sub(state.camera.target, pivot));
    // Target moved but didn't snap to the pivot point
    assert.ok(distToPivot > 0.01, `target should NOT be at pivot (dist=${distToPivot})`);
    assert.ok(distToOriginal > 0, 'target should have moved from original position');
  });

  it('preserves distance from position to pivot', () => {
    const distBefore = len(sub(state.camera.position, pivot));
    controls.orbit(50, 30);
    const distAfter = len(sub(state.camera.position, pivot));
    approxEqual(distBefore, distAfter, 1e-4);
  });

  it('preserves look direction exactly (pos→target vector unchanged)', () => {
    const lookBefore = sub(state.camera.target, state.camera.position);
    controls.orbit(50, 30);
    const lookAfter = sub(state.camera.target, state.camera.position);
    // Translation-based orbit preserves look vector exactly
    approxEqual(lookBefore.x, lookAfter.x, 1e-6);
    approxEqual(lookBefore.y, lookAfter.y, 1e-6);
    approxEqual(lookBefore.z, lookAfter.z, 1e-6);
  });

  it('orbit center persists across multiple orbit calls', () => {
    // First orbit
    controls.orbit(10, 5);
    const posAfterFirst = { ...state.camera.position };
    // Second orbit should still use the external pivot
    controls.orbit(10, 5);
    const posAfterSecond = { ...state.camera.position };
    // Both position and target should have moved (not just position like standard orbit)
    const targetMoved = len(sub(state.camera.target, vec3(0, 5, 15)));
    assert.ok(targetMoved > 0.01, `target should move with external pivot (moved=${targetMoved})`);
  });

  it('does not get stuck at poles', () => {
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posUp = { ...state.camera.position };
    for (let i = 0; i < 50; i++) controls.orbit(0, -100);
    const posDown = { ...state.camera.position };
    const moved = len(sub(posDown, posUp));
    assert.ok(moved > 1, `camera should move away from pole (moved=${moved})`);
  });

  it('reverts to standard orbit when orbitCenter is cleared', () => {
    controls.setOrbitCenter(null);
    const tBefore = { ...state.camera.target };
    controls.orbit(50, 30);
    // Standard orbit: target stays fixed
    approxEqual(state.camera.target.x, tBefore.x);
    approxEqual(state.camera.target.y, tBefore.y);
    approxEqual(state.camera.target.z, tBefore.z);
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

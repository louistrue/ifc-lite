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

describe('CameraControls – external pivot orbit', () => {
  let state: CameraInternalState;
  let controls: CameraControls;
  const pivot = vec3(5, 5, 15);

  beforeEach(() => {
    state = makeState(makeCamera(vec3(0, 10, 20), vec3(0, 5, 15)));
    controls = new CameraControls(state, () => {});
    controls.setOrbitCenter(pivot);
  });

  it('snaps target to pivot on first orbit', () => {
    controls.orbit(10, 5);
    approxEqual(state.camera.target.x, pivot.x);
    approxEqual(state.camera.target.y, pivot.y);
    approxEqual(state.camera.target.z, pivot.z);
  });

  it('preserves distance from position to pivot', () => {
    const distBefore = len(sub(state.camera.position, pivot));
    controls.orbit(50, 30);
    const distAfter = len(sub(state.camera.position, state.camera.target));
    approxEqual(distBefore, distAfter, 1e-4);
  });

  it('after snap, further orbits keep target fixed (like standard orbit)', () => {
    controls.orbit(10, 5); // triggers snap
    const tAfterSnap = { ...state.camera.target };
    controls.orbit(50, 30); // standard orbit now
    approxEqual(state.camera.target.x, tAfterSnap.x);
    approxEqual(state.camera.target.y, tAfterSnap.y);
    approxEqual(state.camera.target.z, tAfterSnap.z);
  });

  it('vertical orbit direction: drag down moves camera up', () => {
    controls.orbit(0, 200); // drag down
    // After snap, target = pivot. Position should be above pivot.
    assert.ok(
      state.camera.position.y > pivot.y,
      `camera should be above pivot (y=${state.camera.position.y}, pivot.y=${pivot.y})`,
    );
  });

  it('vertical orbit direction: drag up moves camera down', () => {
    controls.orbit(0, -200); // drag up
    assert.ok(
      state.camera.position.y < pivot.y,
      `camera should be below pivot (y=${state.camera.position.y}, pivot.y=${pivot.y})`,
    );
  });

  it('does not get stuck at the top pole', () => {
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posUp = { ...state.camera.position };
    for (let i = 0; i < 50; i++) controls.orbit(0, -100);
    const posDown = { ...state.camera.position };
    const moved = len(sub(posDown, posUp));
    assert.ok(moved > 1, `camera should move away from pole (moved=${moved})`);
  });

  it('does not get stuck at the bottom pole', () => {
    for (let i = 0; i < 50; i++) controls.orbit(0, -100);
    const posDown = { ...state.camera.position };
    for (let i = 0; i < 50; i++) controls.orbit(0, 100);
    const posUp = { ...state.camera.position };
    const moved = len(sub(posUp, posDown));
    assert.ok(moved > 1, `camera should move away from bottom pole (moved=${moved})`);
  });

  it('can look from above (position.y > target.y)', () => {
    for (let i = 0; i < 40; i++) controls.orbit(0, 100);
    assert.ok(state.camera.position.y > state.camera.target.y);
  });

  it('can look from below (position.y < target.y)', () => {
    for (let i = 0; i < 40; i++) controls.orbit(0, -100);
    assert.ok(state.camera.position.y < state.camera.target.y);
  });

  it('clears orbitCenter after snap (reverts to standard orbit)', () => {
    controls.orbit(10, 5); // triggers snap + clears orbitCenter
    // Setting a new orbit center and orbiting should snap again
    const newPivot = vec3(10, 10, 10);
    controls.setOrbitCenter(newPivot);
    controls.orbit(10, 5);
    approxEqual(state.camera.target.x, newPivot.x);
    approxEqual(state.camera.target.y, newPivot.y);
    approxEqual(state.camera.target.z, newPivot.z);
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { MeshData } from '@ifc-lite/geometry';
import { applyColorUpdatesToMeshes } from './meshColorUpdates.js';

function createMesh(
  expressId: number,
  color: [number, number, number, number]
): MeshData {
  return {
    expressId,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    color,
    ifcType: 'IfcWall',
  };
}

describe('applyColorUpdatesToMeshes', () => {
  it('applies deferred colors to matching expressIds', () => {
    const meshes = [
      createMesh(1, [0.8, 0.8, 0.8, 1]),
      createMesh(2, [0.8, 0.8, 0.8, 1]),
    ];
    const updates = new Map<number, [number, number, number, number]>([
      [2, [0.6, 0.2, 0.8, 0.4]],
    ]);

    applyColorUpdatesToMeshes(meshes, updates);

    assert.deepStrictEqual(meshes[0].color, [0.8, 0.8, 0.8, 1]);
    assert.deepStrictEqual(meshes[1].color, [0.6, 0.2, 0.8, 0.4]);
  });

  it('is a no-op for empty updates', () => {
    const meshes = [createMesh(10, [0.2, 0.2, 0.2, 1])];
    applyColorUpdatesToMeshes(meshes, new Map());
    assert.deepStrictEqual(meshes[0].color, [0.2, 0.2, 0.2, 1]);
  });

  it('is a no-op for empty meshes', () => {
    const meshes: MeshData[] = [];
    const updates = new Map<number, [number, number, number, number]>([
      [10, [0.3, 0.4, 0.5, 1]],
    ]);

    assert.doesNotThrow(() => applyColorUpdatesToMeshes(meshes, updates));
    assert.strictEqual(meshes.length, 0);
  });
});

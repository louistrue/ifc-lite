/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { PickingManager } from './picking-manager.ts';

describe('PickingManager', () => {
  it('uses raycast when geometry data was released after finalize', async () => {
    let raycastCalls = 0;
    let pickerCalls = 0;
    let meshCreations = 0;

    const camera = {
      unprojectToRay: () => ({
        origin: { x: 1, y: 2, z: 3 },
        direction: { x: 0, y: 0, z: -1 },
      }),
    };

    const scene = {
      getMeshes: () => [],
      getBatchedMeshes: () => [{ expressIds: [101] }],
      isGeometryDataReleased: () => true,
      raycast: () => {
        raycastCalls += 1;
        return { expressId: 101, modelIndex: 0 };
      },
    };

    const picker = {
      pick: async () => {
        pickerCalls += 1;
        return null;
      },
    };

    const canvas = {
      width: 100,
      height: 100,
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
    };

    const manager = new PickingManager(
      camera as never,
      scene as never,
      picker as never,
      canvas as HTMLCanvasElement,
      () => {
        meshCreations += 1;
      },
    );

    const result = await manager.pick(50, 50);

    assert.deepStrictEqual(result, { expressId: 101, modelIndex: 0 });
    assert.equal(raycastCalls, 1);
    assert.equal(pickerCalls, 0);
    assert.equal(meshCreations, 0);
  });
});

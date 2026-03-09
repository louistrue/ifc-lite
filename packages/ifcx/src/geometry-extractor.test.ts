/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractGeometry } from './geometry-extractor.js';
import { ATTR, type ComposedNode, type UsdMesh } from './types.js';

function createNode(path: string): ComposedNode {
  return {
    path,
    attributes: new Map(),
    children: new Map(),
  };
}

function attachChild(parent: ComposedNode, child: ComposedNode, key: string): void {
  child.parent = parent;
  parent.children.set(key, child);
}

function createMesh(): UsdMesh {
  return {
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    faceVertexIndices: [0, 1, 2],
  };
}

describe('extractGeometry', () => {
  it('traverses disconnected cycle components even when other roots exist', () => {
    const root = createNode('root');
    root.attributes.set(ATTR.CLASS, { code: 'IfcWall' });
    root.attributes.set(ATTR.MESH, createMesh());

    const cycleA = createNode('cycle-a');
    cycleA.attributes.set(ATTR.CLASS, { code: 'IfcWindow' });

    const cycleB = createNode('cycle-b');
    cycleB.attributes.set(ATTR.CLASS, { code: 'IfcWindow' });
    cycleB.attributes.set(ATTR.MESH, createMesh());

    attachChild(cycleA, cycleB, 'b');
    attachChild(cycleB, cycleA, 'a');

    const composed = new Map<string, ComposedNode>([
      [root.path, root],
      [cycleA.path, cycleA],
      [cycleB.path, cycleB],
    ]);
    const pathToId = new Map([
      [root.path, 1],
      [cycleA.path, 2],
      [cycleB.path, 3],
    ]);

    const meshes = extractGeometry(composed, pathToId);

    assert.strictEqual(meshes.length, 2);
    assert.deepStrictEqual(meshes.map((mesh) => mesh.expressId).sort((a, b) => a - b), [1, 3]);
  });

  it('keeps geometry for entity ids whose class object has no code', () => {
    const entity = createNode('entity');
    entity.attributes.set(ATTR.CLASS, {});

    const body = createNode('entity/body');
    body.attributes.set(ATTR.MESH, createMesh());
    attachChild(entity, body, 'Body');

    const composed = new Map<string, ComposedNode>([
      [entity.path, entity],
      [body.path, body],
    ]);
    const pathToId = new Map([[entity.path, 7]]);

    const meshes = extractGeometry(composed, pathToId);

    assert.strictEqual(meshes.length, 1);
    assert.strictEqual(meshes[0].expressId, 7);
    assert.strictEqual(meshes[0].ifcType, undefined);
  });
});

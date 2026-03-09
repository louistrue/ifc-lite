/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { StringTable } from '@ifc-lite/data';
import { extractEntities } from './entity-extractor.js';
import { ATTR, type ComposedNode, type UsdMesh } from './types.js';

function createNode(path: string): ComposedNode {
  return {
    path,
    attributes: new Map(),
    children: new Map(),
  };
}

function attachChild(parent: ComposedNode, child: ComposedNode, key: string): void {
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

describe('extractEntities', () => {
  it('uses incoming edge names without relying on a single parent pointer', () => {
    const storey = createNode('storey');
    storey.attributes.set(ATTR.CLASS, { code: 'IfcBuildingStorey' });

    const wall = createNode('wall');
    wall.attributes.set(ATTR.CLASS, { code: 'IfcWall' });

    const window = createNode('window');
    window.attributes.set(ATTR.CLASS, { code: 'IfcWindow' });

    attachChild(storey, wall, 'Wall');
    wall.children.set('Kitchen Window', window);

    const strings = new StringTable();
    const { entities } = extractEntities(new Map([
      [storey.path, storey],
      [wall.path, wall],
      [window.path, window],
    ]), strings);

    assert.strictEqual(entities.getName(3), 'Kitchen Window');
    assert.strictEqual(entities.getTypeName(3), 'IfcWindow');
  });

  it('retains entity ids and geometry flags when class objects have no code', () => {
    const entity = createNode('entity');
    entity.attributes.set(ATTR.CLASS, {});

    const body = createNode('body');
    body.attributes.set(ATTR.MESH, createMesh());
    attachChild(entity, body, 'Body');

    const strings = new StringTable();
    const { entities, pathToId } = extractEntities(new Map([
      [entity.path, entity],
      [body.path, body],
    ]), strings);

    const expressId = pathToId.get(entity.path);
    assert.strictEqual(expressId, 1);
    assert.strictEqual(entities.hasGeometry(1), true);
    assert.strictEqual(entities.getTypeName(1), 'Unknown');
  });
});

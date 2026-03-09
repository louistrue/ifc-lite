/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFederatedIfcx, parseIfcx } from '../dist/index.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../../..');
const fixturesDir = path.join(repoRoot, 'tests/models/ifc5');

function loadFixture(name) {
  const buffer = readFileSync(path.join(fixturesDir, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function main() {
  const base = loadFixture('Hello_Wall_hello-wall.ifcx');
  const overlay = loadFixture('Hello_Wall_advanced_3rd-window.ifcx');

  const baseResult = await parseIfcx(base);
  const baseWindowIds = [...new Set(
    baseResult.meshes.filter((mesh) => mesh.ifcType === 'IfcWindow').map((mesh) => mesh.expressId)
  )].sort((a, b) => a - b);

  assert.strictEqual(baseResult.meshes.length, 10);
  assert.deepStrictEqual(baseWindowIds, [3, 4]);
  assert.deepStrictEqual(baseResult.spatialHierarchy.byStorey.get(6), [5, 3, 4]);
  assert.deepStrictEqual(baseResult.spatialHierarchy.bySpace.get(2), [5, 3, 4]);

  const federatedResult = await parseFederatedIfcx([
    { buffer: base, name: 'hello-wall.ifcx' },
    { buffer: overlay, name: '3rd-window.ifcx' },
  ]);
  const federatedWindowIds = [...new Set(
    federatedResult.meshes.filter((mesh) => mesh.ifcType === 'IfcWindow').map((mesh) => mesh.expressId)
  )].sort((a, b) => a - b);

  assert.strictEqual(federatedResult.meshes.length, 10);
  assert.deepStrictEqual(federatedWindowIds, [1, 2]);
  assert.deepStrictEqual(federatedResult.spatialHierarchy.byStorey.get(7), [4, 1, 2, 3]);
  assert.deepStrictEqual(federatedResult.spatialHierarchy.bySpace.get(6), [4, 1, 2]);
}

await main();

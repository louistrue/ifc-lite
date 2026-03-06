/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScriptPreflight } from './script-preflight.js';

test('preflight accepts schema-exposed create methods', () => {
  const code = `
const h = bim.create.project({ Name: "Schema Coverage" });
const s0 = bim.create.addIfcBuildingStorey(h, { Name: "Level 0", Elevation: 0 });
const id = bim.create.addElement(h, s0, {
  Type: "IfcBuildingElementProxy",
  Name: "Proxy",
  Profile: { kind: "rect", xDim: 1, yDim: 1 },
  Position: [0, 0, 0],
  Height: 3
});
console.log(id);
`;

  const errors = validateScriptPreflight(code);
  assert.deepEqual(errors, []);
});

test('preflight suggests nearest method names for typos', () => {
  const code = `
const h = bim.create.project({ Name: "Typo" });
const s0 = bim.create.addIfcBuildingStorey(h, { Name: "Level 0", Elevation: 0 });
bim.create.addIfcWal(h, s0, { Start: [0, 0, 0], End: [1, 0, 0], Thickness: 0.2, Height: 3 });
`;

  const errors = validateScriptPreflight(code);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Did you mean `bim\.create\.addIfcWall\(\)`\?/);
});

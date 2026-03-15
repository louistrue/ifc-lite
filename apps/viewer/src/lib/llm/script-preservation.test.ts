/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUsePlainCodeBlockFallback,
  validateScriptReplacementCandidate,
} from './script-preservation.js';

const FULL_TOWER_SCRIPT = `
const h = bim.create.project({ Name: "Tower" });
const floors = 20;
const floorHeight = 3.5;

for (let i = 0; i < floors; i++) {
  const elevation = i * floorHeight;
  const storey = bim.create.addIfcBuildingStorey(h, { Name: "Level " + i, Elevation: elevation });
  bim.create.addIfcSlab(h, storey, { Position: [0, 0, 0], Width: 30, Depth: 40, Thickness: 0.3 });
}

const result = bim.create.toIfc(h);
bim.model.loadIfc(result.content, "tower.ifc");
`;

test('repair turns disable plain js fallback', () => {
  assert.equal(canUsePlainCodeBlockFallback('repair'), false);
  assert.equal(canUsePlainCodeBlockFallback('create'), true);
});

test('replacement validator blocks facade-only repair fallback', () => {
  const result = validateScriptReplacementCandidate({
    previousContent: FULL_TOWER_SCRIPT,
    candidateContent: `
for (let y = 0; y < depth; y += module) {
  bim.create.addIfcMember(h, storey, {
    Start: [width + 0.15, y, elevation],
    End: [width + 0.15, y + module, elevation + floorHeight],
    Width: 0.15,
    Height: 0.35,
  });
}
`,
    intent: 'repair',
    source: 'code_block_fallback',
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic?.code, 'unsafe_full_replacement');
});

test('replacement validator blocks manual full replace for detached snippet fragments', () => {
  const result = validateScriptReplacementCandidate({
    previousContent: FULL_TOWER_SCRIPT,
    candidateContent: `
for (let x = 0; x < width; x += 3) {
  bim.create.addIfcMember(h, storey, {
    Start: [x, -0.2, z],
    End: [x, -0.2, z + 3.5],
    Width: 0.25,
    Height: 0.15,
  });
}
`,
    intent: 'explicit_rewrite',
    source: 'manual_replace_all',
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic?.code, 'destructive_partial_rewrite');
});

test('replacement validator allows complete rewrites that use destructured loop bindings', () => {
  const result = validateScriptReplacementCandidate({
    previousContent: FULL_TOWER_SCRIPT,
    candidateContent: `
const h = bim.create.project({ Name: "3-Story House" });

const storyHeight = 3.0;
const floorThickness = 0.3;
const wallThickness = 0.25;
const roofThickness = 0.25;
const windowWidth = 1.2;
const windowHeight = 1.5;
const windowSillHeight = 0.9;

const s0 = bim.create.addIfcBuildingStorey(h, { Name: "Ground Floor", Elevation: 0 });
const s1 = bim.create.addIfcBuildingStorey(h, { Name: "First Floor", Elevation: storyHeight });
const s2 = bim.create.addIfcBuildingStorey(h, { Name: "Second Floor", Elevation: storyHeight * 2 });

for (const [i, storey] of [s0, s1, s2].entries()) {
  bim.create.addIfcWall(h, storey, {
    Name: "North Wall Level " + i,
    Start: [0, 0, 0],
    End: [10, 0, 0],
    Height: storyHeight,
    Thickness: wallThickness,
    Openings: [
      {
        Position: [2.5, 0, windowSillHeight],
        Width: windowWidth,
        Height: windowHeight
      }
    ]
  });
}

bim.create.addIfcGableRoof(h, s2, {
  Name: "Gable Roof",
  Position: [0, 0, storyHeight],
  Width: 10,
  Depth: 8,
  Thickness: roofThickness,
  Slope: 30 * Math.PI / 180,
  Overhang: 0.5
});

const result = bim.create.toIfc(h);
bim.model.loadIfc(result.content, "3-story-house-with-windows.ifc");
`,
    intent: 'explicit_rewrite',
    source: 'manual_replace_all',
  });

  assert.equal(result.ok, true);
  assert.equal(result.detachedDiagnostics.length, 0);
});

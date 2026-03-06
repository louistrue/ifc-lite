/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NAMESPACE_SCHEMAS } from '@ifc-lite/sandbox/schema';
import { buildSystemPrompt } from './system-prompt.js';

test('system prompt includes all schema namespaces and methods', () => {
  const prompt = buildSystemPrompt();

  for (const schema of NAMESPACE_SCHEMAS) {
    assert.match(
      prompt,
      new RegExp(`###\\s+bim\\.${schema.name}\\s+—`),
      `Missing namespace heading for bim.${schema.name}`,
    );
    for (const method of schema.methods) {
      assert.match(
        prompt,
        new RegExp(`bim\\.${schema.name}\\.${method.name}\\(`),
        `Missing method reference for bim.${schema.name}.${method.name}()`,
      );
    }
  }
});

test('system prompt includes script editor revision context when provided', () => {
  const prompt = buildSystemPrompt(undefined, undefined, {
    content: 'const n = 1;',
    revision: 42,
    selection: { from: 6, to: 7 },
  });
  assert.match(prompt, /Current script revision:\s+42/);
  assert.match(prompt, /Current selection:\s+from=6, to=7/);
  assert.match(prompt, /```ifc-script-edits/);
});

test('system prompt includes storey hierarchy context when provided', () => {
  const prompt = buildSystemPrompt({
    models: [{ name: 'Tower', entityCount: 500 }],
    typeCounts: { IfcWall: 120 },
    selectedCount: 0,
    storeys: [
      { modelName: 'Tower', name: 'Level 01', elevation: 0, height: 3.5, elementCount: 42 },
      { modelName: 'Tower', name: 'Level 02', elevation: 3.5, height: 3.5, elementCount: 40 },
    ],
  });
  assert.match(prompt, /CURRENT MODEL STATE/);
  assert.match(prompt, /Storeys: Tower: Level 01 @ 0m, height≈3.5m, elements=42 \| Tower: Level 02 @ 3.5m, height≈3.5m, elements=40/);
});

test('system prompt includes selected entity IFC context when provided', () => {
  const prompt = buildSystemPrompt({
    models: [{ name: 'Tower', entityCount: 500 }],
    typeCounts: { IfcWall: 120 },
    selectedCount: 1,
    selectedEntities: [
      {
        modelName: 'Tower',
        name: 'Facade Panel A',
        type: 'IfcCurtainWall',
        storeyName: 'Level 10',
        storeyElevation: 31.5,
        propertySets: ['Pset_CurtainWallCommon'],
        quantitySets: ['Qto_CurtainWallBaseQuantities'],
        materialName: 'Aluminium',
        classifications: ['A-123'],
      },
    ],
  });
  assert.match(prompt, /1 entities currently selected in the viewer/);
  assert.match(prompt, /Selected entities: Tower: IfcCurtainWall "Facade Panel A", storey=Level 10@31.5m, psets=Pset_CurtainWallCommon, qsets=Qto_CurtainWallBaseQuantities, material=Aluminium, classifications=A-123/);
});

test('system prompt includes method-specific create contract guidance', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /BIM\.CREATE CONTRACT CHEAT SHEET/);
  assert.match(prompt, /addIfcRoof.*mono-pitch roof slab.*Do NOT use `Profile`, `Height`, or `ExtrusionHeight`/s);
  assert.match(prompt, /addIfcGableRoof.*dual-pitch house roofs/s);
  assert.match(prompt, /addIfcWallDoor.*wall-local `Position`/s);
  assert.match(prompt, /addIfcWallWindow.*wall-local `Position`/s);
  assert.match(prompt, /Wall-hosted openings: use `Openings` inside `addIfcWall/);
  assert.match(prompt, /resolve the target storeys first and then add geometry to EACH intended storey/);
  assert.match(prompt, /When CURRENT MODEL STATE includes storeys, use those storey names\/elevations as the source of truth/);
  assert.match(prompt, /inspect the actual model first.*bim\.query\.selection\(\).*bim\.query\.storeys\(\).*bim\.query\.path\(entity\).*bim\.query\.materials\(entity\).*bim\.query\.classifications\(entity\)/s);
  assert.match(prompt, /Materials are usually NOT ordinary property-set values/);
  assert.match(prompt, /Prefer `bim\.query\.classifications\(entity\)` over guessing ad-hoc classification properties/);
  assert.match(prompt, /const material = bim\.query\.materials\(wall\);/);
  assert.match(prompt, /addIfcDoor` and `addIfcWindow`: these create standalone world-aligned elements/);
  assert.match(prompt, /If doors or windows appear rotated 90° relative to a wall/);
  assert.match(prompt, /If a façade or other repeated envelope element appears only at one level/);
  assert.match(prompt, /house, pitched-roof, or gable-roof requests, prefer `addIfcGableRoof`/);
  assert.match(prompt, /If the user asks for a house roof, pitched roof, or gable roof, default to `addIfcGableRoof`/);
  assert.match(prompt, /convert it to radians first .*addIfcRoof.*addIfcGableRoof/s);
  assert.match(prompt, /addElement.*Use `IfcType`, `Placement:/s);
  assert.match(prompt, /Use `IfcType` not `Type`; use `Placement` not `Position`/);
  assert.match(prompt, /Many advanced methods are world-placement based/);
});

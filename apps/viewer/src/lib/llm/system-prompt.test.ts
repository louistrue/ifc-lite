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

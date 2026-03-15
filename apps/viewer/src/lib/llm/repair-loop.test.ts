/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from './types.js';
import { buildRepairAttemptKey, buildRepairSessionKey, getEscalatedRepairScope, pruneMessagesForRepair } from './repair-loop.js';
import { createPreflightDiagnostic } from './script-diagnostics.js';

test('pruneMessagesForRepair removes prior repair prompt and patch reply context', () => {
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'Create a house', createdAt: 1 },
    { id: '2', role: 'assistant', content: '```js\nconst h = 1;\n```', createdAt: 2 },
    { id: '3', role: 'user', content: 'The script needs a root-cause repair.\n\nFailure type: preflight', createdAt: 3 },
    { id: '4', role: 'assistant', content: '```ifc-script-edits\n{"scriptEdits":[]}\n```', createdAt: 4 },
    { id: '5', role: 'user', content: 'Add a roof', createdAt: 5 },
  ];

  const pruned = pruneMessagesForRepair(messages);
  assert.deepEqual(pruned.map((message) => message.id), ['1', '2', '5']);
});

test('buildRepairAttemptKey stays stable for same targeted failure', () => {
  const diagnostics = [
    createPreflightDiagnostic(
      'wall_hosted_opening_pattern',
      'Suspicious door call.',
      'error',
      {
        methodName: 'addIfcDoor',
        range: { from: 120, to: 180 },
        snippet: 'bim.create.addIfcDoor(h, ground, { Name: "Front Door" });',
      },
    ),
  ];

  const first = buildRepairAttemptKey({
    reason: 'preflight',
    diagnostics,
    currentCode: 'const h = bim.create.project({ Name: "House" });',
  });
  const second = buildRepairAttemptKey({
    reason: 'preflight',
    diagnostics,
    currentCode: 'const h = bim.create.project({ Name: "House" });',
  });

  assert.equal(first, second);
});

test('pruneMessagesForRepair also removes malformed assistant repair replies', () => {
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'Create a tower', createdAt: 1 },
    { id: '2', role: 'assistant', content: '```js\nconst h = 1;\n```', createdAt: 2 },
    { id: '3', role: 'user', content: 'The script needs a root-cause repair.\n\nFailure type: patch-apply', createdAt: 3 },
    { id: '4', role: 'assistant', content: 'Here is a corrected snippet:\n```js\nconst width = 30;\n```', createdAt: 4 },
    { id: '5', role: 'user', content: 'Try again', createdAt: 5 },
  ];

  const pruned = pruneMessagesForRepair(messages);
  assert.deepEqual(pruned.map((message) => message.id), ['1', '2', '5']);
});

test('buildRepairSessionKey tracks the root cause across script revisions', () => {
  const diagnostics = [
    createPreflightDiagnostic(
      'detached_snippet_scope',
      'Detached snippet risk.',
      'error',
      { symbol: 'width' },
    ),
  ];

  const first = buildRepairSessionKey({
    diagnostics,
    currentCode: 'const width = 30;',
  });
  const second = buildRepairSessionKey({
    diagnostics,
    currentCode: 'const width = 30;\nconst depth = 40;',
  });

  assert.equal(first, second);
});

test('getEscalatedRepairScope widens repair sessions once', () => {
  assert.equal(getEscalatedRepairScope('local'), 'block');
  assert.equal(getEscalatedRepairScope('block'), 'structural');
  assert.equal(getEscalatedRepairScope('structural'), null);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScriptEditOperations, extractScriptEditOps, filterUnappliedScriptOps } from './script-edit-ops.js';

test('extractScriptEditOps parses ops from ifc-script-edits block', () => {
  const text = `
Hello
\`\`\`ifc-script-edits
{"scriptEdits":[
  {"opId":"op-1","type":"replaceSelection","baseRevision":3,"text":"const x = 1;"},
  {"opId":"op-2","type":"append","baseRevision":3,"text":"\\nconsole.log(x)"}
]}
\`\`\`
`;
  const result = extractScriptEditOps(text);
  assert.equal(result.parseErrors.length, 0);
  assert.equal(result.operations.length, 2);
  assert.equal(result.operations[0].opId, 'op-1');
  assert.equal(result.operations[1].type, 'append');
});

test('filterUnappliedScriptOps drops already applied op ids', () => {
  const result = extractScriptEditOps(`
\`\`\`ifc-script-edits
{"scriptEdits":[
  {"opId":"op-1","type":"append","baseRevision":1,"text":"a"},
  {"opId":"op-2","type":"append","baseRevision":1,"text":"b"}
]}
\`\`\`
`);
  const filtered = filterUnappliedScriptOps(result.operations, new Set(['op-1']));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].opId, 'op-2');
});

test('applyScriptEditOperations applies replaceSelection and append in one revision', () => {
  const applied = applyScriptEditOperations({
    content: 'const a = 1;',
    selection: { from: 6, to: 7 },
    revision: 5,
    operations: [
      { opId: 'op-1', type: 'replaceSelection', baseRevision: 5, text: 'b' },
      { opId: 'op-2', type: 'append', baseRevision: 5, text: '\nconsole.log(b)' },
    ],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 6);
  assert.equal(applied.content, 'const b = 1;\nconsole.log(b)');
  assert.deepEqual(applied.appliedOpIds, ['op-1', 'op-2']);
});

test('applyScriptEditOperations rejects stale revision', () => {
  const applied = applyScriptEditOperations({
    content: 'const a = 1;',
    selection: { from: 0, to: 0 },
    revision: 2,
    operations: [
      { opId: 'op-1', type: 'append', baseRevision: 1, text: '\nconsole.log(a)' },
    ],
  });
  assert.equal(applied.ok, false);
  assert.match(applied.error ?? '', /expected base revision is 2/);
});

test('applyScriptEditOperations accepts fixed base revision across stream batches', () => {
  const first = applyScriptEditOperations({
    content: 'if (f > 0) {\n  facade();\n}',
    selection: { from: 0, to: 0 },
    revision: 1,
    acceptedBaseRevision: 1,
    operations: [
      {
        opId: 'remove-ground-skip',
        type: 'replaceRange',
        baseRevision: 1,
        from: 0,
        to: 11,
        text: '',
      },
    ],
  });
  assert.equal(first.ok, true);
  assert.equal(first.revision, 2);

  const second = applyScriptEditOperations({
    content: first.content,
    selection: first.selection,
    revision: first.revision,
    acceptedBaseRevision: 1,
    operations: [
      {
        opId: 'normalize-indent',
        type: 'replaceRange',
        baseRevision: 1,
        from: 0,
        to: 0,
        text: '// edited\n',
      },
    ],
  });
  assert.equal(second.ok, true);
  assert.equal(second.revision, 3);
});

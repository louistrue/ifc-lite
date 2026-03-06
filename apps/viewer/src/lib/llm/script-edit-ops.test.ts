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
  assert.equal(applied.status, 'ok');
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
  assert.equal(applied.status, 'revision_conflict');
  assert.match(applied.error ?? '', /expected base revision is 2/);
  assert.equal(applied.diagnostic?.code, 'patch_revision_conflict');
});

test('applyScriptEditOperations accepts fixed base revision across stream batches', () => {
  const baseContent = 'if (f > 0) {\n  facade();\n}';
  const first = applyScriptEditOperations({
    content: baseContent,
    selection: { from: 0, to: 0 },
    revision: 1,
    acceptedBaseRevision: 1,
    baseContentSnapshot: baseContent,
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
  assert.equal(first.status, 'ok');
  assert.equal(first.revision, 2);

  const second = applyScriptEditOperations({
    content: first.content,
    selection: first.selection,
    revision: first.revision,
    priorAcceptedOps: [
      { opId: 'prefix', type: 'insert', baseRevision: 1, at: 0, text: '12' },
    ],
    acceptedBaseRevision: 1,
    baseContentSnapshot: baseContent,
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
  assert.equal(second.status, 'ok');
  assert.equal(second.revision, 3);
});

test('applyScriptEditOperations rebases positional ops against the original base snapshot', () => {
  const baseContent = 'abcdef';
  const first = applyScriptEditOperations({
    content: baseContent,
    selection: { from: 0, to: 0 },
    revision: 1,
    acceptedBaseRevision: 1,
    baseContentSnapshot: baseContent,
    operations: [
      { opId: 'prefix', type: 'insert', baseRevision: 1, at: 0, text: '12' },
    ],
  });
  assert.equal(first.ok, true);
  assert.equal(first.content, '12abcdef');

  const second = applyScriptEditOperations({
    content: first.content,
    selection: first.selection,
    revision: first.revision,
    priorAcceptedOps: [
      { opId: 'prefix', type: 'insert', baseRevision: 1, at: 0, text: '12' },
    ],
    acceptedBaseRevision: 1,
    baseContentSnapshot: baseContent,
    operations: [
      { opId: 'replace-cd', type: 'replaceRange', baseRevision: 1, from: 2, to: 4, text: 'ZZ' },
    ],
  });
  assert.equal(second.ok, true);
  assert.equal(second.content, '12abZZef');
});

test('applyScriptEditOperations rejects overlapping stale range ops before mutating content', () => {
  const baseContent = 'const width = 30;\nconst depth = 40;\n';
  const applied = applyScriptEditOperations({
    content: baseContent,
    selection: { from: 0, to: 0 },
    revision: 3,
    acceptedBaseRevision: 3,
    baseContentSnapshot: baseContent,
    operations: [
      { opId: 'rename-width', type: 'replaceRange', baseRevision: 3, from: 6, to: 11, text: 'span' },
      { opId: 'rename-width-again', type: 'replaceRange', baseRevision: 3, from: 8, to: 13, text: 'measure' },
    ],
  });

  assert.equal(applied.ok, false);
  assert.equal(applied.status, 'revision_conflict');
  assert.equal(applied.content, baseContent);
  assert.equal(applied.diagnostic?.code, 'patch_revision_conflict');
});

test('applyScriptEditOperations blocks replaceAll during repair turns', () => {
  const applied = applyScriptEditOperations({
    content: 'const h = bim.create.project({ Name: "Tower" });\nconst result = bim.create.toIfc(h);\n',
    selection: { from: 0, to: 0 },
    revision: 4,
    intent: 'repair',
    operations: [
      {
        opId: 'rewrite-fragment',
        type: 'replaceAll',
        baseRevision: 4,
        text: 'for (let x = 0; x < width; x += 3) {\n  facade(x);\n}\n',
      },
    ],
  });

  assert.equal(applied.ok, false);
  assert.equal(applied.status, 'semantic_error');
  assert.equal(applied.diagnostic?.code, 'unsafe_full_replacement');
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from './context-builder.js';

test('parseCSV preserves embedded newlines inside quoted fields', () => {
  const csv = 'Name,Notes\n"Lobby","Line 1\nLine 2"\n"Office","Single line"';

  const parsed = parseCSV(csv);

  assert.deepEqual(parsed.columns, ['Name', 'Notes']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.Notes, 'Line 1\nLine 2');
  assert.equal(parsed.rows[1]?.Notes, 'Single line');
});

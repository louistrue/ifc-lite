/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { StringTable } from './string-table.js';

describe('StringTable', () => {
  it('should start with empty string at index 0', () => {
    const table = new StringTable();
    assert.equal(table.count, 1);
    assert.equal(table.get(0), '');
  });

  it('should intern new strings and return indices', () => {
    const table = new StringTable();
    const idx1 = table.intern('hello');
    const idx2 = table.intern('world');

    assert.equal(idx1, 1);
    assert.equal(idx2, 2);
    assert.equal(table.count, 3);
  });

  it('should deduplicate identical strings', () => {
    const table = new StringTable();
    const idx1 = table.intern('hello');
    const idx2 = table.intern('hello');

    assert.equal(idx1, idx2);
    assert.equal(table.count, 2); // Empty string + 'hello'
  });

  it('should return NULL_INDEX for null and undefined', () => {
    const table = new StringTable();

    assert.equal(table.intern(null), table.NULL_INDEX);
    assert.equal(table.intern(undefined), table.NULL_INDEX);
    assert.equal(table.NULL_INDEX, -1);
  });

  it('should retrieve strings by index', () => {
    const table = new StringTable();
    table.intern('hello');
    table.intern('world');

    assert.equal(table.get(1), 'hello');
    assert.equal(table.get(2), 'world');
  });

  it('should return empty string for invalid indices', () => {
    const table = new StringTable();

    assert.equal(table.get(-1), '');
    assert.equal(table.get(999), '');
  });

  it('should check if string exists', () => {
    const table = new StringTable();
    table.intern('hello');

    assert.equal(table.has('hello'), true);
    assert.equal(table.has('nonexistent'), false);
  });

  it('should return indexOf for strings', () => {
    const table = new StringTable();
    table.intern('hello');

    assert.equal(table.indexOf('hello'), 1);
    assert.equal(table.indexOf('nonexistent'), -1);
  });

  it('should return all strings via getAll', () => {
    const table = new StringTable();
    table.intern('hello');
    table.intern('world');

    const all = table.getAll();
    assert.deepEqual(all, ['', 'hello', 'world']);
  });
});

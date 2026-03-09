/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisibilityFilterSets } from './export-adapter.js';
import { LEGACY_MODEL_ID } from './model-compat.js';

test('resolveVisibilityFilterSets honors legacy single-model hidden and isolated state', () => {
  const state = {
    models: new Map(),
    hiddenEntities: new Set([11, 12]),
    isolatedEntities: new Set([21, 22]),
    hiddenEntitiesByModel: new Map(),
    isolatedEntitiesByModel: new Map(),
  };

  const result = resolveVisibilityFilterSets(state as never, LEGACY_MODEL_ID, new Set([1, 2, 3]), 3);

  assert.equal(result.visibleOnly, false);
  assert.deepEqual([...result.hiddenEntityIds], [11, 12]);
  assert.deepEqual(result.isolatedEntityIds ? [...result.isolatedEntityIds] : null, [21, 22]);
});

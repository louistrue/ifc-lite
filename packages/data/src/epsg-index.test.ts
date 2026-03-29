/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  loadEpsgIndexDatasetVersion,
  lookupEpsgByCode,
  searchEpsgIndex,
} from './epsg-index.js';

describe('EPSG index', () => {
  it('loads dataset metadata', async () => {
    await expect(loadEpsgIndexDatasetVersion()).resolves.toBe('12.054');
  });

  it('looks up CRS by exact code', async () => {
    const entry = await lookupEpsgByCode(2056);
    expect(entry).toBeDefined();
    expect(entry?.code).toBe('2056');
    expect(entry?.name).toContain('LV95');
    expect(entry?.kind).toBe('Projected');
  });

  it('supports numeric prefix lookup across the full index', async () => {
    const entries = await lookupEpsgByCode('205', { prefix: true, limit: 10 });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some(entry => entry.code === '2056')).toBe(true);
  });

  it('finds common text queries locally', async () => {
    const results = await searchEpsgIndex('web mercator');
    expect(results[0]?.code).toBe('3857');
  });

  it('matches multi-token location queries', async () => {
    const results = await searchEpsgIndex('new york long island');
    expect(results.some(result => result.code === '2263')).toBe(true);
  });
});

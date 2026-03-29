/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EpsgIndexEntry, SearchEpsgIndexOptions } from './epsg-types.js';

let epsgIndexPromise: Promise<readonly EpsgIndexEntry[]> | null = null;
let epsgByCodePromise: Promise<ReadonlyMap<string, EpsgIndexEntry>> | null = null;
let epsgDatasetVersionPromise: Promise<string> | null = null;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function scoreEntry(entry: EpsgIndexEntry, query: string): number {
  if (!query) return 0;

  let score = 0;

  if (entry.code === query) score += 1000;
  else if (entry.code.startsWith(query)) score += 700;

  const name = entry.name.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const tokenMatches = tokens.filter(token => entry.searchText.includes(token)).length;
  if (name === query) score += 500;
  else if (name.startsWith(query)) score += 350;
  else if (name.includes(query)) score += 200;

  for (const alias of entry.aliases) {
    const aliasLower = alias.toLowerCase();
    if (aliasLower === query) score += 250;
    else if (aliasLower.startsWith(query)) score += 175;
    else if (aliasLower.includes(query)) score += 100;
  }

  if (entry.searchText.includes(query)) score += 50;
  if (tokens.length > 1 && tokenMatches === tokens.length) score += 120;
  else score += tokenMatches * 20;
  if (!entry.deprecated) score += 10;

  return score;
}

export async function loadEpsgIndex(): Promise<readonly EpsgIndexEntry[]> {
  if (!epsgIndexPromise) {
    epsgIndexPromise = import('./generated/epsg-index.generated.js').then(
      module => module.EPSG_INDEX,
    );
  }
  return epsgIndexPromise;
}

export async function loadEpsgIndexDatasetVersion(): Promise<string> {
  if (!epsgDatasetVersionPromise) {
    epsgDatasetVersionPromise = import('./generated/epsg-index.generated.js').then(
      module => module.EPSG_INDEX_DATASET_VERSION,
    );
  }
  return epsgDatasetVersionPromise;
}

export async function loadEpsgIndexByCode(): Promise<ReadonlyMap<string, EpsgIndexEntry>> {
  if (!epsgByCodePromise) {
    epsgByCodePromise = loadEpsgIndex().then(entries =>
      new Map(entries.map(entry => [entry.code, entry])),
    );
  }
  return epsgByCodePromise;
}

export async function lookupEpsgByCode(code: string | number): Promise<EpsgIndexEntry | undefined> {
  const key = String(code).trim();
  if (!key) return undefined;
  const byCode = await loadEpsgIndexByCode();
  return byCode.get(key);
}

export async function searchEpsgIndex(
  query: string,
  options: SearchEpsgIndexOptions = {},
): Promise<EpsgIndexEntry[]> {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const limit = options.limit ?? 25;
  const includeDeprecated = options.includeDeprecated ?? false;
  const entries = await loadEpsgIndex();

  return entries
    .filter(entry => includeDeprecated || !entry.deprecated)
    .map(entry => ({ entry, score: scoreEntry(entry, normalized) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.entry.code) - Number(right.entry.code))
    .slice(0, limit)
    .map(result => result.entry);
}

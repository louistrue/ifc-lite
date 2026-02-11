/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Creates a {@link LensDataProvider} from the viewer's data sources.
 *
 * Bridges the abstract provider interface to IfcDataStore + federation:
 * - Multi-model: iterates all models, translates global IDs
 * - Legacy single-model: uses offset = 0
 */

import type { LensDataProvider, PropertySetInfo } from '@ifc-lite/lens';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { FederatedModel } from '@/store/types';

interface ModelEntry {
  id: string;
  ifcDataStore: IfcDataStore;
  idOffset: number;
  maxExpressId: number;
}

/** Scan entity array to find the actual maximum expressId */
function computeMaxExpressId(dataStore: IfcDataStore): number {
  const entities = dataStore.entities;
  if (!entities || entities.count === 0) return 0;
  let max = 0;
  for (let i = 0; i < entities.count; i++) {
    if (entities.expressId[i] > max) max = entities.expressId[i];
  }
  return max;
}

/**
 * Create a LensDataProvider for the viewer's federated models.
 *
 * @param models - Loaded federated models (may be empty in legacy mode)
 * @param legacyDataStore - Single-model data store (fallback)
 */
export function createLensDataProvider(
  models: Map<string, FederatedModel>,
  legacyDataStore: IfcDataStore | null,
): LensDataProvider {
  // Build a flat array for fast iteration
  const entries: ModelEntry[] = [];
  if (models.size > 0) {
    for (const [, model] of models) {
      if (model.ifcDataStore) {
        entries.push({
          id: model.id,
          ifcDataStore: model.ifcDataStore,
          idOffset: model.idOffset ?? 0,
          maxExpressId: model.maxExpressId ?? 0,
        });
      }
    }
  } else if (legacyDataStore) {
    entries.push({
      id: 'legacy',
      ifcDataStore: legacyDataStore,
      idOffset: 0,
      maxExpressId: computeMaxExpressId(legacyDataStore),
    });
  }

  return {
    getEntityCount(): number {
      let count = 0;
      for (const entry of entries) {
        count += entry.ifcDataStore.entities?.count ?? 0;
      }
      return count;
    },

    forEachEntity(callback: (globalId: number, modelId: string) => void): void {
      for (const entry of entries) {
        const entities = entry.ifcDataStore.entities;
        if (!entities) continue;
        for (let i = 0; i < entities.count; i++) {
          const expressId = entities.expressId[i];
          callback(expressId + entry.idOffset, entry.id);
        }
      }
    },

    getEntityType(globalId: number): string | undefined {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      return resolved.entry.ifcDataStore.entities?.getTypeName?.(resolved.expressId);
    },

    getPropertyValue(
      globalId: number,
      propertySetName: string,
      propertyName: string,
    ): unknown {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      return resolved.entry.ifcDataStore.properties?.getPropertyValue?.(
        resolved.expressId,
        propertySetName,
        propertyName,
      );
    },

    getPropertySets(globalId: number): PropertySetInfo[] {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return [];
      const psets = resolved.entry.ifcDataStore.properties?.getForEntity?.(resolved.expressId);
      if (!psets) return [];
      return psets as PropertySetInfo[];
    },
  };
}

/**
 * Resolve a global ID to (entry, local expressId).
 * O(m) where m = model count (typically 1–5).
 * Reuses a single result object to avoid per-call allocation during
 * hot-loop lens evaluation (100k+ calls).
 */
const _resolved = { entry: null as unknown as ModelEntry, expressId: 0 };

function resolveGlobalId(
  globalId: number,
  entries: ModelEntry[],
): typeof _resolved | null {
  for (const entry of entries) {
    const localId = globalId - entry.idOffset;
    if (localId >= 0 && localId <= entry.maxExpressId) {
      _resolved.entry = entry;
      _resolved.expressId = localId;
      return _resolved;
    }
  }
  return null;
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared BCF ID lookup utilities.
 *
 * Provides conversion between IFC GlobalId strings and expressIds,
 * accounting for multi-model federation offsets and single-model fallback.
 */

import type { FederatedModel, IfcDataStore } from '@/store/types';

export interface IdLookupResult {
  expressId: number;
  modelId: string;
}

/**
 * Convert IFC GlobalId string to expressId (with model offset for federation).
 * Searches federated models first, then falls back to the legacy single-model store.
 */
export function globalIdToExpressId(
  globalIdString: string,
  models: Map<string, FederatedModel>,
  ifcDataStore: IfcDataStore | null | undefined,
): IdLookupResult | null {
  // Multi-model path
  for (const [modelId, model] of models.entries()) {
    const localExpressId = model.ifcDataStore?.entities?.getExpressIdByGlobalId(globalIdString);
    if (localExpressId !== undefined && localExpressId > 0) {
      const offset = model.idOffset ?? 0;
      return { expressId: localExpressId + offset, modelId };
    }
  }
  // Single-model fallback
  if (models.size === 0 && ifcDataStore?.entities) {
    const localExpressId = ifcDataStore.entities.getExpressIdByGlobalId(globalIdString);
    if (localExpressId !== undefined && localExpressId > 0) {
      return { expressId: localExpressId, modelId: 'legacy' };
    }
  }
  return null;
}

/**
 * Convert expressId to IFC GlobalId string (reversing federation offset).
 * Searches federated models first, then falls back to the legacy single-model store.
 */
export function expressIdToGlobalId(
  expressId: number,
  models: Map<string, FederatedModel>,
  ifcDataStore: IfcDataStore | null | undefined,
): string | null {
  // Multi-model path: search federated models
  for (const model of models.values()) {
    const offset = model.idOffset ?? 0;
    const localExpressId = expressId - offset;
    if (localExpressId > 0 && localExpressId <= (model.maxExpressId ?? Infinity)) {
      const globalIdString = model.ifcDataStore?.entities?.getGlobalId(localExpressId);
      if (globalIdString) return globalIdString;
    }
  }
  // Single-model fallback: use legacy ifcDataStore directly
  if (models.size === 0 && ifcDataStore?.entities) {
    const globalIdString = ifcDataStore.entities.getGlobalId(expressId);
    if (globalIdString) return globalIdString;
  }
  return null;
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Column discovery - discovers available properties and quantities from model data.
 *
 * PERF: Samples a subset of entities per type to avoid scanning 100K+ entities.
 * Uses PropertyTable/QuantityTable indices when available for O(1) lookups,
 * falls back to on-demand extraction for WASM-parsed models.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import type { IfcTypeEnum, PropertySet, QuantitySet } from '@ifc-lite/data';
import type { DiscoveredColumns } from './types.js';
import { ENTITY_ATTRIBUTES } from './types.js';

/** Max entities to sample per type per store for column discovery */
const SAMPLE_SIZE = 50;

/**
 * Discover available columns for a set of entity types across one or more stores.
 * Samples entities to find all property sets and quantity sets available.
 */
export function discoverColumns(
  stores: IfcDataStore | IfcDataStore[],
  entityTypes: IfcTypeEnum[],
): DiscoveredColumns {
  const storeList = Array.isArray(stores) ? stores : [stores];
  const properties = new Map<string, Set<string>>();
  const quantities = new Map<string, Set<string>>();

  for (const store of storeList) {
    for (const type of entityTypes) {
      const ids = store.entities.getByType(type);
      // Sample up to SAMPLE_SIZE entities per type per store
      const sampleCount = Math.min(ids.length, SAMPLE_SIZE);

      for (let i = 0; i < sampleCount; i++) {
        const entityId = ids[i];

        // Discover properties
        const psets = getPropertySetsForDiscovery(store, entityId);
        for (const pset of psets) {
          if (!pset.name) continue;
          let propNames = properties.get(pset.name);
          if (!propNames) {
            propNames = new Set();
            properties.set(pset.name, propNames);
          }
          for (const prop of pset.properties) {
            if (prop.name) propNames.add(prop.name);
          }
        }

        // Discover quantities
        const qsets = getQuantitySetsForDiscovery(store, entityId);
        for (const qset of qsets) {
          if (!qset.name) continue;
          let quantNames = quantities.get(qset.name);
          if (!quantNames) {
            quantNames = new Set();
            quantities.set(qset.name, quantNames);
          }
          for (const quant of qset.quantities) {
            if (quant.name) quantNames.add(quant.name);
          }
        }
      }
    }
  }

  // Convert Sets to sorted arrays for stable UI
  const propertiesResult = new Map<string, string[]>();
  for (const [psetName, propSet] of properties) {
    propertiesResult.set(psetName, Array.from(propSet).sort());
  }

  const quantitiesResult = new Map<string, string[]>();
  for (const [qsetName, quantSet] of quantities) {
    quantitiesResult.set(qsetName, Array.from(quantSet).sort());
  }

  return {
    attributes: [...ENTITY_ATTRIBUTES],
    properties: propertiesResult,
    quantities: quantitiesResult,
  };
}

function getPropertySetsForDiscovery(store: IfcDataStore, entityId: number): PropertySet[] {
  if (store.onDemandPropertyMap && store.source?.length > 0) {
    return extractPropertiesOnDemand(store, entityId) as PropertySet[];
  }
  return store.properties?.getForEntity(entityId) ?? [];
}

function getQuantitySetsForDiscovery(store: IfcDataStore, entityId: number): QuantitySet[] {
  if (store.onDemandQuantityMap && store.source?.length > 0) {
    return extractQuantitiesOnDemand(store, entityId) as QuantitySet[];
  }
  return store.quantities?.getForEntity(entityId) ?? [];
}

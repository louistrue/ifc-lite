/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Adapter that bridges IfcDataStore (parser output) to the
 * ListDataProvider interface used by @ifc-lite/lists.
 *
 * Handles on-demand property/quantity extraction via WASM when needed.
 * Also handles on-demand attribute extraction for Description, ObjectType,
 * and Tag which are not stored during the fast initial parse.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand, extractEntityAttributesOnDemand } from '@ifc-lite/parser';
import type { PropertySet, QuantitySet } from '@ifc-lite/data';
import type { ListDataProvider } from '@ifc-lite/lists';

/**
 * Create a ListDataProvider backed by an IfcDataStore.
 * The provider handles on-demand WASM extraction transparently.
 */
export function createListDataProvider(store: IfcDataStore): ListDataProvider {
  // Cache for on-demand attribute extraction (description, objectType, tag)
  // These are not stored during initial parse to keep load times fast,
  // but are needed for list display. Cache avoids re-parsing per column.
  const attrCache = new Map<number, { description: string; objectType: string; tag: string }>();

  function getOnDemandAttrs(id: number): { description: string; objectType: string; tag: string } {
    const cached = attrCache.get(id);
    if (cached) return cached;

    if (store.source?.length > 0 && store.entityIndex) {
      const attrs = extractEntityAttributesOnDemand(store, id);
      const result = { description: attrs.description, objectType: attrs.objectType, tag: attrs.tag };
      attrCache.set(id, result);
      return result;
    }

    const empty = { description: '', objectType: '', tag: '' };
    attrCache.set(id, empty);
    return empty;
  }

  return {
    getEntitiesByType: (type) => store.entities.getByType(type),

    getEntityName: (id) => store.entities.getName(id),
    getEntityGlobalId: (id) => store.entities.getGlobalId(id),
    getEntityDescription: (id) => store.entities.getDescription(id) || getOnDemandAttrs(id).description,
    getEntityObjectType: (id) => store.entities.getObjectType(id) || getOnDemandAttrs(id).objectType,
    getEntityTag: (id) => getOnDemandAttrs(id).tag,
    getEntityTypeName: (id) => store.entities.getTypeName(id),

    getPropertySets(entityId: number): PropertySet[] {
      if (store.onDemandPropertyMap && store.source?.length > 0) {
        return extractPropertiesOnDemand(store, entityId) as PropertySet[];
      }
      return store.properties?.getForEntity(entityId) ?? [];
    },

    getQuantitySets(entityId: number): QuantitySet[] {
      if (store.onDemandQuantityMap && store.source?.length > 0) {
        return extractQuantitiesOnDemand(store, entityId) as QuantitySet[];
      }
      return store.quantities?.getForEntity(entityId) ?? [];
    },
  };
}

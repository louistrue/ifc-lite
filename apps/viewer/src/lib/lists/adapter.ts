/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Adapter that bridges IfcDataStore (parser output) to the
 * ListDataProvider interface used by @ifc-lite/lists.
 *
 * Handles on-demand property/quantity extraction via WASM when needed.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import type { PropertySet, QuantitySet } from '@ifc-lite/data';
import type { ListDataProvider } from '@ifc-lite/lists';

/**
 * Create a ListDataProvider backed by an IfcDataStore.
 * The provider handles on-demand WASM extraction transparently.
 */
export function createListDataProvider(store: IfcDataStore): ListDataProvider {
  return {
    getEntitiesByType: (type) => store.entities.getByType(type),

    getEntityName: (id) => store.entities.getName(id),
    getEntityGlobalId: (id) => store.entities.getGlobalId(id),
    getEntityDescription: (id) => store.entities.getDescription(id),
    getEntityObjectType: (id) => store.entities.getObjectType(id),
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { MutablePropertyView } from '@ifc-lite/mutations';
import {
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  extractTypeEntityOwnProperties,
  type IfcDataStore,
} from '@ifc-lite/parser';

/**
 * Configure a mutation view so its base reads match the viewer's property panel.
 * Type entities need a dedicated extraction path because their own HasPropertySets
 * are not exposed through the regular occurrence property extractor.
 */
export function configureMutationView(
  mutationView: MutablePropertyView,
  dataStore: IfcDataStore
): void {
  if (dataStore.source?.length > 0) {
    mutationView.setOnDemandExtractor((entityId: number) => {
      const typeName = dataStore.entities?.getTypeName(entityId) ?? '';
      if (typeName.endsWith('Type')) {
        return extractTypeEntityOwnProperties(dataStore, entityId);
      }
      return extractPropertiesOnDemand(dataStore, entityId);
    });
  }

  if (dataStore.onDemandQuantityMap && dataStore.source?.length > 0) {
    mutationView.setQuantityExtractor((entityId: number) => {
      return extractQuantitiesOnDemand(dataStore, entityId);
    });
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { LensCriteria, LensDataProvider } from './types.js';
import { IFC_SUBTYPE_TO_BASE } from './types.js';

/**
 * Check if an entity matches a {@link LensCriteria}.
 *
 * Performance: O(1) for type matching, O(psets) for property/material.
 */
export function matchesCriteria(
  criteria: LensCriteria,
  globalId: number,
  provider: LensDataProvider,
): boolean {
  switch (criteria.type) {
    case 'ifcType':
      return matchesIfcType(criteria, globalId, provider);
    case 'property':
      return matchesProperty(criteria, globalId, provider);
    case 'material':
      return matchesMaterial(criteria, globalId, provider);
    default:
      return false;
  }
}

/** Match by IFC class with subclass support */
function matchesIfcType(
  criteria: LensCriteria,
  globalId: number,
  provider: LensDataProvider,
): boolean {
  if (!criteria.ifcType) return false;

  const typeName = provider.getEntityType(globalId);
  if (!typeName) return false;

  // Exact match
  if (typeName === criteria.ifcType) return true;

  // Subtype match: e.g. IfcSlabStandardCase matches an IfcSlab rule
  const baseType = IFC_SUBTYPE_TO_BASE[typeName];
  return baseType === criteria.ifcType;
}

/** Match by property value */
function matchesProperty(
  criteria: LensCriteria,
  globalId: number,
  provider: LensDataProvider,
): boolean {
  if (!criteria.propertySet || !criteria.propertyName) return false;

  const value = provider.getPropertyValue(
    globalId,
    criteria.propertySet,
    criteria.propertyName,
  );

  if (criteria.operator === 'exists') {
    return value !== null && value !== undefined;
  }

  if (criteria.operator === 'contains' && criteria.propertyValue !== undefined) {
    return String(value ?? '').toLowerCase().includes(criteria.propertyValue.toLowerCase());
  }

  // Default: equals
  if (criteria.propertyValue !== undefined) {
    return String(value ?? '') === criteria.propertyValue;
  }

  return value !== null && value !== undefined;
}

/** Match by material (scans material-related property sets) */
function matchesMaterial(
  criteria: LensCriteria,
  globalId: number,
  provider: LensDataProvider,
): boolean {
  if (!criteria.materialName) return false;

  const psets = provider.getPropertySets(globalId);
  if (!psets || psets.length === 0) return false;

  const pattern = criteria.materialName.toLowerCase();

  for (const pset of psets) {
    if (pset.name.toLowerCase().includes('material')) {
      for (const prop of pset.properties) {
        if (String(prop.value ?? '').toLowerCase().includes(pattern)) {
          return true;
        }
      }
    }
  }

  return false;
}

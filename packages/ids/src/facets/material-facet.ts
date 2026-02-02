/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Material facet checker
 */

import type { IDSMaterialFacet, IFCDataAccessor } from '../types.js';
import type { FacetCheckResult } from './index.js';
import { matchConstraint, formatConstraint } from '../constraints/index.js';

/**
 * Check if an entity matches a material facet
 */
export function checkMaterialFacet(
  facet: IDSMaterialFacet,
  expressId: number,
  accessor: IFCDataAccessor
): FacetCheckResult {
  // Get materials for the entity
  const materials = accessor.getMaterials(expressId);

  // If no value constraint, just check if any material exists
  if (!facet.value) {
    if (materials.length === 0) {
      return {
        passed: false,
        actualValue: '(none)',
        expectedValue: 'any material',
        failure: {
          type: 'MATERIAL_MISSING',
          expected: 'any material',
        },
      };
    }

    return {
      passed: true,
      actualValue: materials.map((m) => m.name).join(', '),
      expectedValue: 'any material',
    };
  }

  // Check if any material matches the value constraint
  const matchingMaterials = materials.filter(
    (m) =>
      matchConstraint(facet.value!, m.name) ||
      (m.category && matchConstraint(facet.value!, m.category))
  );

  if (matchingMaterials.length === 0) {
    if (materials.length === 0) {
      return {
        passed: false,
        actualValue: '(none)',
        expectedValue: formatConstraint(facet.value),
        failure: {
          type: 'MATERIAL_MISSING',
          expected: formatConstraint(facet.value),
        },
      };
    }

    const availableMaterials = materials.map((m) => m.name).join(', ');

    return {
      passed: false,
      actualValue: availableMaterials,
      expectedValue: formatConstraint(facet.value),
      failure: {
        type: 'MATERIAL_VALUE_MISMATCH',
        field: 'material',
        actual: availableMaterials,
        expected: formatConstraint(facet.value),
        context: {
          availableMaterials,
        },
      },
    };
  }

  return {
    passed: true,
    actualValue: matchingMaterials.map((m) => m.name).join(', '),
    expectedValue: formatConstraint(facet.value),
  };
}

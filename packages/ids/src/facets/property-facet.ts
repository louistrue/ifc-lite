/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property facet checker
 */

import type {
  IDSPropertyFacet,
  IFCDataAccessor,
  PropertySetInfo,
} from '../types.js';
import type { FacetCheckResult } from './index.js';
import { matchConstraint, formatConstraint, type MatchOptions } from '../constraints/index.js';

/** IFC data type names (IFCLABEL, IFCREAL, etc.) are case-insensitive */
const DATATYPE_OPTS: MatchOptions = { caseInsensitive: true };

/**
 * Check if an entity matches a property facet
 */
export function checkPropertyFacet(
  facet: IDSPropertyFacet,
  expressId: number,
  accessor: IFCDataAccessor
): FacetCheckResult {
  // Get all property sets for the entity
  const propertySets = accessor.getPropertySets(expressId);

  if (propertySets.length === 0) {
    return {
      passed: false,
      expectedValue: `property "${formatConstraint(facet.baseName)}" in "${formatConstraint(facet.propertySet)}"`,
      failure: {
        type: 'PSET_MISSING',
        field: formatConstraint(facet.propertySet),
        expected: formatConstraint(facet.propertySet),
      },
    };
  }

  // Find matching property sets
  const matchingPsets = propertySets.filter((pset) =>
    matchConstraint(facet.propertySet, pset.name)
  );

  if (matchingPsets.length === 0) {
    const availablePsets = propertySets.map((p) => p.name).join(', ');
    return {
      passed: false,
      actualValue: availablePsets || '(none)',
      expectedValue: formatConstraint(facet.propertySet),
      failure: {
        type: 'PSET_MISSING',
        field: 'propertySet',
        actual: availablePsets,
        expected: formatConstraint(facet.propertySet),
        context: { availablePsets },
      },
    };
  }

  // Check each matching property set for the property
  // Track the most specific failure so we can return it instead of a generic PROPERTY_MISSING
  let lastFailure: FacetCheckResult | undefined;

  for (const pset of matchingPsets) {
    const result = checkPropertyInPset(facet, pset);
    if (result.passed) {
      return result;
    }
    // Keep the most specific failure (value/datatype mismatch over property-missing)
    if (
      !lastFailure ||
      (result.failure?.type !== 'PROPERTY_MISSING' && lastFailure.failure?.type === 'PROPERTY_MISSING')
    ) {
      lastFailure = result;
    }
  }

  // Return the most specific failure if we have one (e.g., value or datatype mismatch)
  if (lastFailure && lastFailure.failure?.type !== 'PROPERTY_MISSING') {
    return lastFailure;
  }

  // Property not found in any matching pset
  const psetNames = matchingPsets.map((p) => p.name).join(', ');
  const availableProps = matchingPsets
    .flatMap((pset) => pset.properties.map((p) => `${pset.name}.${p.name}`))
    .join(', ');

  return {
    passed: false,
    actualValue: availableProps || '(none)',
    expectedValue: `${formatConstraint(facet.propertySet)}.${formatConstraint(facet.baseName)}`,
    failure: {
      type: 'PROPERTY_MISSING',
      field: formatConstraint(facet.baseName),
      expected: formatConstraint(facet.baseName),
      context: {
        propertySet: psetNames,
        availableProperties: availableProps,
      },
    },
  };
}

/**
 * Check a property within a specific property set.
 * Tries ALL matching properties and returns on first pass.
 * If none pass, returns the most specific failure.
 */
function checkPropertyInPset(
  facet: IDSPropertyFacet,
  pset: PropertySetInfo
): FacetCheckResult {
  // Find matching properties
  const matchingProps = pset.properties.filter((prop) =>
    matchConstraint(facet.baseName, prop.name)
  );

  if (matchingProps.length === 0) {
    return {
      passed: false,
      failure: {
        type: 'PROPERTY_MISSING',
        field: formatConstraint(facet.baseName),
        expected: formatConstraint(facet.baseName),
        context: {
          propertySet: pset.name,
          availableProperties: pset.properties.map((p) => p.name).join(', '),
        },
      },
    };
  }

  // Check each matching property — try all, return first pass, track best failure
  let bestFailure: FacetCheckResult | undefined;

  for (const prop of matchingProps) {
    const result = checkSingleProperty(facet, pset, prop);
    if (result.passed) {
      return result;
    }

    // Prefer value/bounds/datatype failures over generic missing
    if (
      !bestFailure ||
      (result.failure?.type !== 'PROPERTY_MISSING' && bestFailure.failure?.type === 'PROPERTY_MISSING')
    ) {
      bestFailure = result;
    }
  }

  return bestFailure!;
}

/**
 * Check a single property against the facet's dataType and value constraints.
 */
function checkSingleProperty(
  facet: IDSPropertyFacet,
  pset: PropertySetInfo,
  prop: PropertySetInfo['properties'][number]
): FacetCheckResult {
  // Check data type if specified (IFC type names are case-insensitive)
  if (facet.dataType) {
    if (!matchConstraint(facet.dataType, prop.dataType, DATATYPE_OPTS)) {
      return {
        passed: false,
        actualValue: `${pset.name}.${prop.name} (${prop.dataType})`,
        expectedValue: `dataType ${formatConstraint(facet.dataType)}`,
        failure: {
          type: 'PROPERTY_DATATYPE_MISMATCH',
          field: `${pset.name}.${prop.name}`,
          actual: prop.dataType,
          expected: formatConstraint(facet.dataType),
        },
      };
    }
  }

  // Check value if specified
  if (facet.value) {
    const propValue = prop.value;

    if (propValue === null || propValue === undefined) {
      return {
        passed: false,
        actualValue: '(empty)',
        expectedValue: formatConstraint(facet.value),
        failure: {
          type: 'PROPERTY_VALUE_MISMATCH',
          field: `${pset.name}.${prop.name}`,
          actual: '(empty)',
          expected: formatConstraint(facet.value),
        },
      };
    }

    if (!matchConstraint(facet.value, propValue)) {
      const failureType =
        facet.value.type === 'bounds'
          ? 'PROPERTY_OUT_OF_BOUNDS'
          : 'PROPERTY_VALUE_MISMATCH';

      return {
        passed: false,
        actualValue: String(propValue),
        expectedValue: formatConstraint(facet.value),
        failure: {
          type: failureType,
          field: `${pset.name}.${prop.name}`,
          actual: String(propValue),
          expected: formatConstraint(facet.value),
        },
      };
    }
  }

  // Property passed all checks
  return {
    passed: true,
    actualValue: `${pset.name}.${prop.name} = ${prop.value}`,
    expectedValue: facet.value
      ? formatConstraint(facet.value)
      : 'property exists',
  };
}

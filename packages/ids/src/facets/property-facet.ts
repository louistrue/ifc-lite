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
import { matchConstraint, formatConstraint } from '../constraints/index.js';

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
  for (const pset of matchingPsets) {
    const result = checkPropertyInPset(facet, pset);
    if (result.passed) {
      return result;
    }
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
 * Check a property within a specific property set
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

  // Check each matching property
  for (const prop of matchingProps) {
    // Check data type if specified
    if (facet.dataType) {
      if (!matchConstraint(facet.dataType, prop.dataType)) {
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
        // Check if it's a bounds violation
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

  // Should not reach here
  return {
    passed: false,
    failure: {
      type: 'PROPERTY_MISSING',
      field: formatConstraint(facet.baseName),
    },
  };
}

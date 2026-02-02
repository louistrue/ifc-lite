/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Attribute facet checker
 */

import type { IDSAttributeFacet, IFCDataAccessor } from '../types.js';
import type { FacetCheckResult } from './index.js';
import { matchConstraint, formatConstraint } from '../constraints/index.js';

/** Standard IFC attributes that can be checked */
const STANDARD_ATTRIBUTES = [
  'Name',
  'Description',
  'ObjectType',
  'Tag',
  'GlobalId',
  'LongName',
] as const;

/**
 * Check if an entity matches an attribute facet
 */
export function checkAttributeFacet(
  facet: IDSAttributeFacet,
  expressId: number,
  accessor: IFCDataAccessor
): FacetCheckResult {
  // Get the attribute name to check
  const attrNameConstraint = facet.name;
  let attrName: string;

  // For simple value, use the name directly
  if (attrNameConstraint.type === 'simpleValue') {
    attrName = attrNameConstraint.value;
  } else {
    // For patterns/enumerations, we need to check all matching attributes
    // Simplified: just check the first standard attribute that matches
    const matchingAttrs = STANDARD_ATTRIBUTES.filter((a) =>
      matchConstraint(attrNameConstraint, a)
    );
    if (matchingAttrs.length === 0) {
      return {
        passed: false,
        failure: {
          type: 'ATTRIBUTE_MISSING',
          field: formatConstraint(attrNameConstraint),
          expected: formatConstraint(attrNameConstraint),
        },
      };
    }
    attrName = matchingAttrs[0];
  }

  // Get the attribute value
  const attrValue = getAttributeValue(attrName, expressId, accessor);

  // Check if attribute exists
  if (attrValue === undefined || attrValue === null || attrValue === '') {
    return {
      passed: false,
      actualValue: undefined,
      expectedValue: facet.value
        ? formatConstraint(facet.value)
        : `attribute "${attrName}" to exist`,
      failure: {
        type: 'ATTRIBUTE_MISSING',
        field: attrName,
        expected: facet.value ? formatConstraint(facet.value) : 'any value',
      },
    };
  }

  // If no value constraint, just check existence
  if (!facet.value) {
    return {
      passed: true,
      actualValue: String(attrValue),
      expectedValue: `attribute "${attrName}" to exist`,
    };
  }

  // Check value constraint
  if (!matchConstraint(facet.value, attrValue)) {
    return {
      passed: false,
      actualValue: String(attrValue),
      expectedValue: formatConstraint(facet.value),
      failure: {
        type:
          facet.value.type === 'pattern'
            ? 'ATTRIBUTE_PATTERN_MISMATCH'
            : 'ATTRIBUTE_VALUE_MISMATCH',
        field: attrName,
        actual: String(attrValue),
        expected: formatConstraint(facet.value),
      },
    };
  }

  return {
    passed: true,
    actualValue: String(attrValue),
    expectedValue: formatConstraint(facet.value),
  };
}

/**
 * Get an attribute value from an entity
 */
function getAttributeValue(
  attrName: string,
  expressId: number,
  accessor: IFCDataAccessor
): string | undefined {
  const normalizedName = attrName.toLowerCase();

  switch (normalizedName) {
    case 'name':
      return accessor.getEntityName(expressId);
    case 'description':
      return accessor.getDescription(expressId);
    case 'objecttype':
      return accessor.getObjectType(expressId);
    case 'globalid':
      return accessor.getGlobalId(expressId);
    default:
      // Try generic attribute access
      return accessor.getAttribute(expressId, attrName);
  }
}

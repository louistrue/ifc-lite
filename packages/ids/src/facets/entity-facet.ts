/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity facet checker
 */

import type {
  IDSEntityFacet,
  IDSConstraint,
  IFCDataAccessor,
} from '../types.js';
import type { FacetCheckResult } from './index.js';
import { matchConstraint, formatConstraint } from '../constraints/index.js';

/**
 * Check if an entity matches an entity facet
 */
export function checkEntityFacet(
  facet: IDSEntityFacet,
  expressId: number,
  accessor: IFCDataAccessor
): FacetCheckResult {
  const entityType = accessor.getEntityType(expressId);

  if (!entityType) {
    return {
      passed: false,
      actualValue: undefined,
      expectedValue: formatConstraint(facet.name),
      failure: {
        type: 'ENTITY_TYPE_MISMATCH',
        field: 'entityType',
        actual: 'unknown',
        expected: formatConstraint(facet.name),
      },
    };
  }

  // Check entity type
  if (!matchConstraint(facet.name, entityType)) {
    return {
      passed: false,
      actualValue: entityType,
      expectedValue: formatConstraint(facet.name),
      failure: {
        type: 'ENTITY_TYPE_MISMATCH',
        field: 'entityType',
        actual: entityType,
        expected: formatConstraint(facet.name),
      },
    };
  }

  // Check predefined type if specified
  if (facet.predefinedType) {
    const objectType = accessor.getObjectType(expressId);

    if (!objectType) {
      return {
        passed: false,
        actualValue: entityType,
        expectedValue: `${formatConstraint(facet.name)} with predefinedType ${formatConstraint(facet.predefinedType)}`,
        failure: {
          type: 'PREDEFINED_TYPE_MISSING',
          field: 'predefinedType',
          expected: formatConstraint(facet.predefinedType),
        },
      };
    }

    if (!matchConstraint(facet.predefinedType, objectType)) {
      return {
        passed: false,
        actualValue: `${entityType}[${objectType}]`,
        expectedValue: `${formatConstraint(facet.name)} with predefinedType ${formatConstraint(facet.predefinedType)}`,
        failure: {
          type: 'PREDEFINED_TYPE_MISMATCH',
          field: 'predefinedType',
          actual: objectType,
          expected: formatConstraint(facet.predefinedType),
        },
      };
    }
  }

  return {
    passed: true,
    actualValue: facet.predefinedType
      ? `${entityType}[${accessor.getObjectType(expressId) || ''}]`
      : entityType,
    expectedValue: formatConstraint(facet.name),
  };
}

/**
 * Get candidate entity IDs that might match an entity facet (broadphase filter)
 */
export function filterByEntityFacet(
  facet: IDSEntityFacet,
  accessor: IFCDataAccessor
): number[] | undefined {
  const constraint = facet.name;

  // For simple values, we can efficiently filter by type
  if (constraint.type === 'simpleValue') {
    return accessor.getEntitiesByType(constraint.value);
  }

  // For enumerations, collect entities of all specified types
  if (constraint.type === 'enumeration') {
    const ids: number[] = [];
    for (const value of constraint.values) {
      ids.push(...accessor.getEntitiesByType(value));
    }
    return ids;
  }

  // For patterns, we need to check all entity types
  // Return undefined to indicate full scan needed
  return undefined;
}

/**
 * Get all entity types that could match a constraint
 */
export function getMatchingEntityTypes(
  constraint: IDSConstraint,
  allTypes: string[]
): string[] {
  switch (constraint.type) {
    case 'simpleValue':
      return allTypes.filter(
        (t) => t.toUpperCase() === constraint.value.toUpperCase()
      );
    case 'enumeration':
      return allTypes.filter((t) =>
        constraint.values.some(
          (v) => v.toUpperCase() === t.toUpperCase()
        )
      );
    case 'pattern':
      try {
        const regex = new RegExp(`^${constraint.pattern}$`, 'i');
        return allTypes.filter((t) => regex.test(t));
      } catch {
        return [];
      }
    default:
      return allTypes;
  }
}

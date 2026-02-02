/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * PartOf facet checker
 */

import type {
  IDSPartOfFacet,
  IFCDataAccessor,
  PartOfRelation,
} from '../types.js';
import type { FacetCheckResult } from './index.js';
import { matchConstraint, formatConstraint } from '../constraints/index.js';

/** Human-readable relation names */
const RELATION_NAMES: Record<PartOfRelation, string> = {
  IfcRelAggregates: 'aggregated in',
  IfcRelContainedInSpatialStructure: 'contained in',
  IfcRelNests: 'nested in',
  IfcRelVoidsElement: 'voiding',
  IfcRelFillsElement: 'filling',
};

/**
 * Check if an entity matches a partOf facet
 */
export function checkPartOfFacet(
  facet: IDSPartOfFacet,
  expressId: number,
  accessor: IFCDataAccessor
): FacetCheckResult {
  // Get parent via the specified relationship
  const parent = accessor.getParent(expressId, facet.relation);

  if (!parent) {
    const relationName = RELATION_NAMES[facet.relation] || facet.relation;
    const expectedEntity = facet.entity
      ? formatConstraint(facet.entity.name)
      : 'any entity';

    return {
      passed: false,
      actualValue: '(no parent)',
      expectedValue: `${relationName} ${expectedEntity}`,
      failure: {
        type: 'PARTOF_RELATION_MISSING',
        field: facet.relation,
        expected: `${relationName} ${expectedEntity}`,
        context: {
          relation: facet.relation,
        },
      },
    };
  }

  // If no entity constraint, just check if relationship exists
  if (!facet.entity) {
    const relationName = RELATION_NAMES[facet.relation] || facet.relation;

    return {
      passed: true,
      actualValue: `${relationName} ${parent.entityType}`,
      expectedValue: `${relationName} any entity`,
    };
  }

  // Check parent entity type
  if (!matchConstraint(facet.entity.name, parent.entityType)) {
    const relationName = RELATION_NAMES[facet.relation] || facet.relation;

    return {
      passed: false,
      actualValue: `${relationName} ${parent.entityType}`,
      expectedValue: `${relationName} ${formatConstraint(facet.entity.name)}`,
      failure: {
        type: 'PARTOF_ENTITY_MISMATCH',
        field: 'entity',
        actual: parent.entityType,
        expected: formatConstraint(facet.entity.name),
        context: {
          relation: facet.relation,
          parentId: String(parent.expressId),
        },
      },
    };
  }

  // Check parent predefined type if specified
  if (facet.entity.predefinedType) {
    if (!parent.predefinedType) {
      return {
        passed: false,
        actualValue: `${parent.entityType} (no predefinedType)`,
        expectedValue: `${formatConstraint(facet.entity.name)} with predefinedType ${formatConstraint(facet.entity.predefinedType)}`,
        failure: {
          type: 'PARTOF_ENTITY_MISMATCH',
          field: 'predefinedType',
          expected: formatConstraint(facet.entity.predefinedType),
          context: {
            relation: facet.relation,
            parentType: parent.entityType,
          },
        },
      };
    }

    if (!matchConstraint(facet.entity.predefinedType, parent.predefinedType)) {
      return {
        passed: false,
        actualValue: `${parent.entityType}[${parent.predefinedType}]`,
        expectedValue: `${formatConstraint(facet.entity.name)}[${formatConstraint(facet.entity.predefinedType)}]`,
        failure: {
          type: 'PARTOF_ENTITY_MISMATCH',
          field: 'predefinedType',
          actual: parent.predefinedType,
          expected: formatConstraint(facet.entity.predefinedType),
          context: {
            relation: facet.relation,
            parentType: parent.entityType,
          },
        },
      };
    }
  }

  const relationName = RELATION_NAMES[facet.relation] || facet.relation;
  const parentDesc = parent.predefinedType
    ? `${parent.entityType}[${parent.predefinedType}]`
    : parent.entityType;

  return {
    passed: true,
    actualValue: `${relationName} ${parentDesc}`,
    expectedValue: `${relationName} ${formatConstraint(facet.entity.name)}`,
  };
}

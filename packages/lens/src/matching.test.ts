/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { matchesCriteria } from './matching.js';
import type { LensCriteria, LensDataProvider, PropertySetInfo } from './types.js';

/** Create a mock provider from a simple entity list */
function createMockProvider(entities: Array<{
  id: number;
  type: string;
  properties?: Record<string, Record<string, unknown>>;
  propertySets?: PropertySetInfo[];
}>): LensDataProvider {
  const entityMap = new Map(entities.map(e => [e.id, e]));

  return {
    getEntityCount: () => entities.length,
    forEachEntity: (cb) => {
      for (const e of entities) cb(e.id, 'model-1');
    },
    getEntityType: (id) => entityMap.get(id)?.type,
    getPropertyValue: (id, pset, prop) => {
      const e = entityMap.get(id);
      return e?.properties?.[pset]?.[prop];
    },
    getPropertySets: (id) => entityMap.get(id)?.propertySets ?? [],
  };
}

describe('matchesCriteria — ifcType', () => {
  const provider = createMockProvider([
    { id: 1, type: 'IfcWall' },
    { id: 2, type: 'IfcWallStandardCase' },
    { id: 3, type: 'IfcSlab' },
  ]);

  it('should match exact type', () => {
    const c: LensCriteria = { type: 'ifcType', ifcType: 'IfcWall' };
    expect(matchesCriteria(c, 1, provider)).toBe(true);
  });

  it('should match subtype to base type', () => {
    const c: LensCriteria = { type: 'ifcType', ifcType: 'IfcWall' };
    expect(matchesCriteria(c, 2, provider)).toBe(true);
  });

  it('should not match different types', () => {
    const c: LensCriteria = { type: 'ifcType', ifcType: 'IfcWall' };
    expect(matchesCriteria(c, 3, provider)).toBe(false);
  });

  it('should not match unknown entity', () => {
    const c: LensCriteria = { type: 'ifcType', ifcType: 'IfcWall' };
    expect(matchesCriteria(c, 999, provider)).toBe(false);
  });

  it('should return false when ifcType is missing in criteria', () => {
    const c: LensCriteria = { type: 'ifcType' };
    expect(matchesCriteria(c, 1, provider)).toBe(false);
  });
});

describe('matchesCriteria — property', () => {
  const provider = createMockProvider([
    {
      id: 1,
      type: 'IfcWall',
      properties: {
        'Pset_WallCommon': { IsExternal: 'true', FireRating: 'REI60' },
      },
    },
    {
      id: 2,
      type: 'IfcSlab',
      properties: {},
    },
  ]);

  it('should match equals operator', () => {
    const c: LensCriteria = {
      type: 'property',
      propertySet: 'Pset_WallCommon',
      propertyName: 'IsExternal',
      operator: 'equals',
      propertyValue: 'true',
    };
    expect(matchesCriteria(c, 1, provider)).toBe(true);
  });

  it('should not match wrong value with equals', () => {
    const c: LensCriteria = {
      type: 'property',
      propertySet: 'Pset_WallCommon',
      propertyName: 'IsExternal',
      operator: 'equals',
      propertyValue: 'false',
    };
    expect(matchesCriteria(c, 1, provider)).toBe(false);
  });

  it('should match contains operator (case-insensitive)', () => {
    const c: LensCriteria = {
      type: 'property',
      propertySet: 'Pset_WallCommon',
      propertyName: 'FireRating',
      operator: 'contains',
      propertyValue: 'rei',
    };
    expect(matchesCriteria(c, 1, provider)).toBe(true);
  });

  it('should match exists operator', () => {
    const c: LensCriteria = {
      type: 'property',
      propertySet: 'Pset_WallCommon',
      propertyName: 'IsExternal',
      operator: 'exists',
    };
    expect(matchesCriteria(c, 1, provider)).toBe(true);
  });

  it('should fail exists when property is missing', () => {
    const c: LensCriteria = {
      type: 'property',
      propertySet: 'Pset_WallCommon',
      propertyName: 'LoadBearing',
      operator: 'exists',
    };
    expect(matchesCriteria(c, 1, provider)).toBe(false);
  });

  it('should return false when propertySet/Name missing in criteria', () => {
    expect(matchesCriteria({ type: 'property' }, 1, provider)).toBe(false);
    expect(matchesCriteria({ type: 'property', propertySet: 'x' }, 1, provider)).toBe(false);
  });
});

describe('matchesCriteria — material', () => {
  const provider = createMockProvider([
    {
      id: 1,
      type: 'IfcWall',
      propertySets: [
        {
          name: 'Pset_MaterialCommon',
          properties: [
            { name: 'Material', value: 'Concrete C30/37' },
          ],
        },
        {
          name: 'Pset_WallCommon',
          properties: [
            { name: 'IsExternal', value: true },
          ],
        },
      ],
    },
    {
      id: 2,
      type: 'IfcColumn',
      propertySets: [
        {
          name: 'Pset_ColumnCommon',
          properties: [
            { name: 'Reference', value: 'S235' },
          ],
        },
      ],
    },
  ]);

  it('should match material in material-related psets', () => {
    const c: LensCriteria = { type: 'material', materialName: 'concrete' };
    expect(matchesCriteria(c, 1, provider)).toBe(true);
  });

  it('should not match in non-material psets', () => {
    const c: LensCriteria = { type: 'material', materialName: 'External' };
    // "External" exists in Pset_WallCommon, but that pset name doesn't contain "material"
    expect(matchesCriteria(c, 1, provider)).toBe(false);
  });

  it('should not match when no material psets exist', () => {
    const c: LensCriteria = { type: 'material', materialName: 'steel' };
    expect(matchesCriteria(c, 2, provider)).toBe(false);
  });

  it('should return false when materialName is missing', () => {
    expect(matchesCriteria({ type: 'material' }, 1, provider)).toBe(false);
  });
});

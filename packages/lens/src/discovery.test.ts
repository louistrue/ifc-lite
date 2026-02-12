/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { discoverLensData } from './discovery';
import type { LensDataProvider } from './types';

function createMockProvider(overrides: Partial<LensDataProvider> = {}): LensDataProvider {
  return {
    getEntityCount: () => 3,
    forEachEntity: (cb) => {
      cb(1, 'model-1');
      cb(2, 'model-1');
      cb(3, 'model-1');
    },
    getEntityType: (id) => {
      if (id === 1) return 'IfcWall';
      if (id === 2) return 'IfcSlab';
      if (id === 3) return 'IfcWall';
      return undefined;
    },
    getPropertyValue: () => undefined,
    getPropertySets: (id) => {
      if (id === 1) return [
        { name: 'Pset_WallCommon', properties: [{ name: 'IsExternal', value: true }, { name: 'FireRating', value: '30' }] },
      ];
      if (id === 2) return [
        { name: 'Pset_SlabCommon', properties: [{ name: 'IsExternal', value: false }] },
      ];
      return [];
    },
    ...overrides,
  };
}

describe('discoverLensData', () => {
  it('discovers IFC types from all entities', () => {
    const provider = createMockProvider();
    const result = discoverLensData(provider);
    expect(result.types).toEqual(['IfcSlab', 'IfcWall']);
  });

  it('discovers property sets and property names', () => {
    const provider = createMockProvider();
    const result = discoverLensData(provider);
    expect(result.propertySets.get('Pset_WallCommon')).toEqual(['FireRating', 'IsExternal']);
    expect(result.propertySets.get('Pset_SlabCommon')).toEqual(['IsExternal']);
  });

  it('discovers quantity sets when getQuantitySets is provided', () => {
    const provider = createMockProvider({
      getQuantitySets: (id) => {
        if (id === 1) return [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'Length' }, { name: 'Height' }] }];
        return [];
      },
    });
    const result = discoverLensData(provider);
    expect(result.quantitySets.get('Qto_WallBaseQuantities')).toEqual(['Height', 'Length']);
  });

  it('discovers classification systems', () => {
    const provider = createMockProvider({
      getClassifications: (id) => {
        if (id === 1) return [{ system: 'Uniclass', identification: 'Pr_60' }];
        return [];
      },
    });
    const result = discoverLensData(provider);
    expect(result.classificationSystems).toEqual(['Uniclass']);
  });

  it('discovers material names', () => {
    const provider = createMockProvider({
      getMaterialName: (id) => {
        if (id === 1) return 'Concrete';
        if (id === 2) return 'Steel';
        return undefined;
      },
    });
    const result = discoverLensData(provider);
    expect(result.materials).toEqual(['Concrete', 'Steel']);
  });

  it('returns empty results for empty model', () => {
    const provider = createMockProvider({
      getEntityCount: () => 0,
      forEachEntity: () => {},
    });
    const result = discoverLensData(provider);
    expect(result.types).toEqual([]);
    expect(result.propertySets.size).toBe(0);
    expect(result.quantitySets.size).toBe(0);
    expect(result.classificationSystems).toEqual([]);
    expect(result.materials).toEqual([]);
  });

  it('deduplicates types and properties across entities', () => {
    const provider = createMockProvider({
      forEachEntity: (cb) => {
        // Two walls with same pset
        cb(1, 'm'); cb(3, 'm');
      },
    });
    const result = discoverLensData(provider);
    // IfcWall should appear only once
    expect(result.types).toEqual(['IfcWall']);
    // Properties should be deduplicated
    expect(result.propertySets.get('Pset_WallCommon')?.length).toBe(2);
  });
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { IfcTypeEnum } from '@ifc-lite/data';
import { executeList, listResultToCSV } from './engine.js';
import { discoverColumns } from './discovery.js';
import { LIST_PRESETS } from './presets.js';
import type { ListDataProvider, ListDefinition } from './types.js';

// ============================================================================
// Mock Data Provider
// ============================================================================

function createMockProvider(): ListDataProvider {
  const entities = new Map<number, { name: string; globalId: string; type: string; desc: string; objType: string }>([
    [1, { name: 'Wall-01', globalId: '0abc', type: 'IfcWall', desc: 'Exterior wall', objType: 'Basic Wall' }],
    [2, { name: 'Wall-02', globalId: '1def', type: 'IfcWall', desc: 'Interior wall', objType: 'Basic Wall' }],
    [3, { name: 'Slab-01', globalId: '2ghi', type: 'IfcSlab', desc: 'Floor slab', objType: 'Floor' }],
  ]);

  const typeIndex = new Map<IfcTypeEnum, number[]>([
    [IfcTypeEnum.IfcWall, [1, 2]],
    [IfcTypeEnum.IfcSlab, [3]],
  ]);

  const propertySets = new Map<number, Array<{ name: string; properties: Array<{ name: string; value: unknown }> }>>([
    [1, [
      { name: 'Pset_WallCommon', properties: [
        { name: 'IsExternal', value: ['IFCBOOLEAN', '.T.'] },
        { name: 'FireRating', value: 'REI 90' },
        { name: 'LoadBearing', value: ['IFCBOOLEAN', '.T.'] },
      ]},
    ]],
    [2, [
      { name: 'Pset_WallCommon', properties: [
        { name: 'IsExternal', value: ['IFCBOOLEAN', '.F.'] },
        { name: 'FireRating', value: 'EI 30' },
        { name: 'LoadBearing', value: ['IFCBOOLEAN', '.F.'] },
      ]},
    ]],
    [3, []],
  ]);

  const quantitySets = new Map<number, Array<{ name: string; quantities: Array<{ name: string; value: number; type: number }> }>>([
    [1, [
      { name: 'Qto_WallBaseQuantities', quantities: [
        { name: 'Length', value: 5.0, type: 0 },
        { name: 'Height', value: 2.8, type: 0 },
        { name: 'Width', value: 0.2, type: 0 },
      ]},
    ]],
    [2, [
      { name: 'Qto_WallBaseQuantities', quantities: [
        { name: 'Length', value: 3.5, type: 0 },
        { name: 'Height', value: 2.8, type: 0 },
        { name: 'Width', value: 0.15, type: 0 },
      ]},
    ]],
    [3, [
      { name: 'Qto_SlabBaseQuantities', quantities: [
        { name: 'GrossArea', value: 45.2, type: 1 },
        { name: 'GrossVolume', value: 9.04, type: 2 },
      ]},
    ]],
  ]);

  return {
    getEntitiesByType: (type) => typeIndex.get(type) ?? [],
    getEntityName: (id) => entities.get(id)?.name ?? '',
    getEntityGlobalId: (id) => entities.get(id)?.globalId ?? '',
    getEntityDescription: (id) => entities.get(id)?.desc ?? '',
    getEntityObjectType: (id) => entities.get(id)?.objType ?? '',
    getEntityTag: () => '',
    getEntityTypeName: (id) => entities.get(id)?.type ?? '',
    getPropertySets: (id) => propertySets.get(id) ?? [],
    getQuantitySets: (id) => quantitySets.get(id) ?? [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('executeList', () => {
  it('returns rows for matching entity types', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-1',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
        { id: 'class', source: 'attribute', propertyName: 'Class' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(2);
    expect(result.rows[0].values[0]).toBe('Wall-01');
    expect(result.rows[1].values[0]).toBe('Wall-02');
    expect(result.rows[0].values[1]).toBe('IfcWall');
  });

  it('extracts property values with IFC type resolution', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-2',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
        { id: 'ext', source: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal' },
        { id: 'fire', source: 'property', psetName: 'Pset_WallCommon', propertyName: 'FireRating' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(2);
    // IsExternal should be resolved from ['IFCBOOLEAN', '.T.'] to 'True'
    expect(result.rows[0].values[1]).toBe('True');
    expect(result.rows[1].values[1]).toBe('False');
    // FireRating is a plain string
    expect(result.rows[0].values[2]).toBe('REI 90');
  });

  it('extracts quantity values with unit formatting', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-3',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
        { id: 'len', source: 'quantity', psetName: 'Qto_WallBaseQuantities', propertyName: 'Length' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(2);
    // Length = 5.0, returned as raw number for sortability
    expect(result.rows[0].values[1]).toBe(5.0);
  });

  it('filters by conditions', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-4',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [
        { source: 'attribute', propertyName: 'Name', operator: 'contains', value: '01' },
      ],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(1);
    expect(result.rows[0].values[0]).toBe('Wall-01');
  });

  it('returns null for missing properties', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-5',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcSlab],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
        { id: 'ext', source: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(1);
    expect(result.rows[0].values[0]).toBe('Slab-01');
    expect(result.rows[0].values[1]).toBeNull();
  });

  it('handles multiple entity types', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-6',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall, IfcTypeEnum.IfcSlab],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
      ],
    };

    const result = executeList(def, provider);
    expect(result.totalCount).toBe(3);
  });

  it('sorts results when sortBy is configured', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'test-7',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
      ],
      sortBy: { columnId: 'name', direction: 'desc' },
    };

    const result = executeList(def, provider);
    expect(result.rows[0].values[0]).toBe('Wall-02');
    expect(result.rows[1].values[0]).toBe('Wall-01');
  });
});

describe('listResultToCSV', () => {
  it('produces valid CSV output', () => {
    const provider = createMockProvider();
    const def: ListDefinition = {
      id: 'csv-test',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      entityTypes: [IfcTypeEnum.IfcWall],
      conditions: [],
      columns: [
        { id: 'name', source: 'attribute', propertyName: 'Name' },
        { id: 'fire', source: 'property', psetName: 'Pset_WallCommon', propertyName: 'FireRating', label: 'Fire Rating' },
      ],
    };

    const result = executeList(def, provider);
    const csv = listResultToCSV(result);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('Name,Fire Rating');
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it('escapes values with commas and quotes', () => {
    const csv = listResultToCSV({
      columns: [{ id: 'a', source: 'attribute', propertyName: 'Name' }],
      rows: [{ entityId: 1, modelId: 'default', values: ['Hello, "World"'] }],
      totalCount: 1,
      executionTime: 0,
    });

    expect(csv).toContain('"Hello, ""World"""');
  });
});

describe('discoverColumns', () => {
  it('discovers attributes, properties and quantities', () => {
    const provider = createMockProvider();
    const result = discoverColumns(provider, [IfcTypeEnum.IfcWall]);

    expect(result.attributes).toContain('Name');
    expect(result.attributes).toContain('GlobalId');

    expect(result.properties.has('Pset_WallCommon')).toBe(true);
    expect(result.properties.get('Pset_WallCommon')).toContain('IsExternal');
    expect(result.properties.get('Pset_WallCommon')).toContain('FireRating');

    expect(result.quantities.has('Qto_WallBaseQuantities')).toBe(true);
    expect(result.quantities.get('Qto_WallBaseQuantities')).toContain('Length');
  });

  it('works with multiple providers', () => {
    const p1 = createMockProvider();
    const p2 = createMockProvider();
    const result = discoverColumns([p1, p2], [IfcTypeEnum.IfcWall]);

    expect(result.properties.has('Pset_WallCommon')).toBe(true);
  });

  it('discovers columns across multiple types', () => {
    const provider = createMockProvider();
    const result = discoverColumns(provider, [IfcTypeEnum.IfcWall, IfcTypeEnum.IfcSlab]);

    expect(result.quantities.has('Qto_WallBaseQuantities')).toBe(true);
    expect(result.quantities.has('Qto_SlabBaseQuantities')).toBe(true);
  });
});

describe('LIST_PRESETS', () => {
  it('contains at least 3 presets', () => {
    expect(LIST_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  it('all presets have required fields', () => {
    for (const preset of LIST_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.entityTypes.length).toBeGreaterThan(0);
      expect(preset.columns.length).toBeGreaterThan(0);
    }
  });
});

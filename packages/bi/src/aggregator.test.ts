/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests for BIDataAggregator
 */

import { describe, it, beforeEach, expect } from 'vitest';
import {
  BIDataAggregator,
  computeHighlightedKeys,
  applyFiltersToConfig,
  type BIModelData,
  type PropertySet,
  type QuantitySet,
  type MaterialRef,
  type ClassificationRef,
} from './aggregator.js';
import type { AggregationConfig, AggregatedDataPoint, EntityRef } from './types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockModel(
  modelId: string,
  options: {
    entities?: Map<number, { type: string; name: string }>;
    properties?: Map<number, PropertySet[]>;
    quantities?: Map<number, QuantitySet[]>;
    materials?: Map<number, MaterialRef[]>;
    classifications?: Map<number, ClassificationRef[]>;
    storeyMapping?: Map<number, number>;
    geometryExpressIds?: number[];
  } = {}
): BIModelData {
  const entities = options.entities ?? new Map([
    [1, { type: 'IfcWall', name: 'Wall 1' }],
    [2, { type: 'IfcWall', name: 'Wall 2' }],
    [3, { type: 'IfcDoor', name: 'Door 1' }],
    [4, { type: 'IfcWindow', name: 'Window 1' }],
    [5, { type: 'IfcWindow', name: 'Window 2' }],
  ]);

  const geometryExpressIds = options.geometryExpressIds ?? Array.from(entities.keys());

  return {
    modelId,
    entities: {
      getType: (expressId: number) => entities.get(expressId)?.type,
      getName: (expressId: number) => entities.get(expressId)?.name,
    },
    spatialHierarchy: options.storeyMapping
      ? {
          elementToStorey: options.storeyMapping,
          project: {
            expressId: 100,
            name: 'Project',
            type: 1,
            elements: [],
            children: [],
          },
          getPath: () => [],
        }
      : undefined,
    properties: options.properties
      ? {
          getForEntity: (expressId: number) => options.properties!.get(expressId),
        }
      : undefined,
    quantities: options.quantities
      ? {
          getForEntity: (expressId: number) => options.quantities!.get(expressId),
        }
      : undefined,
    relationships: options.materials || options.classifications
      ? {
          getMaterials: (expressId: number) => options.materials?.get(expressId),
          getClassifications: (expressId: number) => options.classifications?.get(expressId),
        }
      : undefined,
    geometryExpressIds,
  };
}

// ============================================================================
// BIDataAggregator Tests
// ============================================================================

describe('BIDataAggregator', () => {
  describe('constructor and updateModels', () => {
    it('should create aggregator with initial models', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.getElementsByType();
      expect(result.totalEntities).toBe(5);
    });

    it('should update models and invalidate cache', () => {
      const model1 = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model1]);

      // First aggregation
      const result1 = aggregator.getElementsByType();
      expect(result1.totalEntities).toBe(5);

      // Update with different model
      const model2 = createMockModel('model-2', {
        entities: new Map([[1, { type: 'IfcSlab', name: 'Slab 1' }]]),
        geometryExpressIds: [1],
      });
      aggregator.updateModels([model2]);

      // Should use new data
      const result2 = aggregator.getElementsByType();
      expect(result2.totalEntities).toBe(1);
      expect(result2.data[0].key).toBe('IfcSlab');
    });
  });

  describe('aggregate by ifcType', () => {
    let aggregator: BIDataAggregator;

    beforeEach(() => {
      const model = createMockModel('model-1');
      aggregator = new BIDataAggregator([model]);
    });

    it('should count elements by IFC type', () => {
      const result = aggregator.aggregate({ groupBy: 'ifcType', metric: 'count' });

      expect(result.totalEntities).toBe(5);
      expect(result.data).toHaveLength(3); // IfcWall, IfcDoor, IfcWindow

      const wallGroup = result.data.find((d) => d.key === 'IfcWall');
      expect(wallGroup?.value).toBe(2);
      expect(wallGroup?.entityRefs).toHaveLength(2);

      const windowGroup = result.data.find((d) => d.key === 'IfcWindow');
      expect(windowGroup?.value).toBe(2);

      const doorGroup = result.data.find((d) => d.key === 'IfcDoor');
      expect(doorGroup?.value).toBe(1);
    });

    it('should format labels by removing Ifc prefix', () => {
      const result = aggregator.getElementsByType();

      const wallGroup = result.data.find((d) => d.key === 'IfcWall');
      expect(wallGroup?.label).toBe('Wall');
    });

    it('should sort results by value descending', () => {
      const result = aggregator.getElementsByType();

      // IfcWall (2) and IfcWindow (2) should be first, IfcDoor (1) last
      expect(result.data[result.data.length - 1].value).toBe(1);
      expect(result.data[0].value).toBeGreaterThanOrEqual(result.data[1].value);
    });

    it('should cache results', () => {
      const result1 = aggregator.getElementsByType();
      const result2 = aggregator.getElementsByType();

      // Same cache key means same object reference
      expect(result1.cacheKey).toBe(result2.cacheKey);
    });
  });

  describe('aggregate by storey', () => {
    it('should group elements by storey', () => {
      const storeyMapping = new Map([
        [1, 10], // Wall 1 -> Storey 10
        [2, 10], // Wall 2 -> Storey 10
        [3, 20], // Door 1 -> Storey 20
        [4, 20], // Window 1 -> Storey 20
        [5, 20], // Window 2 -> Storey 20
      ]);

      const model = createMockModel('model-1', {
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcDoor', name: 'Door 1' }],
          [4, { type: 'IfcWindow', name: 'Window 1' }],
          [5, { type: 'IfcWindow', name: 'Window 2' }],
          [10, { type: 'IfcBuildingStorey', name: 'Ground Floor' }],
          [20, { type: 'IfcBuildingStorey', name: 'First Floor' }],
        ]),
        storeyMapping,
        geometryExpressIds: [1, 2, 3, 4, 5],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.getElementsByStorey();

      expect(result.data).toHaveLength(2);

      const groundFloor = result.data.find((d) => d.label === 'Ground Floor');
      expect(groundFloor?.value).toBe(2);

      const firstFloor = result.data.find((d) => d.label === 'First Floor');
      expect(firstFloor?.value).toBe(3);
    });

    it('should handle elements without storey assignment', () => {
      const model = createMockModel('model-1', {
        storeyMapping: new Map(), // No storey assignments
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.getElementsByStorey();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].key).toBe('Unassigned');
      expect(result.data[0].value).toBe(5);
    });
  });

  describe('aggregate by material', () => {
    it('should group elements by material', () => {
      const materials = new Map<number, MaterialRef[]>([
        [1, [{ name: 'Concrete', expressId: 100 }]],
        [2, [{ name: 'Concrete', expressId: 100 }]],
        [3, [{ name: 'Wood', expressId: 101 }]],
        [4, [{ name: 'Glass', expressId: 102 }]],
        [5, [{ name: 'Glass', expressId: 102 }]],
      ]);

      const model = createMockModel('model-1', { materials });
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({ groupBy: 'material', metric: 'count' });

      expect(result.data).toHaveLength(3);

      const concrete = result.data.find((d) => d.key === 'Concrete');
      expect(concrete?.value).toBe(2);

      const glass = result.data.find((d) => d.key === 'Glass');
      expect(glass?.value).toBe(2);
    });

    it('should handle elements without material', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({ groupBy: 'material', metric: 'count' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].key).toBe('No Material');
    });
  });

  describe('aggregate by classification', () => {
    it('should group elements by classification', () => {
      const classifications = new Map<number, ClassificationRef[]>([
        [1, [{ name: 'Uniclass:Ss_25_10_30', expressId: 200 }]],
        [2, [{ name: 'Uniclass:Ss_25_10_30', expressId: 200 }]],
        [3, [{ name: 'Uniclass:Ss_25_30_20', expressId: 201 }]],
      ]);

      const model = createMockModel('model-1', {
        classifications,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcDoor', name: 'Door 1' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.aggregate({ groupBy: 'classification', metric: 'count' });

      expect(result.data).toHaveLength(2);
    });

    it('should handle unclassified elements', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({ groupBy: 'classification', metric: 'count' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].key).toBe('Unclassified');
    });
  });

  describe('aggregate by property', () => {
    it('should group elements by property value', () => {
      const properties = new Map<number, PropertySet[]>([
        [1, [{ name: 'Pset_WallCommon', properties: [{ name: 'IsExternal', value: true }] }]],
        [2, [{ name: 'Pset_WallCommon', properties: [{ name: 'IsExternal', value: true }] }]],
        [3, [{ name: 'Pset_DoorCommon', properties: [{ name: 'IsExternal', value: false }] }]],
      ]);

      const model = createMockModel('model-1', {
        properties,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcDoor', name: 'Door 1' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.aggregate({
        groupBy: 'property',
        propertyPath: 'Pset_WallCommon.IsExternal',
        metric: 'count',
      });

      expect(result.data).toHaveLength(2);

      const yesGroup = result.data.find((d) => d.key === 'Yes');
      expect(yesGroup?.value).toBe(2);

      const undefinedGroup = result.data.find((d) => d.key === 'Undefined');
      expect(undefinedGroup?.value).toBe(1); // Door doesn't have Pset_WallCommon
    });

    it('should handle string property values', () => {
      const properties = new Map<number, PropertySet[]>([
        [1, [{ name: 'Pset_WallCommon', properties: [{ name: 'FireRating', value: 'REI60' }] }]],
        [2, [{ name: 'Pset_WallCommon', properties: [{ name: 'FireRating', value: 'REI60' }] }]],
        [3, [{ name: 'Pset_WallCommon', properties: [{ name: 'FireRating', value: 'REI90' }] }]],
      ]);

      const model = createMockModel('model-1', {
        properties,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcWall', name: 'Wall 3' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.aggregate({
        groupBy: 'property',
        propertyPath: 'Pset_WallCommon.FireRating',
        metric: 'count',
      });

      expect(result.data).toHaveLength(2);

      const rei60 = result.data.find((d) => d.key === 'REI60');
      expect(rei60?.value).toBe(2);

      const rei90 = result.data.find((d) => d.key === 'REI90');
      expect(rei90?.value).toBe(1);
    });
  });

  describe('quantity aggregation', () => {
    it('should sum area by type', () => {
      const quantities = new Map<number, QuantitySet[]>([
        [1, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'GrossSideArea', type: 1, value: 10.0 }] }]],
        [2, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'GrossSideArea', type: 1, value: 15.0 }] }]],
        [3, [{ name: 'Qto_DoorBaseQuantities', quantities: [{ name: 'Area', type: 1, value: 2.0 }] }]],
      ]);

      const model = createMockModel('model-1', {
        quantities,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcDoor', name: 'Door 1' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'sum',
        quantityField: 'area',
      });

      const wallGroup = result.data.find((d) => d.key === 'IfcWall');
      expect(wallGroup?.value).toBe(25.0);

      const doorGroup = result.data.find((d) => d.key === 'IfcDoor');
      expect(doorGroup?.value).toBe(2.0);
    });

    it('should calculate average volume', () => {
      const quantities = new Map<number, QuantitySet[]>([
        [1, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'GrossVolume', type: 2, value: 5.0 }] }]],
        [2, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'GrossVolume', type: 2, value: 10.0 }] }]],
        [3, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'GrossVolume', type: 2, value: 15.0 }] }]],
      ]);

      const model = createMockModel('model-1', {
        quantities,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcWall', name: 'Wall 3' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);
      const result = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'avg',
        quantityField: 'volume',
      });

      const wallGroup = result.data.find((d) => d.key === 'IfcWall');
      expect(wallGroup?.value).toBe(10.0); // (5 + 10 + 15) / 3
    });

    it('should calculate min and max', () => {
      const quantities = new Map<number, QuantitySet[]>([
        [1, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'Length', type: 0, value: 5.0 }] }]],
        [2, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'Length', type: 0, value: 10.0 }] }]],
        [3, [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'Length', type: 0, value: 3.0 }] }]],
      ]);

      const model = createMockModel('model-1', {
        quantities,
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
          [3, { type: 'IfcWall', name: 'Wall 3' }],
        ]),
        geometryExpressIds: [1, 2, 3],
      });

      const aggregator = new BIDataAggregator([model]);

      const minResult = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'min',
        quantityField: 'length',
      });
      expect(minResult.data[0].value).toBe(3.0);

      const maxResult = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'max',
        quantityField: 'length',
      });
      expect(maxResult.data[0].value).toBe(10.0);
    });

    it('should handle missing quantities gracefully', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'sum',
        quantityField: 'area',
      });

      // All values should be 0 since no quantities
      expect(result.data.every((d) => d.value === 0)).toBe(true);
    });
  });

  describe('pre-filter', () => {
    it('should filter entities before aggregation', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'count',
        preFilter: {
          dimension: 'ifcType',
          values: ['IfcWall'],
        },
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].key).toBe('IfcWall');
      expect(result.totalEntities).toBe(2);
    });

    it('should exclude values when exclude is true', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.aggregate({
        groupBy: 'ifcType',
        metric: 'count',
        preFilter: {
          dimension: 'ifcType',
          values: ['IfcWall'],
          exclude: true,
        },
      });

      expect(result.data).toHaveLength(2); // IfcDoor and IfcWindow
      expect(result.data.find((d) => d.key === 'IfcWall')).toBeUndefined();
      expect(result.totalEntities).toBe(3);
    });
  });

  describe('multi-model federation', () => {
    it('should aggregate across multiple models', () => {
      const model1 = createMockModel('model-1', {
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 1' }],
          [2, { type: 'IfcWall', name: 'Wall 2' }],
        ]),
        geometryExpressIds: [1, 2],
      });

      const model2 = createMockModel('model-2', {
        entities: new Map([
          [1, { type: 'IfcWall', name: 'Wall 3' }],
          [2, { type: 'IfcDoor', name: 'Door 1' }],
        ]),
        geometryExpressIds: [1, 2],
      });

      const aggregator = new BIDataAggregator([model1, model2]);
      const result = aggregator.getElementsByType();

      expect(result.totalEntities).toBe(4);

      const wallGroup = result.data.find((d) => d.key === 'IfcWall');
      expect(wallGroup?.value).toBe(3);

      // Entity refs should include both models
      expect(wallGroup?.entityRefs).toContainEqual({ modelId: 'model-1', expressId: 1 });
      expect(wallGroup?.entityRefs).toContainEqual({ modelId: 'model-2', expressId: 1 });
    });
  });

  describe('convenience methods', () => {
    let aggregator: BIDataAggregator;

    beforeEach(() => {
      const quantities = new Map<number, QuantitySet[]>([
        [1, [{ name: 'Qto_WallBaseQuantities', quantities: [
          { name: 'GrossSideArea', type: 1, value: 10.0 },
          { name: 'GrossVolume', type: 2, value: 5.0 },
        ]}]],
      ]);

      const materials = new Map<number, MaterialRef[]>([
        [1, [{ name: 'Concrete', expressId: 100 }]],
      ]);

      const model = createMockModel('model-1', {
        quantities,
        materials,
        entities: new Map([[1, { type: 'IfcWall', name: 'Wall 1' }]]),
        geometryExpressIds: [1],
      });

      aggregator = new BIDataAggregator([model]);
    });

    it('getElementsByType should work', () => {
      const result = aggregator.getElementsByType();
      expect(result.data[0].key).toBe('IfcWall');
    });

    it('getElementsByStorey should work', () => {
      const result = aggregator.getElementsByStorey();
      expect(result.data[0].key).toBe('Unassigned');
    });

    it('getAreaByStorey should work', () => {
      const result = aggregator.getAreaByStorey();
      expect(result.data[0].value).toBe(10.0);
    });

    it('getVolumeByMaterial should work', () => {
      const result = aggregator.getVolumeByMaterial();
      expect(result.data[0].key).toBe('Concrete');
      expect(result.data[0].value).toBe(5.0);
    });
  });

  describe('performance tracking', () => {
    it('should track computation time', () => {
      const model = createMockModel('model-1');
      const aggregator = new BIDataAggregator([model]);

      const result = aggregator.getElementsByType();

      expect(typeof result.computeTimeMs).toBe('number');
      expect(result.computeTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// computeHighlightedKeys Tests
// ============================================================================

describe('computeHighlightedKeys', () => {
  it('should return empty set when no selection', () => {
    const data: AggregatedDataPoint[] = [
      {
        key: 'IfcWall',
        label: 'Wall',
        value: 2,
        entityRefs: [
          { modelId: 'model-1', expressId: 1 },
          { modelId: 'model-1', expressId: 2 },
        ],
      },
    ];

    const result = computeHighlightedKeys(data, []);
    expect(result.size).toBe(0);
  });

  it('should highlight keys containing selected entities', () => {
    const data: AggregatedDataPoint[] = [
      {
        key: 'IfcWall',
        label: 'Wall',
        value: 2,
        entityRefs: [
          { modelId: 'model-1', expressId: 1 },
          { modelId: 'model-1', expressId: 2 },
        ],
      },
      {
        key: 'IfcDoor',
        label: 'Door',
        value: 1,
        entityRefs: [{ modelId: 'model-1', expressId: 3 }],
      },
    ];

    const selectedEntities: EntityRef[] = [{ modelId: 'model-1', expressId: 1 }];

    const result = computeHighlightedKeys(data, selectedEntities);

    expect(result.has('IfcWall')).toBe(true);
    expect(result.has('IfcDoor')).toBe(false);
  });

  it('should handle multi-model selection', () => {
    const data: AggregatedDataPoint[] = [
      {
        key: 'IfcWall',
        label: 'Wall',
        value: 2,
        entityRefs: [
          { modelId: 'model-1', expressId: 1 },
          { modelId: 'model-2', expressId: 1 },
        ],
      },
    ];

    const selectedEntities: EntityRef[] = [{ modelId: 'model-2', expressId: 1 }];

    const result = computeHighlightedKeys(data, selectedEntities);
    expect(result.has('IfcWall')).toBe(true);
  });

  it('should highlight multiple keys for multi-entity selection', () => {
    const data: AggregatedDataPoint[] = [
      {
        key: 'IfcWall',
        label: 'Wall',
        value: 1,
        entityRefs: [{ modelId: 'model-1', expressId: 1 }],
      },
      {
        key: 'IfcDoor',
        label: 'Door',
        value: 1,
        entityRefs: [{ modelId: 'model-1', expressId: 2 }],
      },
      {
        key: 'IfcWindow',
        label: 'Window',
        value: 1,
        entityRefs: [{ modelId: 'model-1', expressId: 3 }],
      },
    ];

    const selectedEntities: EntityRef[] = [
      { modelId: 'model-1', expressId: 1 },
      { modelId: 'model-1', expressId: 2 },
    ];

    const result = computeHighlightedKeys(data, selectedEntities);

    expect(result.has('IfcWall')).toBe(true);
    expect(result.has('IfcDoor')).toBe(true);
    expect(result.has('IfcWindow')).toBe(false);
  });
});

// ============================================================================
// applyFiltersToConfig Tests
// ============================================================================

describe('applyFiltersToConfig', () => {
  it('should return original config when no filters', () => {
    const config: AggregationConfig = { groupBy: 'ifcType', metric: 'count' };
    const filters = new Map<string, Set<string>>();

    const result = applyFiltersToConfig(config, filters, 'chart-1');

    expect(result).toEqual(config);
  });

  it('should exclude own chart filter', () => {
    const config: AggregationConfig = { groupBy: 'ifcType', metric: 'count' };
    const filters = new Map<string, Set<string>>([
      ['chart-1', new Set(['IfcWall'])], // Own filter - should be excluded
    ]);

    const result = applyFiltersToConfig(config, filters, 'chart-1');

    expect(result.preFilter).toBeUndefined();
  });

  it('should apply other chart filters', () => {
    const config: AggregationConfig = { groupBy: 'ifcType', metric: 'count' };
    const filters = new Map<string, Set<string>>([
      ['chart-2', new Set(['IfcWall', 'IfcDoor'])],
    ]);

    const result = applyFiltersToConfig(config, filters, 'chart-1');

    expect(result.preFilter).toBeDefined();
    expect(result.preFilter?.values).toContain('IfcWall');
    expect(result.preFilter?.values).toContain('IfcDoor');
  });

  it('should preserve existing preFilter if no cross-filters', () => {
    const config: AggregationConfig = {
      groupBy: 'ifcType',
      metric: 'count',
      preFilter: { dimension: 'storey', values: ['Level 1'] },
    };
    const filters = new Map<string, Set<string>>();

    const result = applyFiltersToConfig(config, filters, 'chart-1');

    expect(result.preFilter).toEqual(config.preFilter);
  });
});

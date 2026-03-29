/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { PropertyValueType } from '@ifc-lite/data';
import { BulkQueryEngine, MutablePropertyView } from '../src/index.js';

describe('MutablePropertyView', () => {
  it('creates a new property set automatically and returns mutated values', () => {
    const view = new MutablePropertyView(null, 'model-1');
    view.setOnDemandExtractor(() => []);

    view.setProperty(42, 'Pset_Custom', 'Code', 'A-01', PropertyValueType.Label);

    expect(view.getPropertyValue(42, 'Pset_Custom', 'Code')).toBe('A-01');
    expect(view.getForEntity(42)).toMatchObject([
      {
        name: 'Pset_Custom',
        properties: [
          {
            name: 'Code',
            type: PropertyValueType.Label,
            value: 'A-01',
          },
        ],
      },
    ]);
  });

  it('deletes an existing property from the overlaid view', () => {
    const view = new MutablePropertyView(null, 'model-1');
    view.setOnDemandExtractor((entityId) => entityId === 7 ? [{
      name: 'Pset_Base',
      globalId: 'base-guid',
      properties: [
        { name: 'Status', type: PropertyValueType.Label, value: 'Existing' },
      ],
    }] : []);

    view.deleteProperty(7, 'Pset_Base', 'Status');

    expect(view.getPropertyValue(7, 'Pset_Base', 'Status')).toBeNull();
    expect(view.getForEntity(7)).toEqual([]);
  });
});

describe('BulkQueryEngine', () => {
  it('selects by GlobalId and applies property mutations', () => {
    const strings = ['guid-wall-a', 'guid-wall-b', 'Wall Alpha', 'Wall Beta'];
    const view = new MutablePropertyView(null, 'model-1');
    view.setOnDemandExtractor(() => []);

    const entities = {
      count: 2,
      expressId: new Int32Array([1, 2]),
      typeEnum: new Uint32Array([10, 10]),
      globalId: new Int32Array([0, 1]),
      name: new Int32Array([2, 3]),
    } as any;

    const engine = new BulkQueryEngine(
      entities,
      view,
      null,
      null,
      { get: (idx: number) => strings[idx] },
    );

    const preview = engine.preview({
      select: { globalIds: ['guid-wall-b'] },
      action: {
        type: 'SET_PROPERTY',
        psetName: 'Pset_Bulk',
        propName: 'Zone',
        value: 'B',
        valueType: PropertyValueType.Label,
      },
    });

    expect(preview.matchedEntityIds).toEqual([2]);

    const result = engine.execute({
      select: { entityTypes: [10], namePattern: 'Wall' },
      action: {
        type: 'SET_PROPERTY',
        psetName: 'Pset_Bulk',
        propName: 'Zone',
        value: 'North',
        valueType: PropertyValueType.Label,
      },
    });

    expect(result.success).toBe(true);
    expect(result.affectedEntityCount).toBe(2);
    expect(view.getPropertyValue(1, 'Pset_Bulk', 'Zone')).toBe('North');
    expect(view.getPropertyValue(2, 'Pset_Bulk', 'Zone')).toBe('North');
  });
});

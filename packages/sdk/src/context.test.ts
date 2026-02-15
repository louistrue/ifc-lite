/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from 'vitest';
import { BimContext, createBimContext } from './context.js';
import type { BimBackend } from './types.js';

/** Create a mock typed BimBackend */
function createMockBackend() {
  const model = {
    list: vi.fn(() => []),
    activeId: vi.fn(() => null),
  };
  const query = {
    entities: vi.fn(() => []),
    entityData: vi.fn(() => null),
    properties: vi.fn(() => []),
    quantities: vi.fn(() => []),
    related: vi.fn(() => []),
  };
  const selection = {
    get: vi.fn(() => []),
    set: vi.fn(),
  };
  const visibility = {
    hide: vi.fn(),
    show: vi.fn(),
    isolate: vi.fn(),
    reset: vi.fn(),
  };
  const viewer = {
    colorize: vi.fn(),
    colorizeAll: vi.fn(),
    resetColors: vi.fn(),
    flyTo: vi.fn(),
    setSection: vi.fn(),
    getSection: vi.fn(() => null),
    setCamera: vi.fn(),
    getCamera: vi.fn(() => ({ mode: 'perspective' as const, position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number] })),
  };
  const mutate = {
    setProperty: vi.fn(),
    deleteProperty: vi.fn(),
    batchBegin: vi.fn(),
    batchEnd: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
  };
  const spatial = {
    queryBounds: vi.fn(() => []),
    raycast: vi.fn(() => []),
    queryFrustum: vi.fn(() => []),
  };
  const exportNs = {
    csv: vi.fn(() => ''),
    json: vi.fn(() => []),
    download: vi.fn(),
  };
  const lens = {
    presets: vi.fn(() => []),
    create: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    getActive: vi.fn(() => null),
  };

  const backend: BimBackend = {
    model,
    query,
    selection,
    visibility,
    viewer,
    mutate,
    spatial,
    export: exportNs,
    lens,
    subscribe: vi.fn(() => () => {}),
  };

  return { backend, model, query, selection, visibility, viewer, mutate, spatial, export: exportNs, lens };
}

describe('BimContext', () => {
  it('creates a context with a backend', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    expect(bim).toBeInstanceOf(BimContext);
    expect(bim.model).toBeDefined();
    expect(bim.viewer).toBeDefined();
    expect(bim.mutate).toBeDefined();
    expect(bim.lens).toBeDefined();
    expect(bim.export).toBeDefined();
    expect(bim.ids).toBeDefined();
    expect(bim.bcf).toBeDefined();
    expect(bim.drawing).toBeDefined();
    expect(bim.list).toBeDefined();
    expect(bim.events).toBeDefined();
    expect(bim.spatial).toBeDefined();
  });

  it('throws without backend or transport', () => {
    expect(() => createBimContext({} as {} & { backend?: BimBackend })).toThrow('BimContext requires either a backend or transport');
  });

  it('query() returns a QueryBuilder', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const builder = bim.query();
    expect(builder).toBeDefined();
    expect(typeof builder.byType).toBe('function');
    expect(typeof builder.toArray).toBe('function');
  });

  it('entity() returns null for unknown entity', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const result = bim.entity({ modelId: 'test', expressId: 999 });
    expect(result).toBeNull();
  });

  it('on() delegates to events namespace', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    expect(typeof bim.on).toBe('function');
  });
});

describe('QueryBuilder', () => {
  it('chains methods and calls backend.query.entities', () => {
    const { backend, query } = createMockBackend();
    query.entities.mockReturnValue([
      { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
    ]);

    const bim = createBimContext({ backend });
    const results = bim.query().byType('IfcWall').toArray();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Wall 1');
    expect(results[0].type).toBe('IfcWall');
    expect(query.entities).toHaveBeenCalled();
  });

  it('count() returns number of matches', () => {
    const { backend, query } = createMockBackend();
    query.entities.mockReturnValue([
      { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
      { ref: { modelId: 'model-1', expressId: 2 }, globalId: 'def', name: 'Wall 2', type: 'IfcWall', description: '', objectType: '' },
    ]);

    const bim = createBimContext({ backend });
    const count = bim.query().byType('IfcWall').count();

    expect(count).toBe(2);
  });

  it('first() returns first match or null', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const result = bim.query().first();
    expect(result).toBeNull();
  });

  it('refs() returns EntityRef array', () => {
    const { backend, query } = createMockBackend();
    query.entities.mockReturnValue([
      { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
    ]);

    const bim = createBimContext({ backend });
    const refs = bim.query().refs();

    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ modelId: 'model-1', expressId: 1 });
  });
});

describe('ExportNamespace', () => {
  it('csv() generates CSV string', () => {
    const { backend, query } = createMockBackend();
    query.entityData.mockReturnValue({
      ref: { modelId: 'model-1', expressId: 1 },
      globalId: 'abc',
      name: 'Wall 1',
      type: 'IfcWall',
      description: '',
      objectType: '',
    });

    const bim = createBimContext({ backend });
    const csv = bim.export.csv(
      [{ modelId: 'model-1', expressId: 1 }],
      { columns: ['name', 'type'] },
    );

    expect(csv).toContain('name,type');
    expect(csv).toContain('Wall 1,IfcWall');
  });

  it('json() generates JSON array', () => {
    const { backend, query } = createMockBackend();
    query.entityData.mockReturnValue({
      ref: { modelId: 'model-1', expressId: 1 },
      globalId: 'abc',
      name: 'Wall 1',
      type: 'IfcWall',
      description: '',
      objectType: '',
    });

    const bim = createBimContext({ backend });
    const data = bim.export.json(
      [{ modelId: 'model-1', expressId: 1 }],
      ['name', 'type'],
    );

    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({ name: 'Wall 1', type: 'IfcWall' });
  });
});

describe('ViewerNamespace', () => {
  it('colorize() calls viewer.colorize', () => {
    const { backend, viewer } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.colorize([{ modelId: 'm', expressId: 1 }], '#ff0000');
    expect(viewer.colorize).toHaveBeenCalled();
  });

  it('hide() calls visibility.hide', () => {
    const { backend, visibility } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.hide([{ modelId: 'm', expressId: 1 }]);
    expect(visibility.hide).toHaveBeenCalled();
  });

  it('select() calls selection.set', () => {
    const { backend, selection } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.select([{ modelId: 'm', expressId: 1 }]);
    expect(selection.set).toHaveBeenCalled();
  });
});

describe('MutateNamespace', () => {
  it('setProperty() calls mutate.setProperty', () => {
    const { backend, mutate } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.setProperty({ modelId: 'm', expressId: 1 }, 'Pset', 'Prop', 'value');
    expect(mutate.setProperty).toHaveBeenCalledWith(
      { modelId: 'm', expressId: 1 }, 'Pset', 'Prop', 'value',
    );
  });

  it('undo() calls mutate.undo', () => {
    const { backend, mutate } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.undo('model-1');
    expect(mutate.undo).toHaveBeenCalledWith('model-1');
  });
});

describe('LensNamespace', () => {
  it('presets() returns built-in lenses', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const presets = bim.lens.presets();
    expect(Array.isArray(presets)).toBe(true);
  });

  it('create() returns a lens with generated id', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const lens = bim.lens.create({
      name: 'Test Lens',
      rules: [],
    });
    expect(lens.id).toBeDefined();
    expect(lens.name).toBe('Test Lens');
  });
});

describe('SpatialNamespace', () => {
  it('queryBounds() calls spatial.queryBounds', () => {
    const { backend, spatial } = createMockBackend();
    spatial.queryBounds.mockReturnValue([
      { modelId: 'm', expressId: 1 },
      { modelId: 'm', expressId: 2 },
    ]);

    const bim = createBimContext({ backend });
    const refs = bim.spatial.queryBounds('m', {
      min: [0, 0, 0],
      max: [10, 10, 10],
    });

    expect(refs).toHaveLength(2);
    expect(spatial.queryBounds).toHaveBeenCalledWith('m', {
      min: [0, 0, 0],
      max: [10, 10, 10],
    });
  });

  it('raycast() calls spatial.raycast', () => {
    const { backend, spatial } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.spatial.raycast('m', [0, 0, 0], [1, 0, 0]);
    expect(spatial.raycast).toHaveBeenCalledWith('m', [0, 0, 0], [1, 0, 0]);
  });

  it('queryRadius() converts to AABB and calls spatial.queryBounds', () => {
    const { backend, spatial } = createMockBackend();
    const bim = createBimContext({ backend });

    bim.spatial.queryRadius('m', [5, 5, 5], 2);
    expect(spatial.queryBounds).toHaveBeenCalledWith('m', {
      min: [3, 3, 3],
      max: [7, 7, 7],
    });
  });
});

describe('IDSNamespace', () => {
  it('summarize() computes correct totals', () => {
    const { backend } = createMockBackend();
    const bim = createBimContext({ backend });

    const report = {
      specificationResults: [
        {
          entityResults: [
            { passed: true },
            { passed: true },
          ],
        },
        {
          entityResults: [
            { passed: true },
            { passed: false },
          ],
        },
      ],
    };

    const summary = bim.ids.summarize(report);
    expect(summary.totalSpecifications).toBe(2);
    expect(summary.passedSpecifications).toBe(1);
    expect(summary.failedSpecifications).toBe(1);
    expect(summary.totalEntities).toBe(4);
    expect(summary.passedEntities).toBe(3);
    expect(summary.failedEntities).toBe(1);
  });
});

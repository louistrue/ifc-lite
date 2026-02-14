/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from 'vitest';
import { BimContext, createBimContext } from './context.js';
import type { BimBackend } from './types.js';

/** Create a mock dispatch-based BimBackend */
function createMockBackend(): BimBackend & { dispatchSpy: ReturnType<typeof vi.fn> } {
  const dispatchFn = vi.fn((namespace: string, method: string, _args: unknown[]) => {
    const key = `${namespace}.${method}`;
    switch (key) {
      case 'model.list': return [];
      case 'model.activeId': return null;
      case 'query.entities': return [];
      case 'query.entityData': return null;
      case 'query.properties': return [];
      case 'query.quantities': return [];
      case 'query.related': return [];
      case 'selection.get': return [];
      case 'viewer.getCamera': return { mode: 'perspective', position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] };
      case 'viewer.getSection': return null;
      case 'mutate.undo': return false;
      case 'mutate.redo': return false;
      case 'spatial.queryBounds': return [];
      case 'spatial.raycast': return [];
      case 'spatial.queryFrustum': return [];
      default: return undefined;
    }
  });

  return {
    dispatch: dispatchFn,
    subscribe: vi.fn(() => () => {}),
    dispatchSpy: dispatchFn,
  };
}

describe('BimContext', () => {
  it('creates a context with a backend', () => {
    const backend = createMockBackend();
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
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    const builder = bim.query();
    expect(builder).toBeDefined();
    expect(typeof builder.byType).toBe('function');
    expect(typeof builder.toArray).toBe('function');
  });

  it('entity() returns null for unknown entity', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    const result = bim.entity({ modelId: 'test', expressId: 999 });
    expect(result).toBeNull();
  });

  it('on() delegates to events namespace', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    expect(typeof bim.on).toBe('function');
  });
});

describe('QueryBuilder', () => {
  it('chains methods and calls backend dispatch', () => {
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'query' && method === 'entities') {
        return [
          { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
        ];
      }
      return [];
    });

    const bim = createBimContext({ backend });
    const results = bim.query().byType('IfcWall').toArray();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Wall 1');
    expect(results[0].type).toBe('IfcWall');
    expect(backend.dispatchSpy).toHaveBeenCalledWith('query', 'entities', expect.anything());
  });

  it('count() returns number of matches', () => {
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'query' && method === 'entities') {
        return [
          { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
          { ref: { modelId: 'model-1', expressId: 2 }, globalId: 'def', name: 'Wall 2', type: 'IfcWall', description: '', objectType: '' },
        ];
      }
      return [];
    });

    const bim = createBimContext({ backend });
    const count = bim.query().byType('IfcWall').count();

    expect(count).toBe(2);
  });

  it('first() returns first match or null', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    const result = bim.query().first();
    expect(result).toBeNull();
  });

  it('refs() returns EntityRef array', () => {
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'query' && method === 'entities') {
        return [
          { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
        ];
      }
      return [];
    });

    const bim = createBimContext({ backend });
    const refs = bim.query().refs();

    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ modelId: 'model-1', expressId: 1 });
  });
});

describe('ExportNamespace', () => {
  it('csv() generates CSV string', () => {
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'query' && method === 'entityData') {
        return {
          ref: { modelId: 'model-1', expressId: 1 },
          globalId: 'abc',
          name: 'Wall 1',
          type: 'IfcWall',
          description: '',
          objectType: '',
        };
      }
      if (ns === 'query' && method === 'properties') return [];
      return undefined;
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
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'query' && method === 'entityData') {
        return {
          ref: { modelId: 'model-1', expressId: 1 },
          globalId: 'abc',
          name: 'Wall 1',
          type: 'IfcWall',
          description: '',
          objectType: '',
        };
      }
      return undefined;
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
  it('colorize() dispatches to viewer.colorize', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.colorize([{ modelId: 'm', expressId: 1 }], '#ff0000');
    expect(backend.dispatchSpy).toHaveBeenCalledWith('viewer', 'colorize', expect.anything());
  });

  it('hide() dispatches to visibility.hide', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.hide([{ modelId: 'm', expressId: 1 }]);
    expect(backend.dispatchSpy).toHaveBeenCalledWith('visibility', 'hide', expect.anything());
  });

  it('select() dispatches to selection.set', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.select([{ modelId: 'm', expressId: 1 }]);
    expect(backend.dispatchSpy).toHaveBeenCalledWith('selection', 'set', expect.anything());
  });
});

describe('MutateNamespace', () => {
  it('setProperty() dispatches to mutate.setProperty', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.setProperty({ modelId: 'm', expressId: 1 }, 'Pset', 'Prop', 'value');
    expect(backend.dispatchSpy).toHaveBeenCalledWith(
      'mutate', 'setProperty',
      [{ modelId: 'm', expressId: 1 }, 'Pset', 'Prop', 'value'],
    );
  });

  it('undo() dispatches to mutate.undo', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.undo('model-1');
    expect(backend.dispatchSpy).toHaveBeenCalledWith('mutate', 'undo', ['model-1']);
  });
});

describe('LensNamespace', () => {
  it('presets() returns built-in lenses', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    const presets = bim.lens.presets();
    expect(Array.isArray(presets)).toBe(true);
  });

  it('create() returns a lens with generated id', () => {
    const backend = createMockBackend();
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
  it('queryBounds() dispatches to spatial.queryBounds', () => {
    const backend = createMockBackend();
    backend.dispatchSpy.mockImplementation((ns: string, method: string) => {
      if (ns === 'spatial' && method === 'queryBounds') {
        return [
          { modelId: 'm', expressId: 1 },
          { modelId: 'm', expressId: 2 },
        ];
      }
      return [];
    });

    const bim = createBimContext({ backend });
    const refs = bim.spatial.queryBounds('m', {
      min: [0, 0, 0],
      max: [10, 10, 10],
    });

    expect(refs).toHaveLength(2);
    expect(backend.dispatchSpy).toHaveBeenCalledWith('spatial', 'queryBounds', ['m', {
      min: [0, 0, 0],
      max: [10, 10, 10],
    }]);
  });

  it('raycast() dispatches to spatial.raycast', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.spatial.raycast('m', [0, 0, 0], [1, 0, 0]);
    expect(backend.dispatchSpy).toHaveBeenCalledWith('spatial', 'raycast', ['m', [0, 0, 0], [1, 0, 0]]);
  });

  it('queryRadius() converts to AABB and dispatches', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.spatial.queryRadius('m', [5, 5, 5], 2);
    expect(backend.dispatchSpy).toHaveBeenCalledWith('spatial', 'queryBounds', ['m', {
      min: [3, 3, 3],
      max: [7, 7, 7],
    }]);
  });
});

describe('IDSNamespace', () => {
  it('summarize() computes correct totals', () => {
    const backend = createMockBackend();
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

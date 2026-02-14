/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from 'vitest';
import { BimContext, createBimContext } from './context.js';
import type { BimBackend } from './types.js';

function createMockBackend(): BimBackend {
  return {
    // Model
    getModels: vi.fn(() => []),
    getActiveModelId: vi.fn(() => null),
    // Query
    queryEntities: vi.fn(() => []),
    getEntityData: vi.fn(() => null),
    getEntityProperties: vi.fn(() => []),
    getEntityQuantities: vi.fn(() => []),
    getEntityRelated: vi.fn(() => []),
    // Selection
    getSelection: vi.fn(() => []),
    setSelection: vi.fn(),
    // Visibility
    hideEntities: vi.fn(),
    showEntities: vi.fn(),
    isolateEntities: vi.fn(),
    resetVisibility: vi.fn(),
    // Viewer
    colorize: vi.fn(),
    resetColors: vi.fn(),
    flyTo: vi.fn(),
    setCamera: vi.fn(),
    getCamera: vi.fn(() => ({ mode: 'perspective', position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] })),
    setSection: vi.fn(),
    getSection: vi.fn(() => null),
    // Mutation
    setProperty: vi.fn(),
    deleteProperty: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    // Events
    subscribe: vi.fn(() => () => {}),
  } as unknown as BimBackend;
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
  });

  it('throws without backend or transport', () => {
    expect(() => createBimContext({} as any)).toThrow('BimContext requires either a backend or transport');
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
  it('chains methods and calls backend', () => {
    const backend = createMockBackend();
    (backend.queryEntities as ReturnType<typeof vi.fn>).mockReturnValue([
      { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
    ]);

    const bim = createBimContext({ backend });
    const results = bim.query().byType('IfcWall').toArray();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Wall 1');
    expect(results[0].type).toBe('IfcWall');
  });

  it('count() returns number of matches', () => {
    const backend = createMockBackend();
    (backend.queryEntities as ReturnType<typeof vi.fn>).mockReturnValue([
      { ref: { modelId: 'model-1', expressId: 1 }, globalId: 'abc', name: 'Wall 1', type: 'IfcWall', description: '', objectType: '' },
      { ref: { modelId: 'model-1', expressId: 2 }, globalId: 'def', name: 'Wall 2', type: 'IfcWall', description: '', objectType: '' },
    ]);

    const bim = createBimContext({ backend });
    const count = bim.query().byType('IfcWall').count();

    expect(count).toBe(2);
  });

  it('first() returns first match or null', () => {
    const backend = createMockBackend();
    (backend.queryEntities as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const bim = createBimContext({ backend });
    const result = bim.query().first();

    expect(result).toBeNull();
  });

  it('refs() returns EntityRef array', () => {
    const backend = createMockBackend();
    (backend.queryEntities as ReturnType<typeof vi.fn>).mockReturnValue([
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
    const backend = createMockBackend();
    (backend.getEntityData as ReturnType<typeof vi.fn>).mockReturnValue({
      ref: { modelId: 'model-1', expressId: 1 },
      globalId: 'abc',
      name: 'Wall 1',
      type: 'IfcWall',
      description: '',
      objectType: '',
    });
    (backend.getEntityProperties as ReturnType<typeof vi.fn>).mockReturnValue([]);

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
    (backend.getEntityData as ReturnType<typeof vi.fn>).mockReturnValue({
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
  it('colorize() calls backend', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.colorize([{ modelId: 'm', expressId: 1 }], '#ff0000');
    expect(backend.colorize).toHaveBeenCalled();
  });

  it('hide() calls backend', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.hide([{ modelId: 'm', expressId: 1 }]);
    expect(backend.hideEntities).toHaveBeenCalled();
  });

  it('select() calls backend', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.viewer.select([{ modelId: 'm', expressId: 1 }]);
    expect(backend.setSelection).toHaveBeenCalled();
  });
});

describe('MutateNamespace', () => {
  it('setProperty() calls backend', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.setProperty({ modelId: 'm', expressId: 1 }, 'Pset', 'Prop', 'value');
    expect(backend.setProperty).toHaveBeenCalledWith(
      { modelId: 'm', expressId: 1 },
      'Pset',
      'Prop',
      'value',
    );
  });

  it('undo() calls backend with modelId', () => {
    const backend = createMockBackend();
    const bim = createBimContext({ backend });

    bim.mutate.undo('model-1');
    expect(backend.undo).toHaveBeenCalledWith('model-1');
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

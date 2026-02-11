/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { evaluateLens } from './engine.js';
import { GHOST_COLOR, hexToRgba } from './colors.js';
import type { Lens, LensDataProvider } from './types.js';

/** Simple mock provider from entity list */
function createMockProvider(entities: Array<{
  id: number;
  type: string;
}>): LensDataProvider {
  const entityMap = new Map(entities.map(e => [e.id, e]));

  return {
    getEntityCount: () => entities.length,
    forEachEntity: (cb) => {
      for (const e of entities) cb(e.id, 'model-1');
    },
    getEntityType: (id) => entityMap.get(id)?.type,
    getPropertyValue: () => undefined,
    getPropertySets: () => [],
  };
}

describe('evaluateLens', () => {
  it('should return empty results for lens with no enabled rules', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Disabled', enabled: false, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    expect(result.colorMap.size).toBe(0);
    expect(result.hiddenIds.size).toBe(0);
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should colorize matching entities and ghost non-matches', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.colorMap.get(1)).toEqual(hexToRgba('#FF0000', 1));
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
    expect(result.ruleCounts.get('r1')).toBe(1);
  });

  it('should hide entities with hide action', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Hide Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'hide', color: '#000000' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcSlab' },
      { id: 2, type: 'IfcWall' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.hiddenIds.has(1)).toBe(true);
    expect(result.hiddenIds.has(2)).toBe(false);
    expect(result.colorMap.has(1)).toBe(false); // Hidden, not colored
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
  });

  it('should apply transparent action with alpha 0.3', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Transparent Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'transparent', color: '#00FF00' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    const color = result.colorMap.get(1);
    expect(color).toBeDefined();
    expect(color![3]).toBeCloseTo(0.3);
  });

  it('should match first rule only (short-circuit)', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls Red', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
        { id: 'r2', name: 'Walls Blue', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#0000FF' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    // First rule (red) should win
    expect(result.colorMap.get(1)).toEqual(hexToRgba('#FF0000', 1));
    expect(result.ruleCounts.get('r1')).toBe(1);
    expect(result.ruleCounts.get('r2')).toBe(0);
  });

  it('should count matches per rule correctly', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r-wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
        { id: 'r-slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#0000FF' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
      { id: 4, type: 'IfcDoor' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.ruleCounts.get('r-wall')).toBe(2);
    expect(result.ruleCounts.get('r-slab')).toBe(1);
    // Door is ghosted
    expect(result.colorMap.get(4)).toEqual(GHOST_COLOR);
  });

  it('should return execution time', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    expect(typeof result.executionTime).toBe('number');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });
});

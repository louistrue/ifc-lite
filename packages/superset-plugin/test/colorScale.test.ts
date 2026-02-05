import { describe, it, expect } from 'vitest';
import {
  buildSequentialColorMap,
  buildCategoricalColorMap,
  parseHexToNormalized,
} from '../src/utils/colorScale.js';

describe('buildSequentialColorMap', () => {
  it('returns empty map for empty input', () => {
    const result = buildSequentialColorMap(new Map(), 'reds');
    expect(result.size).toBe(0);
  });

  it('maps min value to first palette color and max to last', () => {
    const metrics = new Map<string, number>([
      ['entity_a', 0],
      ['entity_b', 100],
    ]);

    const result = buildSequentialColorMap(metrics, 'reds');

    expect(result.size).toBe(2);
    const colorA = result.get('entity_a')!;
    const colorB = result.get('entity_b')!;

    // Both should be valid RGBA tuples
    expect(colorA).toHaveLength(4);
    expect(colorB).toHaveLength(4);
    expect(colorA[3]).toBe(255);
    expect(colorB[3]).toBe(255);

    // Colors should differ (min vs max)
    expect(colorA).not.toEqual(colorB);
  });

  it('handles single value (no range)', () => {
    const metrics = new Map<string, number>([['only', 42]]);
    const result = buildSequentialColorMap(metrics, 'blues');

    expect(result.size).toBe(1);
    const color = result.get('only')!;
    expect(color).toHaveLength(4);
  });

  it('falls back to superset_seq_1 for unknown scheme', () => {
    const metrics = new Map<string, number>([
      ['a', 0],
      ['b', 1],
    ]);
    const result = buildSequentialColorMap(metrics, 'nonexistent_scheme');

    expect(result.size).toBe(2);
  });
});

describe('buildCategoricalColorMap', () => {
  it('returns empty map for empty input', () => {
    const result = buildCategoricalColorMap(new Map());
    expect(result.size).toBe(0);
  });

  it('assigns same color to same category', () => {
    const categories = new Map<string, string>([
      ['entity1', 'IfcWall'],
      ['entity2', 'IfcSlab'],
      ['entity3', 'IfcWall'],
    ]);

    const result = buildCategoricalColorMap(categories);

    expect(result.size).toBe(3);
    expect(result.get('entity1')).toEqual(result.get('entity3'));
    expect(result.get('entity1')).not.toEqual(result.get('entity2'));
  });

  it('cycles palette for many categories', () => {
    const categories = new Map<string, string>();
    for (let i = 0; i < 20; i++) {
      categories.set(`entity_${i}`, `Category_${i}`);
    }

    const result = buildCategoricalColorMap(categories);

    expect(result.size).toBe(20);
    // All should be valid RGBA
    for (const [, color] of result) {
      expect(color).toHaveLength(4);
      expect(color[3]).toBe(255);
    }
  });
});

describe('parseHexToNormalized', () => {
  it('parses 6-digit hex', () => {
    const [r, g, b, a] = parseHexToNormalized('#ff0000');
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeCloseTo(0.0, 2);
    expect(b).toBeCloseTo(0.0, 2);
    expect(a).toBeCloseTo(1.0, 2);
  });

  it('parses 3-digit hex', () => {
    const [r, g, b, a] = parseHexToNormalized('#f00');
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeCloseTo(0.0, 2);
    expect(b).toBeCloseTo(0.0, 2);
    expect(a).toBeCloseTo(1.0, 2);
  });

  it('parses 8-digit hex with alpha', () => {
    const [r, g, b, a] = parseHexToNormalized('#ff000080');
    expect(r).toBeCloseTo(1.0, 2);
    expect(a).toBeCloseTo(0.5, 1);
  });

  it('handles no-hash prefix', () => {
    const [r, g, b] = parseHexToNormalized('00ff00');
    expect(r).toBeCloseTo(0.0, 2);
    expect(g).toBeCloseTo(1.0, 2);
    expect(b).toBeCloseTo(0.0, 2);
  });

  it('returns default gray for invalid hex', () => {
    const [r, g, b, a] = parseHexToNormalized('invalid');
    // Should return defaults (0.96) rather than NaN
    expect(isNaN(r)).toBe(false);
    expect(a).toBeCloseTo(1.0, 2);
  });
});

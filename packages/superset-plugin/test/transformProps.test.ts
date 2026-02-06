import { describe, it, expect } from 'vitest';
import transformProps from '../src/transformProps.js';
import type { ChartProps } from '../src/vendor/superset-types.js';

function makeChartProps(overrides: Partial<ChartProps> = {}): ChartProps {
  return {
    width: 800,
    height: 600,
    formData: {},
    queriesData: [{ data: [] }],
    hooks: {},
    filterState: {},
    datasource: {},
    ...overrides,
  };
}

describe('transformProps', () => {
  it('returns default props when no config is set', () => {
    const result = transformProps(makeChartProps());

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.modelUrl).toBe('');
    expect(result.entityColorMap.size).toBe(0);
    expect(result.entityMetricMap.size).toBe(0);
    expect(result.enablePicking).toBe(true);
    expect(result.sectionPlaneEnabled).toBe(false);
    expect(result.filteredEntityIds).toBeNull();
  });

  it('resolves static model URL', () => {
    const result = transformProps(
      makeChartProps({
        formData: { static_model_url: 'https://example.com/model.ifc' },
      }),
    );

    expect(result.modelUrl).toBe('https://example.com/model.ifc');
  });

  it('resolves model URL from column (overrides static URL)', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          static_model_url: 'https://example.com/static.ifc',
          model_url_column: 'url',
        },
        queriesData: [
          {
            data: [
              { url: 'https://example.com/dynamic.ifc', entity_id: '1' },
            ],
          },
        ],
      }),
    );

    expect(result.modelUrl).toBe('https://example.com/dynamic.ifc');
  });

  it('builds entity metric map from query data', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          entity_id_column: 'global_id',
          color_metric: 'cost',
        },
        queriesData: [
          {
            data: [
              { global_id: 'abc123', cost: 1000 },
              { global_id: 'def456', cost: 2000 },
              { global_id: 'ghi789', cost: 3000 },
            ],
          },
        ],
      }),
    );

    expect(result.entityMetricMap.size).toBe(3);
    expect(result.entityMetricMap.get('abc123')).toBe(1000);
    expect(result.entityMetricMap.get('def456')).toBe(2000);
    expect(result.entityMetricMap.get('ghi789')).toBe(3000);
  });

  it('builds color map from metric values', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          entity_id_column: 'id',
          color_metric: 'value',
          color_scheme: 'reds',
        },
        queriesData: [
          {
            data: [
              { id: '1', value: 0 },
              { id: '2', value: 50 },
              { id: '3', value: 100 },
            ],
          },
        ],
      }),
    );

    expect(result.entityColorMap.size).toBe(3);
    // Each entry should be an RGBA tuple
    const color1 = result.entityColorMap.get('1')!;
    const color3 = result.entityColorMap.get('3')!;
    expect(color1).toHaveLength(4);
    expect(color3).toHaveLength(4);
    // Min value should get first palette color, max should get last
    expect(color1).not.toEqual(color3);
  });

  it('builds categorical color map when color_by_category is true', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          entity_id_column: 'id',
          color_by_category: true,
          category_column: 'type',
        },
        queriesData: [
          {
            data: [
              { id: '1', type: 'IfcWall' },
              { id: '2', type: 'IfcSlab' },
              { id: '3', type: 'IfcWall' },
            ],
          },
        ],
      }),
    );

    expect(result.entityCategoryMap.size).toBe(3);
    expect(result.entityColorMap.size).toBe(3);
    // Entities with same category should get same color
    const color1 = result.entityColorMap.get('1')!;
    const color3 = result.entityColorMap.get('3')!;
    expect(color1).toEqual(color3);
  });

  it('parses hex background color', () => {
    const result = transformProps(
      makeChartProps({
        formData: { background_color: '#ff0000' },
      }),
    );

    expect(result.backgroundColor[0]).toBeCloseTo(1.0, 1); // red
    expect(result.backgroundColor[1]).toBeCloseTo(0.0, 1); // green
    expect(result.backgroundColor[2]).toBeCloseTo(0.0, 1); // blue
    expect(result.backgroundColor[3]).toBeCloseTo(1.0, 1); // alpha
  });

  it('handles incoming cross-filter (single value)', () => {
    const result = transformProps(
      makeChartProps({
        filterState: { value: '42' },
      }),
    );

    expect(result.filteredEntityIds).toBeInstanceOf(Set);
    expect(result.filteredEntityIds!.has('42')).toBe(true);
    expect(result.filteredEntityIds!.size).toBe(1);
  });

  it('handles incoming cross-filter (array of values)', () => {
    const result = transformProps(
      makeChartProps({
        filterState: { value: ['10', '20', '30'] },
      }),
    );

    expect(result.filteredEntityIds).toBeInstanceOf(Set);
    expect(result.filteredEntityIds!.size).toBe(3);
    expect(result.filteredEntityIds!.has('10')).toBe(true);
  });

  it('passes setDataMask hook through', () => {
    const mockSetDataMask = () => {};
    const result = transformProps(
      makeChartProps({
        hooks: { setDataMask: mockSetDataMask },
      }),
    );

    expect(result.setDataMask).toBe(mockSetDataMask);
  });

  it('skips invalid metric values (NaN)', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          entity_id_column: 'id',
          color_metric: 'value',
        },
        queriesData: [
          {
            data: [
              { id: '1', value: 100 },
              { id: '2', value: 'not-a-number' },
              { id: '3', value: undefined },
            ],
          },
        ],
      }),
    );

    // 'not-a-number' → NaN → filtered out, undefined → NaN → filtered out
    expect(result.entityMetricMap.size).toBe(1);
    expect(result.entityMetricMap.get('1')).toBe(100);
  });
});

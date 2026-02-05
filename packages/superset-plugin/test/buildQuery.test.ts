import { describe, it, expect } from 'vitest';
import buildQuery from '../src/buildQuery.js';

describe('buildQuery', () => {
  it('returns a valid query context with minimal config', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
    });

    expect(result).toHaveProperty('datasource');
    expect(result).toHaveProperty('queries');
    expect(result.queries).toHaveLength(1);
  });

  it('includes entity_id_column in columns and groupby', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entity_id_column: 'global_id',
    });

    const query = result.queries[0];
    expect(query.columns).toContain('global_id');
    expect(query.groupby).toContain('global_id');
  });

  it('includes model_url_column in columns', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      model_url_column: 'model_url',
    });

    const query = result.queries[0];
    expect(query.columns).toContain('model_url');
  });

  it('includes color_metric in metrics', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entity_id_column: 'global_id',
      color_metric: 'total_cost',
    });

    const query = result.queries[0];
    expect(query.metrics).toContain('total_cost');
  });

  it('excludes color_metric when color_by_category is true', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entity_id_column: 'global_id',
      color_metric: 'total_cost',
      color_by_category: true,
      category_column: 'element_type',
    });

    const query = result.queries[0];
    expect(query.metrics).not.toContain('total_cost');
    expect(query.columns).toContain('element_type');
    expect(query.groupby).toContain('element_type');
  });

  it('sets default row_limit to 50000', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
    });

    const query = result.queries[0];
    expect(query.row_limit).toBe(50_000);
  });

  it('respects custom row_limit', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      row_limit: 1000,
    });

    const query = result.queries[0];
    expect(query.row_limit).toBe(1000);
  });

  it('includes orderby when color_metric is set', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      color_metric: 'cost',
    });

    const query = result.queries[0];
    expect(query.orderby).toHaveLength(1);
    expect(query.orderby![0][0]).toBe('cost');
    expect(query.orderby![0][1]).toBe(false); // descending
  });
});

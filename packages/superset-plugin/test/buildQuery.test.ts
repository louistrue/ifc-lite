/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

  it('includes entityIdColumn in columns and groupby', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entityIdColumn: 'global_id',
    });

    const query = result.queries[0];
    expect(query.columns).toContain('global_id');
    expect(query.groupby).toContain('global_id');
  });

  it('includes modelUrlColumn in columns', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      modelUrlColumn: 'model_url',
    });

    const query = result.queries[0];
    expect(query.columns).toContain('model_url');
  });

  it('includes colorMetric in metrics', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entityIdColumn: 'global_id',
      colorMetric: 'total_cost',
    });

    const query = result.queries[0];
    expect(query.metrics).toContain('total_cost');
  });

  it('excludes colorMetric when colorByCategory is true', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entityIdColumn: 'global_id',
      colorMetric: 'total_cost',
      colorByCategory: true,
      categoryColumn: 'element_type',
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
      entityIdColumn: 'global_id',
    });

    const query = result.queries[0];
    expect(query.row_limit).toBe(50_000);
  });

  it('respects custom row_limit', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entityIdColumn: 'global_id',
      row_limit: 1000,
    });

    const query = result.queries[0];
    expect(query.row_limit).toBe(1000);
  });

  it('includes orderby when colorMetric is set', () => {
    const result = buildQuery({
      datasource: '1__table',
      viz_type: 'ifc_viewer',
      entityIdColumn: 'global_id',
      colorMetric: 'cost',
    });

    const query = result.queries[0];
    expect(query.orderby).toHaveLength(1);
    expect(query.orderby![0][0]).toBe('cost');
    expect(query.orderby![0][1]).toBe(false); // descending
  });
});

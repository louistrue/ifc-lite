/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests for Dashboard Presets
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DASHBOARD_PRESETS, getPresetById, createDashboardFromPreset } from './presets.js';
import type { DashboardPreset } from './types.js';

// ============================================================================
// DASHBOARD_PRESETS Tests
// ============================================================================

describe('DASHBOARD_PRESETS', () => {
  it('should have all required presets', () => {
    const presetIds = DASHBOARD_PRESETS.map((p) => p.id);

    expect(presetIds).toContain('quantity-takeoff');
    expect(presetIds).toContain('spatial-analysis');
    expect(presetIds).toContain('material-breakdown');
    expect(presetIds).toContain('element-overview');
  });

  it('should have valid structure for all presets', () => {
    for (const preset of DASHBOARD_PRESETS) {
      expect(preset.id).toBeDefined();
      expect(typeof preset.id).toBe('string');
      expect(preset.id.length).toBeGreaterThan(0);

      expect(preset.name).toBeDefined();
      expect(typeof preset.name).toBe('string');
      expect(preset.name.length).toBeGreaterThan(0);

      expect(preset.description).toBeDefined();
      expect(typeof preset.description).toBe('string');

      expect(preset.icon).toBeDefined();
      expect(typeof preset.icon).toBe('string');

      expect(preset.charts).toBeDefined();
      expect(Array.isArray(preset.charts)).toBe(true);
      expect(preset.charts.length).toBeGreaterThan(0);
    }
  });

  it('should have valid chart configurations in all presets', () => {
    for (const preset of DASHBOARD_PRESETS) {
      for (const chart of preset.charts) {
        // Chart type
        expect(chart.type).toBeDefined();
        expect([
          'pie',
          'donut',
          'bar',
          'barHorizontal',
          'stackedBar',
          'treemap',
          'sunburst',
          'scatter',
          'histogram',
        ]).toContain(chart.type);

        // Title
        expect(chart.title).toBeDefined();
        expect(typeof chart.title).toBe('string');
        expect(chart.title.length).toBeGreaterThan(0);

        // Aggregation
        expect(chart.aggregation).toBeDefined();
        expect(chart.aggregation.groupBy).toBeDefined();
        expect([
          'ifcType',
          'storey',
          'building',
          'site',
          'material',
          'classification',
          'property',
        ]).toContain(chart.aggregation.groupBy);
        expect(chart.aggregation.metric).toBeDefined();
        expect(['count', 'sum', 'avg', 'min', 'max']).toContain(chart.aggregation.metric);

        // Layout
        expect(chart.layout).toBeDefined();
        expect(typeof chart.layout.x).toBe('number');
        expect(typeof chart.layout.y).toBe('number');
        expect(typeof chart.layout.w).toBe('number');
        expect(typeof chart.layout.h).toBe('number');
        expect(chart.layout.x).toBeGreaterThanOrEqual(0);
        expect(chart.layout.y).toBeGreaterThanOrEqual(0);
        expect(chart.layout.w).toBeGreaterThan(0);
        expect(chart.layout.h).toBeGreaterThan(0);

        // Layout grid constraints (12-column grid)
        expect(chart.layout.x + chart.layout.w).toBeLessThanOrEqual(12);
      }
    }
  });

  describe('quantity-takeoff preset', () => {
    let preset: DashboardPreset;

    beforeEach(() => {
      preset = DASHBOARD_PRESETS.find((p) => p.id === 'quantity-takeoff')!;
    });

    it('should have 4 charts', () => {
      expect(preset.charts).toHaveLength(4);
    });

    it('should include pie chart for elements by type', () => {
      const chart = preset.charts.find((c) => c.title === 'Elements by Type');
      expect(chart).toBeDefined();
      expect(chart?.type).toBe('pie');
      expect(chart?.aggregation.groupBy).toBe('ifcType');
      expect(chart?.aggregation.metric).toBe('count');
    });

    it('should include area and volume aggregations', () => {
      const areaChart = preset.charts.find((c) => c.title === 'Area by Type');
      expect(areaChart?.aggregation.quantityField).toBe('area');

      const volumeChart = preset.charts.find((c) => c.title === 'Volume by Storey');
      expect(volumeChart?.aggregation.quantityField).toBe('volume');
    });
  });

  describe('spatial-analysis preset', () => {
    let preset: DashboardPreset;

    beforeEach(() => {
      preset = DASHBOARD_PRESETS.find((p) => p.id === 'spatial-analysis')!;
    });

    it('should have 4 charts', () => {
      expect(preset.charts).toHaveLength(4);
    });

    it('should include sunburst chart for spatial hierarchy', () => {
      const chart = preset.charts.find((c) => c.type === 'sunburst');
      expect(chart).toBeDefined();
      expect(chart?.title).toBe('Spatial Hierarchy');
    });

    it('should focus on storey and building groupings', () => {
      const groupByDimensions = preset.charts.map((c) => c.aggregation.groupBy);
      expect(groupByDimensions).toContain('storey');
      expect(groupByDimensions).toContain('building');
    });
  });

  describe('material-breakdown preset', () => {
    let preset: DashboardPreset;

    beforeEach(() => {
      preset = DASHBOARD_PRESETS.find((p) => p.id === 'material-breakdown')!;
    });

    it('should have 4 charts', () => {
      expect(preset.charts).toHaveLength(4);
    });

    it('should focus on material groupings', () => {
      const materialCharts = preset.charts.filter((c) => c.aggregation.groupBy === 'material');
      expect(materialCharts.length).toBeGreaterThanOrEqual(2);
    });

    it('should include volume by material chart', () => {
      const chart = preset.charts.find((c) => c.title === 'Volume by Material');
      expect(chart).toBeDefined();
      expect(chart?.aggregation.quantityField).toBe('volume');
    });
  });

  describe('element-overview preset', () => {
    let preset: DashboardPreset;

    beforeEach(() => {
      preset = DASHBOARD_PRESETS.find((p) => p.id === 'element-overview')!;
    });

    it('should have 2 charts (minimal)', () => {
      expect(preset.charts).toHaveLength(2);
    });

    it('should only use count metric', () => {
      const allCount = preset.charts.every((c) => c.aggregation.metric === 'count');
      expect(allCount).toBe(true);
    });

    it('should use ifcType and storey groupings', () => {
      const groupByDimensions = preset.charts.map((c) => c.aggregation.groupBy);
      expect(groupByDimensions).toContain('ifcType');
      expect(groupByDimensions).toContain('storey');
    });
  });
});

// ============================================================================
// getPresetById Tests
// ============================================================================

describe('getPresetById', () => {
  it('should return preset for valid id', () => {
    const preset = getPresetById('quantity-takeoff');

    expect(preset).toBeDefined();
    expect(preset?.id).toBe('quantity-takeoff');
    expect(preset?.name).toBe('Quantity Takeoff');
  });

  it('should return undefined for invalid id', () => {
    const preset = getPresetById('non-existent-preset');

    expect(preset).toBeUndefined();
  });

  it('should return correct preset for each known id', () => {
    expect(getPresetById('quantity-takeoff')?.name).toBe('Quantity Takeoff');
    expect(getPresetById('spatial-analysis')?.name).toBe('Spatial Analysis');
    expect(getPresetById('material-breakdown')?.name).toBe('Material Breakdown');
    expect(getPresetById('element-overview')?.name).toBe('Element Overview');
  });
});

// ============================================================================
// createDashboardFromPreset Tests
// ============================================================================

describe('createDashboardFromPreset', () => {
  let preset: DashboardPreset;

  beforeEach(() => {
    preset = getPresetById('quantity-takeoff')!;

    // Mock crypto.randomUUID for consistent testing
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  it('should create dashboard with unique id', () => {
    const dashboard = createDashboardFromPreset(preset);

    expect(dashboard.id).toBeDefined();
    expect(typeof dashboard.id).toBe('string');
    expect(dashboard.id.length).toBeGreaterThan(0);
  });

  it('should copy name from preset', () => {
    const dashboard = createDashboardFromPreset(preset);

    expect(dashboard.name).toBe(preset.name);
  });

  it('should generate unique ids for each chart', () => {
    const dashboard = createDashboardFromPreset(preset);

    const chartIds = dashboard.charts.map((c) => c.id);
    const uniqueIds = new Set(chartIds);

    expect(uniqueIds.size).toBe(chartIds.length);
  });

  it('should copy all chart properties', () => {
    const dashboard = createDashboardFromPreset(preset);

    expect(dashboard.charts).toHaveLength(preset.charts.length);

    for (let i = 0; i < preset.charts.length; i++) {
      const presetChart = preset.charts[i];
      const dashboardChart = dashboard.charts[i];

      expect(dashboardChart.type).toBe(presetChart.type);
      expect(dashboardChart.title).toBe(presetChart.title);
      expect(dashboardChart.aggregation).toEqual(presetChart.aggregation);
      expect(dashboardChart.layout).toEqual(presetChart.layout);

      if (presetChart.options) {
        expect(dashboardChart.options).toEqual(presetChart.options);
      }
    }
  });

  it('should set timestamps', () => {
    const beforeTime = Date.now();
    const dashboard = createDashboardFromPreset(preset);
    const afterTime = Date.now();

    expect(dashboard.createdAt).toBeGreaterThanOrEqual(beforeTime);
    expect(dashboard.createdAt).toBeLessThanOrEqual(afterTime);
    expect(dashboard.modifiedAt).toBe(dashboard.createdAt);
  });

  it('should create independent dashboards each time', () => {
    const dashboard1 = createDashboardFromPreset(preset);
    const dashboard2 = createDashboardFromPreset(preset);

    expect(dashboard1.id).not.toBe(dashboard2.id);
    expect(dashboard1.charts[0].id).not.toBe(dashboard2.charts[0].id);
  });
});

// ============================================================================
// Chart Layout Validation Tests
// ============================================================================

describe('Chart Layout Validation', () => {
  it('should not have overlapping charts in any preset', () => {
    for (const preset of DASHBOARD_PRESETS) {
      // Group charts by row (y position)
      const rows = new Map<number, typeof preset.charts>();

      for (const chart of preset.charts) {
        // Check all rows this chart spans
        for (let y = chart.layout.y; y < chart.layout.y + chart.layout.h; y++) {
          if (!rows.has(y)) {
            rows.set(y, []);
          }
          rows.get(y)!.push(chart);
        }
      }

      // For each row, check for horizontal overlaps
      for (const [, chartsInRow] of rows) {
        // Create array of x ranges
        const ranges = chartsInRow.map((c) => ({
          start: c.layout.x,
          end: c.layout.x + c.layout.w,
          title: c.title,
        }));

        // Sort by start position
        ranges.sort((a, b) => a.start - b.start);

        // Check for overlaps
        for (let i = 1; i < ranges.length; i++) {
          expect(
            ranges[i].start,
            `Overlap detected in preset "${preset.id}" between "${ranges[i - 1].title}" and "${ranges[i].title}"`
          ).toBeGreaterThanOrEqual(ranges[i - 1].end);
        }
      }
    }
  });

  it('should have charts within grid bounds (12 columns)', () => {
    for (const preset of DASHBOARD_PRESETS) {
      for (const chart of preset.charts) {
        expect(
          chart.layout.x + chart.layout.w,
          `Chart "${chart.title}" in preset "${preset.id}" exceeds grid width`
        ).toBeLessThanOrEqual(12);
      }
    }
  });

  it('should have reasonable minimum dimensions', () => {
    for (const preset of DASHBOARD_PRESETS) {
      for (const chart of preset.charts) {
        // Default minW is 2, minH is 2
        const minW = chart.layout.minW ?? 2;
        const minH = chart.layout.minH ?? 2;

        expect(
          chart.layout.w,
          `Chart "${chart.title}" width less than minW`
        ).toBeGreaterThanOrEqual(minW);

        expect(
          chart.layout.h,
          `Chart "${chart.title}" height less than minH`
        ).toBeGreaterThanOrEqual(minH);
      }
    }
  });
});

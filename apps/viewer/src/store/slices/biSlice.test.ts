/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests for BISlice
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createBISlice, type BISlice } from './biSlice.js';
import type { DashboardConfig, AggregatedDataPoint } from '@ifc-lite/bi';
import type { EntityRef } from '../types.js';

describe('BISlice', () => {
  let state: BISlice;
  let setState: (partial: Partial<BISlice> | ((state: BISlice) => Partial<BISlice>)) => void;

  beforeEach(() => {
    setState = (partial) => {
      if (typeof partial === 'function') {
        const updates = partial(state);
        state = { ...state, ...updates };
      } else {
        state = { ...state, ...partial };
      }
    };

    state = createBISlice(setState, () => state, {} as never);
  });

  describe('initial state', () => {
    it('should have dashboard closed', () => {
      assert.strictEqual(state.isDashboardOpen, false);
    });

    it('should have no active dashboard', () => {
      assert.strictEqual(state.activeDashboard, null);
    });

    it('should have empty chart filters', () => {
      assert.strictEqual(state.chartFilters.size, 0);
    });

    it('should have cross-filtering enabled', () => {
      assert.strictEqual(state.crossFilterEnabled, true);
    });

    it('should have empty hovered entities', () => {
      assert.strictEqual(state.chartHoveredEntities.length, 0);
    });

    it('should have edit mode off', () => {
      assert.strictEqual(state.isEditMode, false);
    });

    it('should have empty chart data cache', () => {
      assert.strictEqual(state.chartDataCache.size, 0);
    });
  });

  describe('dashboard visibility', () => {
    it('toggleDashboard should toggle visibility', () => {
      assert.strictEqual(state.isDashboardOpen, false);

      state.toggleDashboard();
      assert.strictEqual(state.isDashboardOpen, true);

      state.toggleDashboard();
      assert.strictEqual(state.isDashboardOpen, false);
    });

    it('openDashboard should open dashboard', () => {
      assert.strictEqual(state.isDashboardOpen, false);

      state.openDashboard();
      assert.strictEqual(state.isDashboardOpen, true);
    });

    it('closeDashboard should close dashboard', () => {
      state.openDashboard();
      assert.strictEqual(state.isDashboardOpen, true);

      state.closeDashboard();
      assert.strictEqual(state.isDashboardOpen, false);
    });
  });

  describe('loadPreset', () => {
    it('should load a valid preset', () => {
      state.loadPreset('quantity-takeoff');

      assert.strictEqual(state.isDashboardOpen, true);
      assert.notStrictEqual(state.activeDashboard, null);
      assert.strictEqual(state.activeDashboard!.name, 'Quantity Takeoff');
      assert.strictEqual(state.activeDashboard!.charts.length, 4);
    });

    it('should generate unique chart ids', () => {
      state.loadPreset('quantity-takeoff');

      const chartIds = state.activeDashboard!.charts.map((c) => c.id);
      const uniqueIds = new Set(chartIds);

      assert.strictEqual(uniqueIds.size, chartIds.length);
    });

    it('should clear previous filters', () => {
      // Set some filter first
      state.chartFilters = new Map([['old-chart', new Set(['value'])]]);

      state.loadPreset('quantity-takeoff');

      assert.strictEqual(state.chartFilters.size, 0);
    });

    it('should disable edit mode', () => {
      state.isEditMode = true;

      state.loadPreset('quantity-takeoff');

      assert.strictEqual(state.isEditMode, false);
    });

    it('should do nothing for invalid preset', () => {
      state.loadPreset('non-existent-preset');

      assert.strictEqual(state.activeDashboard, null);
      assert.strictEqual(state.isDashboardOpen, false);
    });
  });

  describe('setActiveDashboard', () => {
    it('should set custom dashboard', () => {
      const dashboard: DashboardConfig = {
        id: 'custom-1',
        name: 'Custom Dashboard',
        charts: [],
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };

      state.setActiveDashboard(dashboard);

      assert.deepStrictEqual(state.activeDashboard, dashboard);
    });

    it('should clear filters when setting dashboard', () => {
      state.chartFilters = new Map([['chart-1', new Set(['value'])]]);

      state.setActiveDashboard({
        id: 'custom-1',
        name: 'Custom',
        charts: [],
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      });

      assert.strictEqual(state.chartFilters.size, 0);
    });

    it('should allow setting null to clear dashboard', () => {
      state.loadPreset('quantity-takeoff');
      assert.notStrictEqual(state.activeDashboard, null);

      state.setActiveDashboard(null);
      assert.strictEqual(state.activeDashboard, null);
    });
  });

  describe('toggleEditMode', () => {
    it('should toggle edit mode', () => {
      assert.strictEqual(state.isEditMode, false);

      state.toggleEditMode();
      assert.strictEqual(state.isEditMode, true);

      state.toggleEditMode();
      assert.strictEqual(state.isEditMode, false);
    });
  });

  describe('chart management', () => {
    beforeEach(() => {
      state.loadPreset('element-overview');
    });

    it('addChart should add new chart to dashboard', () => {
      const initialCount = state.activeDashboard!.charts.length;

      state.addChart({
        type: 'pie',
        title: 'New Chart',
        aggregation: { groupBy: 'ifcType', metric: 'count' },
        layout: { x: 0, y: 10, w: 4, h: 3 },
      });

      assert.strictEqual(state.activeDashboard!.charts.length, initialCount + 1);

      const newChart = state.activeDashboard!.charts[state.activeDashboard!.charts.length - 1];
      assert.strictEqual(newChart.title, 'New Chart');
      assert.notStrictEqual(newChart.id, undefined);
    });

    it('addChart should do nothing without active dashboard', () => {
      state.setActiveDashboard(null);

      state.addChart({
        type: 'pie',
        title: 'New Chart',
        aggregation: { groupBy: 'ifcType', metric: 'count' },
        layout: { x: 0, y: 10, w: 4, h: 3 },
      });

      assert.strictEqual(state.activeDashboard, null);
    });

    it('addChart should update modifiedAt timestamp', () => {
      const oldModifiedAt = state.activeDashboard!.modifiedAt;

      // Wait a tiny bit to ensure time changes
      const start = Date.now();
      while (Date.now() === start) {
        // Wait
      }

      state.addChart({
        type: 'bar',
        title: 'New Chart',
        aggregation: { groupBy: 'storey', metric: 'count' },
        layout: { x: 0, y: 10, w: 4, h: 3 },
      });

      assert.ok(state.activeDashboard!.modifiedAt >= oldModifiedAt);
    });

    it('removeChart should remove chart by id', () => {
      const chartToRemove = state.activeDashboard!.charts[0];
      const initialCount = state.activeDashboard!.charts.length;

      state.removeChart(chartToRemove.id);

      assert.strictEqual(state.activeDashboard!.charts.length, initialCount - 1);
      assert.ok(!state.activeDashboard!.charts.some((c) => c.id === chartToRemove.id));
    });

    it('removeChart should clear filter for removed chart', () => {
      const chartId = state.activeDashboard!.charts[0].id;
      state.setChartFilter(chartId, new Set(['value1', 'value2']));

      assert.ok(state.chartFilters.has(chartId));

      state.removeChart(chartId);

      assert.ok(!state.chartFilters.has(chartId));
    });

    it('removeChart should clear cache for removed chart', () => {
      const chartId = state.activeDashboard!.charts[0].id;
      state.cacheChartData(chartId, [
        { key: 'IfcWall', label: 'Wall', value: 5, entityRefs: [] },
      ]);

      assert.ok(state.chartDataCache.has(chartId));

      state.removeChart(chartId);

      assert.ok(!state.chartDataCache.has(chartId));
    });

    it('updateChart should update chart properties', () => {
      const chartId = state.activeDashboard!.charts[0].id;
      const originalTitle = state.activeDashboard!.charts[0].title;

      state.updateChart(chartId, { title: 'Updated Title' });

      const updatedChart = state.activeDashboard!.charts.find((c) => c.id === chartId);
      assert.strictEqual(updatedChart!.title, 'Updated Title');
      assert.notStrictEqual(updatedChart!.title, originalTitle);
    });

    it('updateChartLayout should update chart layout', () => {
      const chartId = state.activeDashboard!.charts[0].id;
      const newLayout = { x: 2, y: 3, w: 5, h: 4 };

      state.updateChartLayout(chartId, newLayout);

      const updatedChart = state.activeDashboard!.charts.find((c) => c.id === chartId);
      assert.deepStrictEqual(updatedChart!.layout, newLayout);
    });
  });

  describe('cross-filtering', () => {
    it('setChartFilter should set filter for chart', () => {
      const keys = new Set(['IfcWall', 'IfcDoor']);

      state.setChartFilter('chart-1', keys);

      assert.ok(state.chartFilters.has('chart-1'));
      assert.deepStrictEqual(state.chartFilters.get('chart-1'), keys);
    });

    it('setChartFilter should remove filter when empty set', () => {
      state.setChartFilter('chart-1', new Set(['value']));
      assert.ok(state.chartFilters.has('chart-1'));

      state.setChartFilter('chart-1', new Set());
      assert.ok(!state.chartFilters.has('chart-1'));
    });

    it('clearChartFilter should clear specific chart filter', () => {
      state.setChartFilter('chart-1', new Set(['value1']));
      state.setChartFilter('chart-2', new Set(['value2']));

      state.clearChartFilter('chart-1');

      assert.ok(!state.chartFilters.has('chart-1'));
      assert.ok(state.chartFilters.has('chart-2'));
    });

    it('clearAllFilters should clear all filters', () => {
      state.setChartFilter('chart-1', new Set(['value1']));
      state.setChartFilter('chart-2', new Set(['value2']));

      state.clearAllFilters();

      assert.strictEqual(state.chartFilters.size, 0);
    });

    it('toggleCrossFilter should toggle cross-filtering', () => {
      assert.strictEqual(state.crossFilterEnabled, true);

      state.toggleCrossFilter();
      assert.strictEqual(state.crossFilterEnabled, false);

      state.toggleCrossFilter();
      assert.strictEqual(state.crossFilterEnabled, true);
    });
  });

  describe('hover', () => {
    it('setChartHover should set hovered entities', () => {
      const entities: EntityRef[] = [
        { modelId: 'model-1', expressId: 1 },
        { modelId: 'model-1', expressId: 2 },
      ];

      state.setChartHover(entities);

      assert.deepStrictEqual(state.chartHoveredEntities, entities);
    });

    it('clearChartHover should clear hovered entities', () => {
      state.setChartHover([
        { modelId: 'model-1', expressId: 1 },
      ]);

      state.clearChartHover();

      assert.strictEqual(state.chartHoveredEntities.length, 0);
    });
  });

  describe('data cache', () => {
    it('cacheChartData should cache entity refs by key', () => {
      const data: AggregatedDataPoint[] = [
        {
          key: 'IfcWall',
          label: 'Wall',
          value: 3,
          entityRefs: [
            { modelId: 'model-1', expressId: 1 },
            { modelId: 'model-1', expressId: 2 },
            { modelId: 'model-1', expressId: 3 },
          ],
        },
        {
          key: 'IfcDoor',
          label: 'Door',
          value: 1,
          entityRefs: [{ modelId: 'model-1', expressId: 4 }],
        },
      ];

      state.cacheChartData('chart-1', data);

      assert.ok(state.chartDataCache.has('chart-1'));
      assert.strictEqual(state.chartDataCache.get('chart-1')!.size, 2);
    });

    it('getCachedEntityRefs should return cached entities', () => {
      const entityRefs: EntityRef[] = [
        { modelId: 'model-1', expressId: 1 },
        { modelId: 'model-1', expressId: 2 },
      ];

      state.cacheChartData('chart-1', [
        { key: 'IfcWall', label: 'Wall', value: 2, entityRefs },
      ]);

      const result = state.getCachedEntityRefs('chart-1', 'IfcWall');

      assert.deepStrictEqual(result, entityRefs);
    });

    it('getCachedEntityRefs should return undefined for unknown chart', () => {
      const result = state.getCachedEntityRefs('unknown-chart', 'IfcWall');

      assert.strictEqual(result, undefined);
    });

    it('getCachedEntityRefs should return undefined for unknown key', () => {
      state.cacheChartData('chart-1', [
        { key: 'IfcWall', label: 'Wall', value: 2, entityRefs: [] },
      ]);

      const result = state.getCachedEntityRefs('chart-1', 'IfcDoor');

      assert.strictEqual(result, undefined);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full workflow: load preset, filter, hover, clear', () => {
      // Load preset
      state.loadPreset('quantity-takeoff');
      assert.strictEqual(state.isDashboardOpen, true);
      assert.strictEqual(state.activeDashboard!.charts.length, 4);

      // Cache some data
      const chartId = state.activeDashboard!.charts[0].id;
      state.cacheChartData(chartId, [
        {
          key: 'IfcWall',
          label: 'Wall',
          value: 10,
          entityRefs: [{ modelId: 'model-1', expressId: 1 }],
        },
      ]);

      // Set filter
      state.setChartFilter(chartId, new Set(['IfcWall']));
      assert.ok(state.chartFilters.has(chartId));

      // Set hover
      state.setChartHover([{ modelId: 'model-1', expressId: 1 }]);
      assert.strictEqual(state.chartHoveredEntities.length, 1);

      // Clear hover
      state.clearChartHover();
      assert.strictEqual(state.chartHoveredEntities.length, 0);

      // Clear filter
      state.clearChartFilter(chartId);
      assert.ok(!state.chartFilters.has(chartId));

      // Close dashboard
      state.closeDashboard();
      assert.strictEqual(state.isDashboardOpen, false);
    });

    it('should preserve dashboard state across toggle', () => {
      state.loadPreset('quantity-takeoff');
      const chartId = state.activeDashboard!.charts[0].id;
      state.setChartFilter(chartId, new Set(['IfcWall']));

      state.closeDashboard();
      state.openDashboard();

      // Dashboard and filters should persist
      assert.notStrictEqual(state.activeDashboard, null);
      assert.ok(state.chartFilters.has(chartId));
    });
  });
});

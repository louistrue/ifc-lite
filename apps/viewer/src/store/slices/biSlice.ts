/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BI Dashboard state slice
 *
 * Manages the state for the Business Intelligence dashboard,
 * including chart configurations, cross-filtering, and bidirectional
 * sync with 3D selection/visibility.
 */

import type { StateCreator } from 'zustand';
import type {
  ChartConfig,
  DashboardConfig,
  AggregatedDataPoint,
  ChartInteractionEvent,
} from '@ifc-lite/bi';
import { DASHBOARD_PRESETS, createDashboardFromPreset } from '@ifc-lite/bi';
import type { EntityRef } from '../types.js';

/** Dashboard display mode */
export type DashboardMode = 'fullscreen' | 'sidebar' | 'minimized';

export interface BISlice {
  // ============================================================================
  // State
  // ============================================================================

  /** Is the dashboard panel open? */
  isDashboardOpen: boolean;

  /** Dashboard display mode */
  dashboardMode: DashboardMode;

  /** Sidebar width in pixels (when dashboardMode is 'sidebar') */
  sidebarWidth: number;

  /** Active dashboard configuration */
  activeDashboard: DashboardConfig | null;

  /** Cross-filter state: chartId -> selected keys */
  chartFilters: Map<string, Set<string>>;

  /** Enable cross-filtering between charts */
  crossFilterEnabled: boolean;

  /** Highlighted entities from chart hover (not full selection) */
  chartHoveredEntities: EntityRef[];

  /** Is edit mode active (drag/resize charts) */
  isEditMode: boolean;

  /** Hide "none" values (No Material, No Storey, etc.) from charts */
  hideNoneValues: boolean;

  /** Stored entity refs by chart data point key for quick lookup */
  chartDataCache: Map<string, Map<string, EntityRef[]>>;

  // ============================================================================
  // Actions - Dashboard
  // ============================================================================

  /** Toggle dashboard visibility */
  toggleDashboard: () => void;
  openDashboard: () => void;
  closeDashboard: () => void;

  /** Load a preset dashboard */
  loadPreset: (presetId: string) => void;

  /** Set a custom dashboard */
  setActiveDashboard: (dashboard: DashboardConfig | null) => void;

  /** Toggle edit mode */
  toggleEditMode: () => void;

  /** Set dashboard display mode */
  setDashboardMode: (mode: DashboardMode) => void;

  /** Set sidebar width */
  setSidebarWidth: (width: number) => void;

  /** Toggle hide none values */
  toggleHideNoneValues: () => void;

  // ============================================================================
  // Actions - Charts
  // ============================================================================

  /** Add a chart to the dashboard */
  addChart: (config: Omit<ChartConfig, 'id'>) => void;

  /** Remove a chart */
  removeChart: (chartId: string) => void;

  /** Update chart configuration */
  updateChart: (chartId: string, updates: Partial<ChartConfig>) => void;

  /** Update chart layout (from drag/resize) */
  updateChartLayout: (chartId: string, layout: ChartConfig['layout']) => void;

  // ============================================================================
  // Actions - Cross-Filtering
  // ============================================================================

  /** Set filter on a chart (for cross-filtering) */
  setChartFilter: (chartId: string, keys: Set<string>) => void;

  /** Clear filter on a specific chart */
  clearChartFilter: (chartId: string) => void;

  /** Clear all chart filters */
  clearAllFilters: () => void;

  /** Toggle cross-filtering */
  toggleCrossFilter: () => void;

  // ============================================================================
  // Actions - Hover
  // ============================================================================

  /** Set hover highlight from chart */
  setChartHover: (entities: EntityRef[]) => void;

  /** Clear hover highlight */
  clearChartHover: () => void;

  // ============================================================================
  // Actions - Data Cache (for bidirectional sync)
  // ============================================================================

  /** Cache entity refs for a chart's data points */
  cacheChartData: (chartId: string, data: AggregatedDataPoint[]) => void;

  /** Get cached entity refs for a chart data point */
  getCachedEntityRefs: (chartId: string, key: string) => EntityRef[] | undefined;
}

export const createBISlice: StateCreator<BISlice, [], [], BISlice> = (set, get) => ({
  // Initial state
  isDashboardOpen: false,
  dashboardMode: 'fullscreen' as DashboardMode,
  sidebarWidth: 400, // Default sidebar width in pixels
  activeDashboard: null,
  chartFilters: new Map(),
  crossFilterEnabled: true,
  chartHoveredEntities: [],
  isEditMode: false,
  hideNoneValues: false,
  chartDataCache: new Map(),

  // Dashboard actions
  toggleDashboard: () =>
    set((state) => ({ isDashboardOpen: !state.isDashboardOpen })),

  openDashboard: () => set({ isDashboardOpen: true }),

  closeDashboard: () => set({ isDashboardOpen: false }),

  loadPreset: (presetId) => {
    const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const dashboard = createDashboardFromPreset(preset) as DashboardConfig;

    set({
      activeDashboard: dashboard,
      isDashboardOpen: true,
      chartFilters: new Map(),
      isEditMode: false,
    });
  },

  setActiveDashboard: (dashboard) =>
    set({
      activeDashboard: dashboard,
      chartFilters: new Map(),
    }),

  toggleEditMode: () => set((state) => ({ isEditMode: !state.isEditMode })),

  setDashboardMode: (mode) => set({ dashboardMode: mode }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleHideNoneValues: () =>
    set((state) => ({ hideNoneValues: !state.hideNoneValues })),

  // Chart actions
  addChart: (config) => {
    const state = get();
    if (!state.activeDashboard) return;

    const newChart: ChartConfig = {
      ...config,
      id: crypto.randomUUID(),
    };

    set({
      activeDashboard: {
        ...state.activeDashboard,
        charts: [...state.activeDashboard.charts, newChart],
        modifiedAt: Date.now(),
      },
    });
  },

  removeChart: (chartId) => {
    const state = get();
    if (!state.activeDashboard) return;

    // Also clear filter for this chart
    const newFilters = new Map(state.chartFilters);
    newFilters.delete(chartId);

    // Clear cache for this chart
    const newCache = new Map(state.chartDataCache);
    newCache.delete(chartId);

    set({
      activeDashboard: {
        ...state.activeDashboard,
        charts: state.activeDashboard.charts.filter((c) => c.id !== chartId),
        modifiedAt: Date.now(),
      },
      chartFilters: newFilters,
      chartDataCache: newCache,
    });
  },

  updateChart: (chartId, updates) => {
    const state = get();
    if (!state.activeDashboard) return;

    set({
      activeDashboard: {
        ...state.activeDashboard,
        charts: state.activeDashboard.charts.map((c) =>
          c.id === chartId ? { ...c, ...updates } : c
        ),
        modifiedAt: Date.now(),
      },
    });
  },

  updateChartLayout: (chartId, layout) => {
    const state = get();
    if (!state.activeDashboard) return;

    set({
      activeDashboard: {
        ...state.activeDashboard,
        charts: state.activeDashboard.charts.map((c) =>
          c.id === chartId ? { ...c, layout } : c
        ),
        modifiedAt: Date.now(),
      },
    });
  },

  // Cross-filtering actions
  setChartFilter: (chartId, keys) => {
    const state = get();
    const newFilters = new Map(state.chartFilters);
    if (keys.size === 0) {
      newFilters.delete(chartId);
    } else {
      newFilters.set(chartId, keys);
    }
    set({ chartFilters: newFilters });
  },

  clearChartFilter: (chartId) => {
    const state = get();
    const newFilters = new Map(state.chartFilters);
    newFilters.delete(chartId);
    set({ chartFilters: newFilters });
  },

  clearAllFilters: () => set({ chartFilters: new Map() }),

  toggleCrossFilter: () =>
    set((state) => ({ crossFilterEnabled: !state.crossFilterEnabled })),

  // Hover actions
  setChartHover: (entities) => set({ chartHoveredEntities: entities }),

  clearChartHover: () => set({ chartHoveredEntities: [] }),

  // Data cache actions
  cacheChartData: (chartId, data) => {
    const state = get();
    const newCache = new Map(state.chartDataCache);
    const chartCache = new Map<string, EntityRef[]>();

    for (const point of data) {
      chartCache.set(point.key, point.entityRefs);
    }

    newCache.set(chartId, chartCache);
    set({ chartDataCache: newCache });
  },

  getCachedEntityRefs: (chartId, key) => {
    const state = get();
    return state.chartDataCache.get(chartId)?.get(key);
  },
});

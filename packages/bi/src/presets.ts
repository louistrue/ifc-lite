/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pre-built dashboard templates for common use cases
 */

import type { DashboardPreset } from './types.js';

export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: 'quantity-takeoff',
    name: 'Quantity Takeoff',
    description: 'Element counts, areas, and volumes by type and storey',
    icon: 'Calculator',
    charts: [
      {
        type: 'pie',
        title: 'Elements by Type',
        aggregation: { groupBy: 'ifcType', metric: 'count' },
        layout: { x: 0, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
        options: { maxSlices: 10, showLabels: true },
      },
      {
        type: 'barHorizontal',
        title: 'Elements per Storey',
        aggregation: { groupBy: 'storey', metric: 'count' },
        layout: { x: 4, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
        options: { sortBy: 'value', sortOrder: 'desc' },
      },
      {
        type: 'bar',
        title: 'Volume by Storey',
        aggregation: {
          groupBy: 'storey',
          metric: 'sum',
          quantityField: 'volume',
        },
        layout: { x: 8, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
        options: { sortBy: 'key' },
      },
      {
        type: 'treemap',
        title: 'Area by Type',
        aggregation: { groupBy: 'ifcType', metric: 'sum', quantityField: 'area' },
        layout: { x: 0, y: 3, w: 12, h: 3, minW: 4, minH: 2 },
      },
    ],
  },

  {
    id: 'spatial-analysis',
    name: 'Spatial Analysis',
    description: 'Building structure and spatial distribution',
    icon: 'Building2',
    charts: [
      {
        type: 'sunburst',
        title: 'Spatial Hierarchy',
        aggregation: { groupBy: 'storey', metric: 'count' },
        layout: { x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
      },
      {
        type: 'bar',
        title: 'Floor Area by Storey',
        aggregation: { groupBy: 'storey', metric: 'sum', quantityField: 'area' },
        layout: { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
        options: { sortBy: 'key' },
      },
      {
        type: 'donut',
        title: 'Elements by Building',
        aggregation: { groupBy: 'building', metric: 'count' },
        layout: { x: 0, y: 4, w: 4, h: 3, minW: 2, minH: 2 },
      },
      {
        type: 'barHorizontal',
        title: 'Types per Storey',
        aggregation: { groupBy: 'ifcType', metric: 'count' },
        layout: { x: 4, y: 4, w: 8, h: 3, minW: 3, minH: 2 },
        options: { maxSlices: 8 },
      },
    ],
  },

  {
    id: 'material-breakdown',
    name: 'Material Breakdown',
    description: 'Material usage and distribution',
    icon: 'Layers',
    charts: [
      {
        type: 'donut',
        title: 'Elements by Material',
        aggregation: { groupBy: 'material', metric: 'count' },
        layout: { x: 0, y: 0, w: 4, h: 3, minW: 2, minH: 2 },
        options: { maxSlices: 8 },
      },
      {
        type: 'treemap',
        title: 'Volume by Material',
        aggregation: { groupBy: 'material', metric: 'sum', quantityField: 'volume' },
        layout: { x: 4, y: 0, w: 8, h: 3, minW: 3, minH: 2 },
      },
      {
        type: 'bar',
        title: 'Material Count by Type',
        aggregation: {
          groupBy: 'ifcType',
          metric: 'count',
        },
        layout: { x: 0, y: 3, w: 6, h: 3, minW: 3, minH: 2 },
      },
      {
        type: 'pie',
        title: 'Area by Material',
        aggregation: { groupBy: 'material', metric: 'sum', quantityField: 'area' },
        layout: { x: 6, y: 3, w: 6, h: 3, minW: 3, minH: 2 },
        options: { maxSlices: 6 },
      },
    ],
  },

  {
    id: 'element-overview',
    name: 'Element Overview',
    description: 'Quick overview of all model elements',
    icon: 'LayoutGrid',
    charts: [
      {
        type: 'pie',
        title: 'Elements by Type',
        aggregation: { groupBy: 'ifcType', metric: 'count' },
        layout: { x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
        options: { maxSlices: 12, showLegend: true },
      },
      {
        type: 'barHorizontal',
        title: 'Elements by Storey',
        aggregation: { groupBy: 'storey', metric: 'count' },
        layout: { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
        options: { sortBy: 'value', sortOrder: 'desc' },
      },
    ],
  },
];

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): DashboardPreset | undefined {
  return DASHBOARD_PRESETS.find((p) => p.id === id);
}

/**
 * Create a dashboard config from a preset
 */
export function createDashboardFromPreset(preset: DashboardPreset): {
  id: string;
  name: string;
  charts: Array<{
    id: string;
    type: string;
    title: string;
    aggregation: unknown;
    layout: unknown;
    options?: unknown;
  }>;
  createdAt: number;
  modifiedAt: number;
} {
  return {
    id: crypto.randomUUID(),
    name: preset.name,
    charts: preset.charts.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
    })),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  };
}

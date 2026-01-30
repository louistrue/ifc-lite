/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/bi - Business Intelligence dashboard for IFC-Lite
 *
 * Provides data aggregation and visualization capabilities for IFC model analysis.
 */

// Types
export type {
  EntityRef,
  GroupByDimension,
  AggregateMetric,
  QuantityField,
  DataFilter,
  AggregationConfig,
  AggregatedDataPoint,
  AggregationResult,
  ChartType,
  ChartLayout,
  ChartOptions,
  ChartConfig,
  DashboardConfig,
  DashboardPreset,
  ChartInteractionEvent,
} from './types.js';

export { COLOR_SCHEMES } from './types.js';

// Aggregator
export {
  BIDataAggregator,
  computeHighlightedKeys,
  applyFiltersToConfig,
} from './aggregator.js';

export type {
  BIModelData,
  PropertySet,
  QuantitySet,
  MaterialRef,
  ClassificationRef,
} from './aggregator.js';

// Presets
export { DASHBOARD_PRESETS, getPresetById, createDashboardFromPreset } from './presets.js';

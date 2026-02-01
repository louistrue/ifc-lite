/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for the BI Dashboard feature
 */

// ============================================================================
// Entity Reference (matches viewer store type)
// ============================================================================

export interface EntityRef {
  modelId: string;
  expressId: number;
}

// ============================================================================
// Aggregation Configuration
// ============================================================================

export type GroupByDimension =
  | 'ifcType' // IfcWall, IfcDoor, etc.
  | 'storey' // Building storey
  | 'building' // Building
  | 'site' // Site
  | 'material' // Associated material
  | 'classification' // Classification reference
  | 'property'; // Custom property path

export type AggregateMetric = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type QuantityField = 'area' | 'volume' | 'length' | 'weight' | 'count';

export interface DataFilter {
  dimension: GroupByDimension;
  values: string[]; // Include only these values
  exclude?: boolean; // If true, exclude these values instead
}

export interface AggregationConfig {
  /** Primary grouping dimension */
  groupBy: GroupByDimension;
  /** For property grouping: "Pset_WallCommon.IsExternal" */
  propertyPath?: string;
  /** Aggregation function */
  metric: AggregateMetric;
  /** Quantity field to aggregate (required for sum/avg/min/max) */
  quantityField?: QuantityField;
  /** Secondary grouping for stacked/grouped charts */
  groupBySecondary?: GroupByDimension;
  /** Filter before aggregation */
  preFilter?: DataFilter;
  /** Entity ID filter: Set of "modelId:expressId" strings - only aggregate these entities */
  entityFilter?: Set<string>;
}

// ============================================================================
// Aggregated Data Output
// ============================================================================

export interface AggregatedDataPoint {
  /** Group key (e.g., "IfcWall", "Level 1", "Concrete") */
  key: string;
  /** Display label (may differ from key for user-friendly names) */
  label: string;
  /** Aggregated metric value */
  value: number;
  /** All entities in this bucket (for selection sync) */
  entityRefs: EntityRef[];
  /** For hierarchical charts (sunburst, treemap with drill-down) */
  children?: AggregatedDataPoint[];
  /** Color hint (optional, chart can override) */
  color?: string;
  /** Secondary grouping data (for stacked charts) */
  secondary?: Map<string, number>;
}

export interface AggregationResult {
  data: AggregatedDataPoint[];
  /** Total entities processed */
  totalEntities: number;
  /** Total metric value (for percentage calculations) */
  totalValue: number;
  /** Cache key for invalidation */
  cacheKey: string;
  /** Computation time in ms (for perf monitoring) */
  computeTimeMs: number;
}

// ============================================================================
// Chart Configuration
// ============================================================================

export type ChartType =
  | 'pie'
  | 'donut'
  | 'bar'
  | 'barHorizontal'
  | 'stackedBar'
  | 'treemap'
  | 'sunburst'
  | 'scatter'
  | 'histogram';

export interface ChartLayout {
  x: number; // Grid column (0-11)
  y: number; // Grid row
  w: number; // Width in grid units (1-12)
  h: number; // Height in grid units
  minW?: number;
  minH?: number;
}

export interface ChartOptions {
  colorScheme?: 'default' | 'warm' | 'cool' | 'categorical';
  showLegend?: boolean;
  showLabels?: boolean;
  showValues?: boolean;
  sortBy?: 'value' | 'key' | 'none';
  sortOrder?: 'asc' | 'desc';
  maxSlices?: number; // For pie: group small slices into "Other"
}

export interface ChartConfig {
  /** Unique chart ID */
  id: string;
  /** Chart type */
  type: ChartType;
  /** Data aggregation configuration */
  aggregation: AggregationConfig;
  /** Chart title */
  title: string;
  /** Grid position (for react-grid-layout) */
  layout: ChartLayout;
  /** Visual options */
  options?: ChartOptions;
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

export interface DashboardConfig {
  /** Unique dashboard ID */
  id: string;
  /** Dashboard name */
  name: string;
  /** Chart configurations */
  charts: ChartConfig[];
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  modifiedAt: number;
}

export interface DashboardPreset {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  charts: Omit<ChartConfig, 'id'>[]; // IDs generated on use
}

// ============================================================================
// Interaction Events
// ============================================================================

export interface ChartInteractionEvent {
  type: 'select' | 'hover' | 'rightClick';
  chartId: string;
  dataPoint: AggregatedDataPoint | null;
  /** Modifier keys held during interaction */
  modifiers: {
    shift: boolean; // Add to selection
    ctrl: boolean; // Toggle selection
    alt: boolean; // Isolate (hide others)
  };
}

// ============================================================================
// Color Schemes
// ============================================================================

export const COLOR_SCHEMES: Record<string, string[]> = {
  default: [
    '#5470c6',
    '#91cc75',
    '#fac858',
    '#ee6666',
    '#73c0de',
    '#3ba272',
    '#fc8452',
    '#9a60b4',
    '#ea7ccc',
  ],
  warm: [
    '#ff6b6b',
    '#feca57',
    '#ff9ff3',
    '#ff9f43',
    '#ee5a24',
    '#f8b739',
    '#ff6348',
    '#eb3b5a',
  ],
  cool: [
    '#54a0ff',
    '#5f27cd',
    '#48dbfb',
    '#00d2d3',
    '#2e86de',
    '#341f97',
    '#0abde3',
    '#1dd1a1',
  ],
  categorical: [
    '#e41a1c',
    '#377eb8',
    '#4daf4a',
    '#984ea3',
    '#ff7f00',
    '#ffff33',
    '#a65628',
    '#f781bf',
  ],
};

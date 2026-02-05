/**
 * TypeScript interfaces for the IFC Viewer Superset plugin.
 */

import type { SetDataMaskHook } from './vendor/superset-types.js';

/* -------------------------------------------------------------------------- */
/*  Form Data – what the user configures in the chart editor                  */
/* -------------------------------------------------------------------------- */

/**
 * Form data interface using camelCase to match Superset's automatic
 * conversion of snake_case control names in the control panel.
 */
export interface IFCViewerFormData {
  /** Column containing IFC model file URLs (one per row or single value). */
  modelUrlColumn?: string;

  /** Static URL to an IFC file (used when no URL column is configured). */
  staticModelUrl?: string;

  /** Column containing IFC entity GlobalId or ExpressID values. */
  entityIdColumn?: string;

  /** Numeric metric to map to entity colors (e.g. cost, area, energy). */
  colorMetric?: string | { label?: string };

  /** Superset color scheme name for sequential or categorical coloring. */
  colorScheme?: string;

  /** Whether to color by a categorical column rather than a numeric metric. */
  colorByCategory?: boolean;

  /** Column to use for categorical coloring. */
  categoryColumn?: string;

  /** Background color for the 3D viewport. */
  backgroundColor?: { r: number; g: number; b: number; a: number } | string;

  /** Whether entity click triggers cross-filtering. */
  enablePicking?: boolean;

  /** Whether the section plane control is shown. */
  sectionPlaneEnabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Transformed Props – what the chart component receives                     */
/* -------------------------------------------------------------------------- */

export interface IFCViewerProps {
  /** Index signature for Superset ChartPropsLike compatibility. */
  [key: string]: unknown;
  /** Width in pixels, provided by Superset's responsive layout. */
  width: number;

  /** Height in pixels, provided by Superset's responsive layout. */
  height: number;

  /** Resolved URL to the IFC model file. */
  modelUrl: string;

  /**
   * Map from entity ID (GlobalId or ExpressID string) to RGBA color [0-255].
   * Built from query results + color scheme.
   */
  entityColorMap: Map<string, [number, number, number, number]>;

  /** Map from entity ID to raw metric value (for tooltips). */
  entityMetricMap: Map<string, number>;

  /** Map from entity ID to category string (for categorical coloring). */
  entityCategoryMap: Map<string, string>;

  /** Superset color scheme identifier. */
  colorScheme: string;

  /** Background color for the WebGPU viewport as normalized RGBA [0-1]. */
  backgroundColor: [number, number, number, number];

  /** Whether clicking entities triggers cross-filtering. */
  enablePicking: boolean;

  /** Whether the section plane UI is available. */
  sectionPlaneEnabled: boolean;

  /** Cross-filter callback: called when the user clicks an entity. */
  setDataMask?: SetDataMaskHook;

  /** Entity ID column name, needed for cross-filter construction. */
  entityIdColumn?: string;

  /**
   * Set of entity IDs from incoming cross-filters.
   * When non-null, only these entities are shown (isolation mode).
   */
  filteredEntityIds?: Set<string> | null;
}

/* -------------------------------------------------------------------------- */
/*  Hook Types                                                                */
/* -------------------------------------------------------------------------- */

export interface RendererState {
  isReady: boolean;
  error: string | null;
}

export interface LoaderState {
  loading: boolean;
  progress: number;
  totalMeshes: number;
  error: string | null;
}

export interface EntityColorEntry {
  entityId: string;
  rgba: [number, number, number, number];
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

export const PLUGIN_KEY = 'ifc_viewer';
export const PLUGIN_NAME = 'IFC 3D Viewer';

export const DEFAULT_BACKGROUND: [number, number, number, number] = [
  0.96, 0.96, 0.96, 1.0,
];

export const DEFAULT_FORM_DATA: Partial<IFCViewerFormData> = {
  enablePicking: true,
  sectionPlaneEnabled: false,
  colorScheme: 'superset_seq_1',
  backgroundColor: { r: 245, g: 245, b: 245, a: 1 },
  colorByCategory: false,
};

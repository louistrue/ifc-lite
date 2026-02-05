import type { ChartProps } from './vendor/superset-types.js';
import type { IFCViewerFormData, IFCViewerProps } from './types.js';
import { DEFAULT_BACKGROUND } from './types.js';
import {
  buildSequentialColorMap,
  buildCategoricalColorMap,
  parseHexToNormalized,
} from './utils/colorScale.js';

/**
 * Transform Superset query results into props for the IFC Viewer component.
 *
 * This function runs every time the chart receives new data (query refresh,
 * filter change, etc.). It must be fast — no heavy computation here.
 */
export default function transformProps(chartProps: ChartProps): IFCViewerProps {
  const { width, height, formData, queriesData, hooks, filterState } =
    chartProps;
  const fd = formData as ChartProps['formData'] & IFCViewerFormData;
  const data = queriesData[0]?.data ?? [];

  /* -------------------------------------------------------------------- */
  /*  Resolve model URL                                                    */
  /* -------------------------------------------------------------------- */

  let modelUrl = fd.static_model_url ?? '';
  if (fd.model_url_column && data.length > 0) {
    const urlFromData = data[0][fd.model_url_column];
    if (typeof urlFromData === 'string' && urlFromData.length > 0) {
      modelUrl = urlFromData;
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Build entity → metric map (for sequential coloring)                  */
  /* -------------------------------------------------------------------- */

  const entityMetricMap = new Map<string, number>();
  const metricKey = resolveMetricKey(fd.color_metric);

  if (fd.entity_id_column && metricKey && !fd.color_by_category) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const entityId = String(row[fd.entity_id_column] ?? '');
      const value = Number(row[metricKey]);
      if (entityId && !isNaN(value)) {
        entityMetricMap.set(entityId, value);
      }
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Build entity → category map (for categorical coloring)               */
  /* -------------------------------------------------------------------- */

  const entityCategoryMap = new Map<string, string>();
  if (
    fd.entity_id_column &&
    fd.color_by_category &&
    fd.category_column
  ) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const entityId = String(row[fd.entity_id_column] ?? '');
      const category = String(row[fd.category_column] ?? '');
      if (entityId && category) {
        entityCategoryMap.set(entityId, category);
      }
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Build color map                                                      */
  /* -------------------------------------------------------------------- */

  const colorScheme = fd.color_scheme ?? 'superset_seq_1';
  let entityColorMap: Map<string, [number, number, number, number]>;

  if (fd.color_by_category && entityCategoryMap.size > 0) {
    entityColorMap = buildCategoricalColorMap(entityCategoryMap);
  } else if (entityMetricMap.size > 0) {
    entityColorMap = buildSequentialColorMap(entityMetricMap, colorScheme);
  } else {
    entityColorMap = new Map();
  }

  /* -------------------------------------------------------------------- */
  /*  Background color                                                     */
  /* -------------------------------------------------------------------- */

  let backgroundColor: [number, number, number, number] = DEFAULT_BACKGROUND;
  // background_color may be a hex string (TextControl) or an RGBA object
  // (ColorPickerControl), depending on how the control panel is configured.
  const bgRaw: unknown = fd.background_color;
  if (typeof bgRaw === 'string' && bgRaw.startsWith('#')) {
    backgroundColor = parseHexToNormalized(bgRaw);
  } else if (
    bgRaw &&
    typeof bgRaw === 'object' &&
    'r' in bgRaw
  ) {
    const bg = bgRaw as { r: number; g: number; b: number; a?: number };
    backgroundColor = [
      bg.r / 255,
      bg.g / 255,
      bg.b / 255,
      bg.a ?? 1,
    ];
  }

  /* -------------------------------------------------------------------- */
  /*  Incoming cross-filter (from other charts filtering us)               */
  /* -------------------------------------------------------------------- */

  let filteredEntityIds: Set<string> | null = null;
  if (filterState?.value != null) {
    if (Array.isArray(filterState.value)) {
      filteredEntityIds = new Set(filterState.value.map(String));
    } else {
      filteredEntityIds = new Set([String(filterState.value)]);
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Return props                                                         */
  /* -------------------------------------------------------------------- */

  return {
    width,
    height,
    modelUrl,
    entityColorMap,
    entityMetricMap,
    entityCategoryMap,
    colorScheme,
    backgroundColor,
    enablePicking: fd.enable_picking ?? true,
    sectionPlaneEnabled: fd.section_plane_enabled ?? false,
    setDataMask: hooks?.setDataMask,
    entityIdColumn: fd.entity_id_column,
    filteredEntityIds,
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function resolveMetricKey(
  metric: string | { label?: string } | undefined,
): string {
  if (!metric) return '';
  if (typeof metric === 'string') return metric;
  return metric.label ?? '';
}

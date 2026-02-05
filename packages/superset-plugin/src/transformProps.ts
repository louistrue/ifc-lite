/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
  // Cast formData to our expected shape - Superset converts snake_case to camelCase
  const fd = formData as unknown as IFCViewerFormData;
  const data = (queriesData[0]?.data ?? []) as Array<Record<string, unknown>>;

  /* -------------------------------------------------------------------- */
  /*  Resolve model URL                                                    */
  /* -------------------------------------------------------------------- */

  // Note: Superset converts snake_case control names to camelCase in formData
  let modelUrl: string = fd.staticModelUrl ?? '';
  if (fd.modelUrlColumn && data.length > 0) {
    const urlFromData = data[0][fd.modelUrlColumn];
    if (typeof urlFromData === 'string' && urlFromData.length > 0) {
      modelUrl = urlFromData;
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Build entity → metric map (for sequential coloring)                  */
  /* -------------------------------------------------------------------- */

  const entityMetricMap = new Map<string, number>();
  const metricKey = resolveMetricKey(fd.colorMetric);

  if (fd.entityIdColumn && metricKey && !fd.colorByCategory) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const entityId = String(row[fd.entityIdColumn] ?? '');
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
    fd.entityIdColumn &&
    fd.colorByCategory &&
    fd.categoryColumn
  ) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const entityId = String(row[fd.entityIdColumn] ?? '');
      const category = String(row[fd.categoryColumn] ?? '');
      if (entityId && category) {
        entityCategoryMap.set(entityId, category);
      }
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Build color map                                                      */
  /* -------------------------------------------------------------------- */

  const colorScheme: string = fd.colorScheme ?? 'superset_seq_1';
  let entityColorMap: Map<string, [number, number, number, number]>;

  if (fd.colorByCategory && entityCategoryMap.size > 0) {
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
  const bgRaw: unknown = fd.backgroundColor;
  if (typeof bgRaw === 'string' && bgRaw.startsWith('#')) {
    backgroundColor = parseHexToNormalized(bgRaw);
  } else if (isRgbaInput(bgRaw)) {
    backgroundColor = [
      bgRaw.r / 255,
      bgRaw.g / 255,
      bgRaw.b / 255,
      bgRaw.a ?? 1,
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
    enablePicking: fd.enablePicking ?? true,
    sectionPlaneEnabled: fd.sectionPlaneEnabled ?? false,
    setDataMask: hooks?.setDataMask,
    entityIdColumn: fd.entityIdColumn as string | undefined,
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

function isRgbaInput(
  value: unknown,
): value is { r: number; g: number; b: number; a?: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'r' in value &&
    'g' in value &&
    'b' in value
  );
}

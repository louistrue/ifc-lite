import {
  buildQueryContext,
  type QueryFormData,
  type QueryObject,
} from './vendor/superset-types.js';
import type { IFCViewerFormData } from './types.js';

/**
 * Constructs the Superset SQL query for the IFC viewer.
 *
 * The query fetches:
 * - Entity IDs (GlobalId / ExpressID) to join with 3D entities
 * - A numeric metric for sequential coloring (optional)
 * - A categorical column for categorical coloring (optional)
 * - The model URL column (optional, if dynamic per-row)
 *
 * The query groups by entity ID so each row represents one entity
 * with its aggregated metric value.
 */
export default function buildQuery(
  formData: QueryFormData & IFCViewerFormData,
) {
  return buildQueryContext(formData, (baseQueryObject: QueryObject) => {
    const columns: string[] = [];
    const metrics: Array<string | { label?: string }> = [];
    const groupby: string[] = [];

    // Entity ID column is the primary join key
    if (formData.entity_id_column) {
      columns.push(formData.entity_id_column);
      groupby.push(formData.entity_id_column);
    }

    // Model URL column (if dynamic, we just need the first value)
    if (formData.model_url_column) {
      columns.push(formData.model_url_column);
    }

    // Color-by metric (numeric, aggregated per entity)
    if (formData.color_metric && !formData.color_by_category) {
      const metricValue =
        typeof formData.color_metric === 'object'
          ? formData.color_metric
          : formData.color_metric;
      metrics.push(metricValue);
    }

    // Category column for categorical coloring
    if (formData.color_by_category && formData.category_column) {
      columns.push(formData.category_column);
      if (!groupby.includes(formData.category_column)) {
        groupby.push(formData.category_column);
      }
    }

    // Order by metric descending for better color distribution visibility
    const colorMetricLabel =
      typeof formData.color_metric === 'object'
        ? formData.color_metric?.label ?? ''
        : formData.color_metric ?? '';

    const orderby: Array<[string | { label?: string }, boolean]> =
      colorMetricLabel && !formData.color_by_category
        ? [[formData.color_metric!, false]]
        : [];

    return [
      {
        ...baseQueryObject,
        columns,
        metrics,
        groupby,
        orderby,
        // No row limit by default — we need all entities mapped
        row_limit: typeof formData.row_limit === 'number'
          ? formData.row_limit
          : 50_000,
      },
    ];
  });
}

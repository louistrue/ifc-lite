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
    // Note: Superset converts snake_case control names to camelCase in formData
    if (formData.entityIdColumn) {
      columns.push(formData.entityIdColumn);
      groupby.push(formData.entityIdColumn);
    }

    // Model URL column (if dynamic, we just need the first value)
    if (formData.modelUrlColumn) {
      columns.push(formData.modelUrlColumn);
    }

    // Color-by metric (numeric, aggregated per entity)
    if (formData.colorMetric && !formData.colorByCategory) {
      const metricValue =
        typeof formData.colorMetric === 'object'
          ? formData.colorMetric
          : formData.colorMetric;
      metrics.push(metricValue);
    }

    // Category column for categorical coloring
    if (formData.colorByCategory && formData.categoryColumn) {
      columns.push(formData.categoryColumn);
      if (!groupby.includes(formData.categoryColumn)) {
        groupby.push(formData.categoryColumn);
      }
    }

    // If no columns or metrics are configured, the user just wants to display
    // the IFC model without any data overlay. We need at least one metric for
    // Superset to accept the query, so we use COUNT(1).
    // This allows "standalone" mode where only model_url is provided.
    if (columns.length === 0 && metrics.length === 0) {
      return [
        {
          ...baseQueryObject,
          columns: [],
          metrics: [
            {
              label: 'count',
              expressionType: 'SQL',
              sqlExpression: 'COUNT(1)',
            },
          ],
          orderby: [],
          row_limit: 1,
          is_timeseries: false,
        },
      ];
    }

    // Order by metric descending for better color distribution visibility
    const colorMetricLabel =
      typeof formData.colorMetric === 'object'
        ? formData.colorMetric?.label ?? ''
        : formData.colorMetric ?? '';

    const orderby: Array<[string | { label?: string }, boolean]> =
      colorMetricLabel && !formData.colorByCategory
        ? [[formData.colorMetric!, false]]
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

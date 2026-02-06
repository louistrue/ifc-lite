/**
 * Type declarations for @superset-ui/core and @superset-ui/chart-controls.
 *
 * These are vendored locally so the plugin can be type-checked without
 * installing Superset's full frontend. When consumed inside a real Superset
 * build, the actual @superset-ui/* types take precedence.
 */

/* -------------------------------------------------------------------------- */
/*  @superset-ui/core – Chart Plugin System                                   */
/* -------------------------------------------------------------------------- */

export interface ChartMetadataConfig {
  name: string;
  description?: string;
  thumbnail?: string;
  behaviors?: Behavior[];
  category?: string;
  credits?: string[];
  tags?: string[];
  canBeAnnotationTypes?: string[];
  useLegacyApi?: boolean;
}

export enum Behavior {
  InteractiveChart = 'INTERACTIVE_CHART',
  NativeFilter = 'NATIVE_FILTER',
  ChartCustomization = 'CHART_CUSTOMIZATION',
  DrillToDetail = 'DRILL_TO_DETAIL',
  DrillBy = 'DRILL_BY',
}

export class ChartMetadata {
  name: string;
  description: string;
  behaviors: Behavior[];
  thumbnail: string;

  constructor(config: ChartMetadataConfig) {
    this.name = config.name;
    this.description = config.description ?? '';
    this.behaviors = config.behaviors ?? [];
    this.thumbnail = config.thumbnail ?? '';
  }
}

export interface ChartPluginConfig<
  FormData extends QueryFormData = QueryFormData,
  Props extends ChartPropsLike = ChartPropsLike,
> {
  metadata: ChartMetadata;
  buildQuery?: BuildQueryFunction<FormData>;
  loadBuildQuery?: () => Promise<{ default: BuildQueryFunction<FormData> }>;
  controlPanel?: ControlPanelConfig;
  Chart?: React.ComponentType<Props>;
  loadChart?: () => Promise<{ default: React.ComponentType<Props> }>;
  transformProps?: TransformPropsFunction;
  loadTransformProps?: () => Promise<{ default: TransformPropsFunction }>;
}

export class ChartPlugin<
  FormData extends QueryFormData = QueryFormData,
  Props extends ChartPropsLike = ChartPropsLike,
> {
  metadata: ChartMetadata;

  constructor(config: ChartPluginConfig<FormData, Props>) {
    this.metadata = config.metadata;
  }

  configure(config: { key: string }): this {
    return this;
  }

  register(): this {
    return this;
  }

  unregister(): void {}
}

/* -------------------------------------------------------------------------- */
/*  @superset-ui/core – Query Types                                           */
/* -------------------------------------------------------------------------- */

export interface QueryFormData {
  datasource?: string;
  viz_type?: string;
  metrics?: QueryFormMetric[];
  columns?: string[];
  groupby?: string[];
  adhoc_filters?: AdhocFilter[];
  extra_filters?: QueryFormExtraFilter[];
  extra_form_data?: ExtraFormData;
  order_desc?: boolean;
  row_limit?: string | number | null;
  force?: boolean;
  [key: string]: unknown;
}

export type QueryFormMetric = string | {
  label?: string;
  expressionType?: string;
  column?: { column_name: string };
  aggregate?: string;
  sqlExpression?: string;
};

export interface AdhocFilter {
  expressionType: string;
  clause: string;
  subject?: string;
  operator?: string;
  comparator?: string | string[];
  sqlExpression?: string;
}

export interface QueryFormExtraFilter {
  col: string;
  op: string;
  val: string | string[] | number | number[] | boolean | null;
}

export interface ExtraFormData {
  filters?: QueryFormExtraFilter[];
  granularity_sqla?: string;
  time_range?: string;
  [key: string]: unknown;
}

export interface QueryObject {
  columns?: string[];
  metrics?: QueryFormMetric[];
  groupby?: string[];
  orderby?: Array<[QueryFormMetric, boolean]>;
  filters?: QueryFormExtraFilter[];
  extras?: Record<string, unknown>;
  row_limit?: number;
  row_offset?: number;
  post_processing?: Array<Record<string, unknown> | null>;
  [key: string]: unknown;
}

export interface DatasourceObject {
  id: number;
  type: string;
}

export interface QueryContext {
  datasource: DatasourceObject;
  force: boolean;
  queries: QueryObject[];
  form_data: QueryFormData;
  result_format: string;
  result_type: string;
}

export type BuildFinalQueryObjects = (
  baseQueryObject: QueryObject,
) => QueryObject[];

export type BuildQueryFunction<FormData extends QueryFormData = QueryFormData> =
  (formData: FormData) => QueryContext;

export function buildQueryContext(
  formData: QueryFormData,
  options?: BuildFinalQueryObjects | {
    buildQuery?: BuildFinalQueryObjects;
    queryFields?: Record<string, string>;
  },
): QueryContext {
  const buildQuery = typeof options === 'function'
    ? options
    : options?.buildQuery ?? ((q: QueryObject) => [q]);

  const baseQuery: QueryObject = {
    columns: formData.columns,
    metrics: formData.metrics,
    groupby: formData.groupby,
    orderby: undefined,
    row_limit: typeof formData.row_limit === 'number' ? formData.row_limit : undefined,
  };

  return {
    datasource: parseDatasource(formData.datasource ?? ''),
    force: formData.force ?? false,
    queries: buildQuery(baseQuery),
    form_data: formData,
    result_format: 'json',
    result_type: 'full',
  };
}

function parseDatasource(datasource: string): DatasourceObject {
  const [id, type] = datasource.split('__');
  return { id: Number(id) || 0, type: type ?? 'table' };
}

/* -------------------------------------------------------------------------- */
/*  @superset-ui/core – ChartProps                                            */
/* -------------------------------------------------------------------------- */

export interface ChartPropsLike {
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface FilterState {
  value?: unknown;
  customColumnLabel?: string;
  [key: string]: unknown;
}

export interface DataMask {
  extraFormData?: ExtraFormData;
  filterState?: FilterState;
  ownState?: Record<string, unknown>;
}

export type SetDataMaskHook = (dataMask: DataMask) => void;

export interface ChartPropsHooks {
  onAddFilter?: (...args: unknown[]) => void;
  onContextMenu?: (...args: unknown[]) => void;
  onError?: (...args: unknown[]) => void;
  setControlValue?: (...args: unknown[]) => void;
  setDataMask?: SetDataMaskHook;
  setTooltip?: (...args: unknown[]) => void;
}

export interface QueryData {
  data: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ChartProps {
  width: number;
  height: number;
  formData: QueryFormData & Record<string, unknown>;
  queriesData: QueryData[];
  hooks: ChartPropsHooks;
  filterState: FilterState;
  datasource: Record<string, unknown>;
  emitCrossFilters?: boolean;
  ownState?: Record<string, unknown>;
  theme?: Record<string, unknown>;
}

export type TransformPropsFunction = (chartProps: ChartProps) => ChartPropsLike;

/* -------------------------------------------------------------------------- */
/*  @superset-ui/chart-controls – Control Panel                               */
/* -------------------------------------------------------------------------- */

export interface ControlPanelConfig {
  controlPanelSections: (ControlPanelSectionConfig | null)[];
  controlOverrides?: Record<string, Partial<ControlConfig>>;
  sectionOverrides?: Record<string, Partial<ControlPanelSectionConfig>>;
  formDataOverrides?: (formData: QueryFormData) => QueryFormData;
}

export interface ControlPanelSectionConfig {
  label?: string;
  description?: string;
  expanded?: boolean;
  tabOverride?: string;
  controlSetRows: ControlSetRow[];
  visibility?: (props: Record<string, unknown>) => boolean;
}

export type ControlSetRow = Array<ControlSetItem | null>;
export type ControlSetItem = string | ControlSetItemConfig;

export interface ControlSetItemConfig {
  name: string;
  config: ControlConfig;
}

export interface ControlConfig {
  type: string;
  label?: string;
  description?: string;
  default?: unknown;
  multi?: boolean;
  freeForm?: boolean;
  choices?: Array<[string, string]>;
  validators?: Array<(value: unknown) => string | false>;
  mapStateToProps?: (
    state: ControlPanelState,
    control: ControlConfig,
    actions: Record<string, unknown>,
  ) => Record<string, unknown>;
  renderTrigger?: boolean;
  visibility?: (props: Record<string, unknown>) => boolean;
  [key: string]: unknown;
}

export interface ControlPanelState {
  datasource?: {
    columns?: Array<{ column_name: string; type?: string; verbose_name?: string }>;
    metrics?: Array<{ metric_name: string; verbose_name?: string }>;
    type?: string;
  };
  controls?: Record<string, { value: unknown }>;
}

/* -------------------------------------------------------------------------- */
/*  @superset-ui/core – Color Utilities                                       */
/* -------------------------------------------------------------------------- */

export interface SequentialScheme {
  id: string;
  label: string;
  colors: string[];
  isDiverging: boolean;
  getColors(numColors?: number, extent?: number[]): string[];
  createLinearScale(domain?: number[]): (value: number) => string;
}

export interface CategoricalColorScale {
  getColor(value: string): string;
}

export interface CategoricalColorNamespace {
  getScale(schemeName?: string): CategoricalColorScale;
  setColor(value: string, color: string): void;
}

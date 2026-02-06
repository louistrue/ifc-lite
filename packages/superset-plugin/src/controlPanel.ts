import type {
  ControlPanelConfig,
  ControlPanelState,
} from './vendor/superset-types.js';

/**
 * Control panel configuration for the IFC Viewer chart.
 *
 * Defines the UI that users interact with in Superset's chart editor
 * to configure model URLs, entity mapping, color schemes, and viewer options.
 */
const controlPanel: ControlPanelConfig = {
  controlPanelSections: [
    /* ------------------------------------------------------------------ */
    /*  IFC Model Source                                                   */
    /* ------------------------------------------------------------------ */
    {
      label: 'IFC Model',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'static_model_url',
            config: {
              type: 'TextControl',
              label: 'Model URL',
              description:
                'Direct URL to an IFC file. If a URL column is also ' +
                'selected, the column value takes precedence.',
              default: '',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'model_url_column',
            config: {
              type: 'SelectControl',
              label: 'Model URL Column',
              description:
                'Optional dataset column containing the IFC model URL. ' +
                'When set, the first row value is used as the model source.',
              default: null,
              freeForm: false,
              multi: false,
              renderTrigger: true,
              mapStateToProps: (state: ControlPanelState) => ({
                choices:
                  state.datasource?.columns?.map((c) => [
                    c.column_name,
                    c.verbose_name ?? c.column_name,
                  ]) ?? [],
              }),
            },
          },
        ],
      ],
    },

    /* ------------------------------------------------------------------ */
    /*  Entity Mapping                                                     */
    /* ------------------------------------------------------------------ */
    {
      label: 'Entity Mapping',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'entity_id_column',
            config: {
              type: 'SelectControl',
              label: 'Entity ID Column',
              description:
                'Column with IFC entity GlobalId or ExpressID values. ' +
                'Used to join query results to 3D entities.',
              default: null,
              freeForm: false,
              multi: false,
              mapStateToProps: (state: ControlPanelState) => ({
                choices:
                  state.datasource?.columns?.map((c) => [
                    c.column_name,
                    c.verbose_name ?? c.column_name,
                  ]) ?? [],
              }),
            },
          },
        ],
        [
          {
            name: 'color_metric',
            config: {
              type: 'SelectControl',
              label: 'Color By Metric',
              description:
                'Numeric metric to map to a sequential color scale ' +
                '(e.g. cost, area, energy rating). Leave empty to use ' +
                'the model\'s original colors.',
              default: null,
              freeForm: false,
              multi: false,
              mapStateToProps: (state: ControlPanelState) => ({
                choices:
                  state.datasource?.metrics?.map((m) => [
                    m.metric_name,
                    m.verbose_name ?? m.metric_name,
                  ]) ?? [],
              }),
            },
          },
        ],
        [
          {
            name: 'color_by_category',
            config: {
              type: 'CheckboxControl',
              label: 'Color By Category',
              description:
                'Color entities by a categorical column instead of a numeric metric.',
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'category_column',
            config: {
              type: 'SelectControl',
              label: 'Category Column',
              description:
                'Categorical column to color entities by (e.g. element type, status).',
              default: null,
              freeForm: false,
              multi: false,
              visibility: (props: Record<string, unknown>) => {
                const controls = props['controls'] as
                  | Record<string, { value: unknown }>
                  | undefined;
                return controls?.['color_by_category']?.value === true;
              },
              mapStateToProps: (state: ControlPanelState) => ({
                choices:
                  state.datasource?.columns?.map((c) => [
                    c.column_name,
                    c.verbose_name ?? c.column_name,
                  ]) ?? [],
              }),
            },
          },
        ],
        [
          {
            name: 'color_scheme',
            config: {
              type: 'SelectControl',
              label: 'Color Scheme',
              description: 'Color palette used for entity coloring.',
              default: 'superset_seq_1',
              freeForm: false,
              choices: [
                ['superset_seq_1', 'Superset Sequential 1'],
                ['superset_seq_2', 'Superset Sequential 2'],
                ['reds', 'Reds'],
                ['blues', 'Blues'],
                ['greens', 'Greens'],
                ['oranges', 'Oranges'],
                ['blue_white_yellow', 'Blue-White-Yellow (diverging)'],
                ['superset_default', 'Superset Default (categorical)'],
              ],
              renderTrigger: true,
            },
          },
        ],
      ],
    },

    /* ------------------------------------------------------------------ */
    /*  Viewer Options                                                     */
    /* ------------------------------------------------------------------ */
    {
      label: 'Viewer Options',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'background_color',
            config: {
              type: 'TextControl',
              label: 'Background Color',
              description:
                'Background color as a hex string (e.g. #f2f2f2). ' +
                'Defaults to light gray.',
              default: '#f2f2f2',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'enable_picking',
            config: {
              type: 'CheckboxControl',
              label: 'Enable Entity Selection',
              description:
                'Allow clicking 3D entities to trigger cross-filters on other charts.',
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'section_plane_enabled',
            config: {
              type: 'CheckboxControl',
              label: 'Enable Section Plane',
              description: 'Show a section plane control for cutting through the model.',
              default: false,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
  ],
};

export default controlPanel;

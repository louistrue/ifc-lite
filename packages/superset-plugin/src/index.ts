/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/superset-plugin-chart-ifc-viewer
 *
 * Apache Superset chart plugin that renders ifc-lite's WebGPU-accelerated
 * 3D viewer directly inside dashboards.
 *
 * ## Registration (in Superset's MainPreset.ts)
 *
 * ```typescript
 * import IfcViewerChartPlugin from '@ifc-lite/superset-plugin-chart-ifc-viewer';
 *
 * export default class MainPreset extends Preset {
 *   constructor() {
 *     super({
 *       plugins: [
 *         new IfcViewerChartPlugin().configure({ key: 'ifc_viewer' }),
 *       ],
 *     });
 *   }
 * }
 * ```
 */

import { ChartPlugin, type ChartPluginConfig } from './vendor/superset-types.js';
import metadata from './metadata.js';
import controlPanel from './controlPanel.js';
import buildQuery from './buildQuery.js';
import transformProps from './transformProps.js';

export default class IfcViewerChartPlugin extends ChartPlugin {
  constructor() {
    const config: ChartPluginConfig = {
      metadata,
      controlPanel,
      buildQuery: buildQuery as ChartPluginConfig['buildQuery'],
      // Lazy-load the chart component: this code-splits the entire
      // WebGPU renderer + WASM geometry processor out of the main bundle.
      // Cast needed: Superset's ChartPropsLike is a minimal interface;
      // our IFCViewerProps is a superset of it (has index signature).
      loadChart: (() => import('./IFCViewerChart.js')) as ChartPluginConfig['loadChart'],
      // transformProps is small and pure — load it eagerly.
      transformProps: transformProps as ChartPluginConfig['transformProps'],
    };
    super(config);
  }
}

// Re-export types for consumers
export type { IFCViewerFormData, IFCViewerProps } from './types.js';
export { PLUGIN_KEY, PLUGIN_NAME } from './types.js';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ChartMetadata, Behavior } from './vendor/superset-types.js';
import { PLUGIN_NAME } from './types.js';

const metadata = new ChartMetadata({
  name: PLUGIN_NAME,
  description:
    'Interactive 3D IFC building model viewer powered by WebGPU. ' +
    'Load IFC files, color entities by data metrics, and cross-filter ' +
    'with other dashboard charts by clicking building elements.',
  behaviors: [Behavior.InteractiveChart],
  category: 'BIM / AEC',
  tags: [
    'IFC',
    'BIM',
    '3D',
    'WebGPU',
    'Building',
    'AEC',
    'Cross-Filter',
  ],
});

export default metadata;

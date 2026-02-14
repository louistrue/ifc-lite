/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in lens nodes — colorization rules
 */

import type { NodeDefinition } from '../types.js';

export const lensNodes: NodeDefinition[] = [
  {
    id: 'lens.getPresets',
    name: 'Lens Presets',
    category: 'Analysis',
    description: 'Get built-in lens presets (colorization rules)',
    icon: 'glasses',
    inputs: [],
    outputs: [
      { id: 'presets', name: 'Presets', type: 'object[]', required: true },
    ],
    params: [],
    execute: (_inputs, _params, sdk) => {
      return { presets: sdk.lens.presets() };
    },
    toCode: () => `const presets = bim.lens.presets()`,
  },

  {
    id: 'lens.create',
    name: 'Create Lens',
    category: 'Analysis',
    description: 'Create a custom lens definition for rule-based colorization',
    icon: 'paintbrush',
    inputs: [],
    outputs: [
      { id: 'lens', name: 'Lens', type: 'Lens', required: true },
    ],
    params: [
      { id: 'name', name: 'Name', widget: 'text', default: 'My Lens' },
      { id: 'propertySet', name: 'Property Set', widget: 'text', default: 'Pset_WallCommon' },
      { id: 'property', name: 'Property', widget: 'text', default: '' },
    ],
    execute: (_inputs, params, sdk) => {
      const lens = sdk.lens.create({
        name: String(params.name),
        rules: [
          {
            id: `rule-${Date.now()}`,
            name: `${params.propertySet}.${params.property}`,
            enabled: true,
            criteria: {
              type: 'property' as const,
              propertySet: String(params.propertySet),
              propertyName: String(params.property),
              operator: 'exists' as const,
            },
            action: 'colorize' as const,
            color: '#E53935',
          },
        ],
      });
      return { lens };
    },
    toCode: (params) =>
      `const lens = bim.lens.create({\n  name: '${params.name}',\n  rules: [{\n    id: 'rule-1', name: '${params.propertySet}.${params.property}', enabled: true,\n    criteria: { type: 'property', propertySet: '${params.propertySet}', propertyName: '${params.property}', operator: 'exists' },\n    action: 'colorize', color: '#E53935'\n  }]\n})`,
  },
];

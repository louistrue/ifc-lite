/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in viewer nodes — colorize, hide, show, isolate, select, flyTo, section, reset
 */

import type { NodeDefinition } from '../types.js';
import type { EntityProxy } from '@ifc-lite/sdk';

export const viewerNodes: NodeDefinition[] = [
  {
    id: 'viewer.colorize',
    name: 'Colorize',
    category: 'Viewer',
    description: 'Apply a color overlay to entities',
    icon: 'palette',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true, description: 'Pass-through' },
    ],
    params: [
      { id: 'color', name: 'Color', widget: 'color', default: '#ff0000' },
    ],
    execute: (inputs, params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      const color = String(params.color);
      sdk.viewer.colorize(entities.map(e => e.ref), color);
      return { entities };
    },
    toCode: (params) => `bim.viewer.colorize(entities.map(e => e.ref), '${params.color}')`,
    fromCode: [{
      regex: /bim\.viewer\.colorize\((\w+)(?:\.map\([^)]+\))?,\s*['"]([^'"]+)['"]\)/,
      assigns: false,
      extractParams: (m) => ({ color: m[2] }),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.hide',
    name: 'Hide',
    category: 'Viewer',
    description: 'Hide entities in the 3D view',
    icon: 'eye-off',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [],
    params: [],
    execute: (inputs, _params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      sdk.viewer.hide(entities.map(e => e.ref));
      return {};
    },
    toCode: () => `bim.viewer.hide(entities.map(e => e.ref))`,
    fromCode: [{
      regex: /bim\.viewer\.hide\((\w+)(?:\.map\([^)]+\))?\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.show',
    name: 'Show',
    category: 'Viewer',
    description: 'Show previously hidden entities',
    icon: 'eye',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [],
    params: [],
    execute: (inputs, _params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      sdk.viewer.show(entities.map(e => e.ref));
      return {};
    },
    toCode: () => `bim.viewer.show(entities.map(e => e.ref))`,
    fromCode: [{
      regex: /bim\.viewer\.show\((\w+)(?:\.map\([^)]+\))?\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.isolate',
    name: 'Isolate',
    category: 'Viewer',
    description: 'Isolate entities (hide everything else)',
    icon: 'focus',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [],
    params: [],
    execute: (inputs, _params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      sdk.viewer.isolate(entities.map(e => e.ref));
      return {};
    },
    toCode: () => `bim.viewer.isolate(entities.map(e => e.ref))`,
    fromCode: [{
      regex: /bim\.viewer\.isolate\((\w+)(?:\.map\([^)]+\))?\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.select',
    name: 'Select',
    category: 'Viewer',
    description: 'Set the viewer selection to these entities',
    icon: 'mouse-pointer',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [],
    params: [],
    execute: (inputs, _params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      sdk.viewer.select(entities.map(e => e.ref));
      return {};
    },
    toCode: () => `bim.viewer.select(entities.map(e => e.ref))`,
    fromCode: [{
      regex: /bim\.viewer\.select\((\w+)(?:\.map\([^)]+\))?\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.flyTo',
    name: 'Fly To',
    category: 'Viewer',
    description: 'Fly camera to frame the given entities',
    icon: 'navigation',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [],
    params: [],
    execute: (inputs, _params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      sdk.viewer.flyTo(entities.map(e => e.ref));
      return {};
    },
    toCode: () => `bim.viewer.flyTo(entities.map(e => e.ref))`,
    fromCode: [{
      regex: /bim\.viewer\.flyTo\((\w+)(?:\.map\([^)]+\))?\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: (m) => [m[1]],
    }],
  },

  {
    id: 'viewer.resetColors',
    name: 'Reset Colors',
    category: 'Viewer',
    description: 'Remove all color overrides',
    icon: 'undo',
    inputs: [],
    outputs: [],
    params: [],
    execute: (_inputs, _params, sdk) => {
      sdk.viewer.resetColors();
      return {};
    },
    toCode: () => `bim.viewer.resetColors()`,
    fromCode: [{
      regex: /bim\.viewer\.resetColors\(\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: () => [],
    }],
  },

  {
    id: 'viewer.resetVisibility',
    name: 'Reset Visibility',
    category: 'Viewer',
    description: 'Show all entities (undo all hide/isolate)',
    icon: 'eye',
    inputs: [],
    outputs: [],
    params: [],
    execute: (_inputs, _params, sdk) => {
      sdk.viewer.resetVisibility();
      return {};
    },
    toCode: () => `bim.viewer.resetVisibility()`,
    fromCode: [{
      regex: /bim\.viewer\.resetVisibility\(\)/,
      assigns: false,
      extractParams: () => ({}),
      extractInputs: () => [],
    }],
  },
];

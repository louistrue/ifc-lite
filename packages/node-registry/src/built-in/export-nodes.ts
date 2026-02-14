/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in export nodes — CSV, data extraction
 */

import type { NodeDefinition } from '../types.js';
import type { EntityProxy } from '@ifc-lite/sdk';

export const exportNodes: NodeDefinition[] = [
  {
    id: 'data.extractProperties',
    name: 'Extract Properties',
    category: 'Data',
    description: 'Extract property values from entities into a table',
    icon: 'table',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'rows', name: 'Rows', type: 'object[]', required: true },
    ],
    params: [
      { id: 'psetName', name: 'Property Set', widget: 'text', default: '' },
      { id: 'propName', name: 'Property', widget: 'text', default: '' },
    ],
    execute: (inputs, params) => {
      const entities = inputs.entities as EntityProxy[];
      const pset = String(params.psetName);
      const prop = String(params.propName);

      const rows = entities.map(e => {
        const row: Record<string, unknown> = {
          name: e.name,
          type: e.type,
          globalId: e.globalId,
        };

        if (pset && prop) {
          row[`${pset}.${prop}`] = e.property(pset, prop);
        } else if (pset) {
          // Extract all properties from the named pset
          const psets = e.properties();
          const target = psets.find(p => p.name === pset);
          if (target) {
            for (const p of target.properties) {
              row[`${pset}.${p.name}`] = p.value;
            }
          }
        }

        return row;
      });

      return { rows };
    },
    toCode: (params) => {
      if (params.psetName && params.propName) {
        return `const rows = entities.map(e => ({ name: e.name, type: e.type, value: e.property('${params.psetName}', '${params.propName}') }))`;
      }
      return `const rows = entities.map(e => ({ name: e.name, type: e.type, .../* extract properties */ }))`;
    },
  },

  {
    id: 'data.extractQuantities',
    name: 'Extract Quantities',
    category: 'Data',
    description: 'Extract quantity values from entities',
    icon: 'ruler',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'rows', name: 'Rows', type: 'object[]', required: true },
    ],
    params: [
      { id: 'qsetName', name: 'Quantity Set', widget: 'text', default: '' },
      { id: 'qName', name: 'Quantity', widget: 'text', default: '' },
    ],
    execute: (inputs, params) => {
      const entities = inputs.entities as EntityProxy[];
      const qset = String(params.qsetName);
      const qName = String(params.qName);

      const rows = entities.map(e => {
        const row: Record<string, unknown> = {
          name: e.name,
          type: e.type,
        };

        if (qset && qName) {
          row[`${qset}.${qName}`] = e.quantity(qset, qName);
        }

        return row;
      });

      return { rows };
    },
    toCode: (params) => {
      return `const rows = entities.map(e => ({ name: e.name, type: e.type, value: e.quantity('${params.qsetName}', '${params.qName}') }))`;
    },
  },

  {
    id: 'export.watch',
    name: 'Watch',
    category: 'Export',
    description: 'Inspect data flowing through the graph (pass-through)',
    icon: 'eye',
    inputs: [
      { id: 'data', name: 'Data', type: 'any', required: true },
    ],
    outputs: [
      { id: 'data', name: 'Data', type: 'any', required: true, description: 'Pass-through' },
    ],
    params: [],
    execute: (inputs) => {
      // Pass-through — the UI renders the data in an inspector panel
      return { data: inputs.data };
    },
    toCode: () => `// Watch: data passes through`,
  },
];

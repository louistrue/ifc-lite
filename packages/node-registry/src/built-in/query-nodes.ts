/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in query nodes — auto-generated from SDK query API
 */

import type { NodeDefinition } from '../types.js';
import type { BimContext, EntityProxy } from '@ifc-lite/sdk';

export const queryNodes: NodeDefinition[] = [
  {
    id: 'query.allEntities',
    name: 'All Entities',
    category: 'Query',
    description: 'Get all entities from loaded models',
    icon: 'database',
    inputs: [],
    outputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    params: [
      {
        id: 'modelId',
        name: 'Model',
        widget: 'select',
        description: 'Scope to a specific model (leave empty for all)',
      },
    ],
    execute: (_inputs, params, sdk) => {
      const builder = sdk.query();
      if (params.modelId && typeof params.modelId === 'string') {
        builder.model(params.modelId);
      }
      return { entities: builder.toArray() };
    },
    toCode: (params) => {
      const modelClause = params.modelId ? `.model('${params.modelId}')` : '';
      return `const entities = bim.query()${modelClause}.toArray()`;
    },
  },

  {
    id: 'query.filterByType',
    name: 'Filter by Type',
    category: 'Query',
    description: 'Filter entities by IFC class type',
    icon: 'filter',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: false, description: 'Input entities (if empty, queries all)' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'EntityProxy[]', required: true },
    ],
    params: [
      { id: 'type', name: 'IFC Type', widget: 'ifc-type', default: 'IfcWall' },
    ],
    execute: (inputs, params, sdk) => {
      const type = String(params.type);
      if (inputs.entities && Array.isArray(inputs.entities)) {
        const filtered = (inputs.entities as EntityProxy[]).filter(e => e.type === type);
        return { result: filtered };
      }
      return { result: sdk.query().byType(type).toArray() };
    },
    toCode: (params) => `const result = bim.query().byType('${params.type}').toArray()`,
  },

  {
    id: 'query.filterByProperty',
    name: 'Filter by Property',
    category: 'Query',
    description: 'Filter entities by property value',
    icon: 'filter',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'EntityProxy[]', required: true },
    ],
    params: [
      { id: 'psetName', name: 'Property Set', widget: 'text', default: 'Pset_WallCommon' },
      { id: 'propName', name: 'Property', widget: 'text', default: 'IsExternal' },
      {
        id: 'operator', name: 'Operator', widget: 'select', default: '=',
        options: [
          { label: 'Equals', value: '=' },
          { label: 'Not equals', value: '!=' },
          { label: 'Greater than', value: '>' },
          { label: 'Less than', value: '<' },
          { label: 'Contains', value: 'contains' },
          { label: 'Exists', value: 'exists' },
        ],
      },
      { id: 'value', name: 'Value', widget: 'text', default: 'true' },
    ],
    execute: (inputs, params) => {
      const entities = inputs.entities as EntityProxy[];
      const pset = String(params.psetName);
      const prop = String(params.propName);
      const op = String(params.operator);
      const targetValue = params.value;

      const result = entities.filter(e => {
        const val = e.property(pset, prop);
        switch (op) {
          case '=': return String(val) === String(targetValue);
          case '!=': return String(val) !== String(targetValue);
          case '>': return Number(val) > Number(targetValue);
          case '<': return Number(val) < Number(targetValue);
          case 'contains': return String(val).includes(String(targetValue));
          case 'exists': return val !== null && val !== undefined;
          default: return false;
        }
      });
      return { result };
    },
    toCode: (params) => {
      const op = params.operator === '=' ? '===' : params.operator;
      if (params.operator === 'exists') {
        return `const result = entities.filter(e => e.property('${params.psetName}', '${params.propName}') != null)`;
      }
      return `const result = entities.filter(e => e.property('${params.psetName}', '${params.propName}') ${op} ${JSON.stringify(params.value)})`;
    },
  },
];

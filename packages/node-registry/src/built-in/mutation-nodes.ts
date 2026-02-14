/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in mutation nodes — property editing, undo/redo
 */

import type { NodeDefinition } from '../types.js';
import type { EntityProxy } from '@ifc-lite/sdk';

export const mutationNodes: NodeDefinition[] = [
  {
    id: 'mutate.setProperty',
    name: 'Set Property',
    category: 'Mutation',
    description: 'Set a property value on entities',
    icon: 'edit',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true, description: 'Pass-through' },
    ],
    params: [
      { id: 'psetName', name: 'Property Set', widget: 'text', default: 'Pset_WallCommon' },
      { id: 'propName', name: 'Property', widget: 'text', default: '' },
      { id: 'value', name: 'Value', widget: 'text', default: '' },
    ],
    execute: (inputs, params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      const pset = String(params.psetName);
      const prop = String(params.propName);
      const value = params.value;

      sdk.mutate.batch('Set property', () => {
        for (const entity of entities) {
          sdk.mutate.setProperty(entity.ref, pset, prop, value as string | number | boolean);
        }
      });

      return { entities };
    },
    toCode: (params) =>
      `bim.mutate.batch('Set property', () => {\n  for (const e of entities) {\n    bim.mutate.setProperty(e.ref, '${params.psetName}', '${params.propName}', ${JSON.stringify(params.value)})\n  }\n})`,
  },

  {
    id: 'mutate.deleteProperty',
    name: 'Delete Property',
    category: 'Mutation',
    description: 'Remove a property from entities',
    icon: 'trash',
    inputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true },
    ],
    outputs: [
      { id: 'entities', name: 'Entities', type: 'EntityProxy[]', required: true, description: 'Pass-through' },
    ],
    params: [
      { id: 'psetName', name: 'Property Set', widget: 'text', default: '' },
      { id: 'propName', name: 'Property', widget: 'text', default: '' },
    ],
    execute: (inputs, params, sdk) => {
      const entities = inputs.entities as EntityProxy[];
      const pset = String(params.psetName);
      const prop = String(params.propName);

      sdk.mutate.batch('Delete property', () => {
        for (const entity of entities) {
          sdk.mutate.deleteProperty(entity.ref, pset, prop);
        }
      });

      return { entities };
    },
    toCode: (params) =>
      `bim.mutate.batch('Delete property', () => {\n  for (const e of entities) {\n    bim.mutate.deleteProperty(e.ref, '${params.psetName}', '${params.propName}')\n  }\n})`,
  },

  {
    id: 'mutate.undo',
    name: 'Undo',
    category: 'Mutation',
    description: 'Undo the last mutation for a model',
    icon: 'undo',
    inputs: [],
    outputs: [],
    params: [
      { id: 'modelId', name: 'Model ID', widget: 'text', default: '' },
    ],
    execute: (_inputs, params, sdk) => {
      sdk.mutate.undo(String(params.modelId));
      return {};
    },
    toCode: (params) => `bim.mutate.undo('${params.modelId}')`,
  },

  {
    id: 'mutate.redo',
    name: 'Redo',
    category: 'Mutation',
    description: 'Redo the last undone mutation for a model',
    icon: 'redo',
    inputs: [],
    outputs: [],
    params: [
      { id: 'modelId', name: 'Model ID', widget: 'text', default: '' },
    ],
    execute: (_inputs, params, sdk) => {
      sdk.mutate.redo(String(params.modelId));
      return {};
    },
    toCode: (params) => `bim.mutate.redo('${params.modelId}')`,
  },
];

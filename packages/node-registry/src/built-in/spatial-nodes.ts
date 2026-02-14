/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in spatial query nodes — auto-generated from SDK spatial API
 */

import type { NodeDefinition } from '../types.js';

export const spatialNodes: NodeDefinition[] = [
  {
    id: 'spatial.queryBounds',
    name: 'Query Bounds',
    category: 'Query',
    description: 'Find entities within an axis-aligned bounding box',
    icon: 'box',
    inputs: [],
    outputs: [
      { id: 'refs', name: 'Entity Refs', type: 'EntityRef[]', required: true },
    ],
    params: [
      { id: 'modelId', name: 'Model ID', widget: 'text', description: 'Model to query' },
      { id: 'minX', name: 'Min X', widget: 'number', default: 0 },
      { id: 'minY', name: 'Min Y', widget: 'number', default: 0 },
      { id: 'minZ', name: 'Min Z', widget: 'number', default: 0 },
      { id: 'maxX', name: 'Max X', widget: 'number', default: 10 },
      { id: 'maxY', name: 'Max Y', widget: 'number', default: 10 },
      { id: 'maxZ', name: 'Max Z', widget: 'number', default: 10 },
    ],
    execute: (_inputs, params, sdk) => {
      const modelId = String(params.modelId);
      const bounds = {
        min: [Number(params.minX), Number(params.minY), Number(params.minZ)] as [number, number, number],
        max: [Number(params.maxX), Number(params.maxY), Number(params.maxZ)] as [number, number, number],
      };
      return { refs: sdk.spatial.queryBounds(modelId, bounds) };
    },
    toCode: (params) =>
      `const refs = bim.spatial.queryBounds(${JSON.stringify(String(params.modelId))}, { min: [${params.minX}, ${params.minY}, ${params.minZ}], max: [${params.maxX}, ${params.maxY}, ${params.maxZ}] })`,
    fromCode: [{
      regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.spatial\.queryBounds\(['"]([^'"]+)['"],/,
      assigns: true,
      extractParams: (m) => ({ modelId: m[2] }),
      extractInputs: () => [],
    }],
  },

  {
    id: 'spatial.raycast',
    name: 'Raycast',
    category: 'Query',
    description: 'Cast a ray and find entities that intersect it',
    icon: 'crosshair',
    inputs: [],
    outputs: [
      { id: 'refs', name: 'Hit Refs', type: 'EntityRef[]', required: true },
    ],
    params: [
      { id: 'modelId', name: 'Model ID', widget: 'text', description: 'Model to query' },
      { id: 'originX', name: 'Origin X', widget: 'number', default: 0 },
      { id: 'originY', name: 'Origin Y', widget: 'number', default: 0 },
      { id: 'originZ', name: 'Origin Z', widget: 'number', default: 0 },
      { id: 'dirX', name: 'Direction X', widget: 'number', default: 1 },
      { id: 'dirY', name: 'Direction Y', widget: 'number', default: 0 },
      { id: 'dirZ', name: 'Direction Z', widget: 'number', default: 0 },
    ],
    execute: (_inputs, params, sdk) => {
      const modelId = String(params.modelId);
      const origin: [number, number, number] = [Number(params.originX), Number(params.originY), Number(params.originZ)];
      const direction: [number, number, number] = [Number(params.dirX), Number(params.dirY), Number(params.dirZ)];
      return { refs: sdk.spatial.raycast(modelId, origin, direction) };
    },
    toCode: (params) =>
      `const refs = bim.spatial.raycast(${JSON.stringify(String(params.modelId))}, [${params.originX}, ${params.originY}, ${params.originZ}], [${params.dirX}, ${params.dirY}, ${params.dirZ}])`,
    fromCode: [{
      regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.spatial\.raycast\(['"]([^'"]+)['"],/,
      assigns: true,
      extractParams: (m) => ({ modelId: m[2] }),
      extractInputs: () => [],
    }],
  },

  {
    id: 'spatial.queryRadius',
    name: 'Query Radius',
    category: 'Query',
    description: 'Find entities within a radius of a point',
    icon: 'circle',
    inputs: [],
    outputs: [
      { id: 'refs', name: 'Entity Refs', type: 'EntityRef[]', required: true },
    ],
    params: [
      { id: 'modelId', name: 'Model ID', widget: 'text', description: 'Model to query' },
      { id: 'centerX', name: 'Center X', widget: 'number', default: 0 },
      { id: 'centerY', name: 'Center Y', widget: 'number', default: 0 },
      { id: 'centerZ', name: 'Center Z', widget: 'number', default: 0 },
      { id: 'radius', name: 'Radius', widget: 'number', default: 5 },
    ],
    execute: (_inputs, params, sdk) => {
      const modelId = String(params.modelId);
      const center: [number, number, number] = [Number(params.centerX), Number(params.centerY), Number(params.centerZ)];
      return { refs: sdk.spatial.queryRadius(modelId, center, Number(params.radius)) };
    },
    toCode: (params) =>
      `const refs = bim.spatial.queryRadius(${JSON.stringify(String(params.modelId))}, [${params.centerX}, ${params.centerY}, ${params.centerZ}], ${params.radius})`,
    fromCode: [{
      regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.spatial\.queryRadius\(['"]([^'"]+)['"],/,
      assigns: true,
      extractParams: (m) => ({ modelId: m[2] }),
      extractInputs: () => [],
    }],
  },
];

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in validation nodes — IDS parsing, checking, reporting
 */

import type { NodeDefinition } from '../types.js';

export const validationNodes: NodeDefinition[] = [
  {
    id: 'ids.parse',
    name: 'Parse IDS',
    category: 'Validation',
    description: 'Parse an IDS (Information Delivery Specification) XML document',
    icon: 'file-check',
    inputs: [
      { id: 'xmlContent', name: 'XML', type: 'string', required: true },
    ],
    outputs: [
      { id: 'idsDocument', name: 'IDS Document', type: 'object', required: true },
    ],
    params: [],
    execute: async (inputs, _params, sdk) => {
      const xml = String(inputs.xmlContent);
      const doc = await sdk.ids.parse(xml);
      return { idsDocument: doc };
    },
    toCode: () => `const idsDocument = await bim.ids.parse(xmlContent)`,
    fromCode: [{
      regex: /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?bim\.ids\.parse\((\w+)\)/,
      assigns: true,
      extractParams: () => ({}),
      extractInputs: (m) => [m[2]],
    }],
  },

  {
    id: 'ids.summarize',
    name: 'Summarize IDS Report',
    category: 'Validation',
    description: 'Get a summary of an IDS validation report',
    icon: 'bar-chart',
    inputs: [
      { id: 'report', name: 'Report', type: 'object', required: true },
    ],
    outputs: [
      { id: 'summary', name: 'Summary', type: 'object', required: true },
    ],
    params: [],
    execute: (inputs, _params, sdk) => {
      const report = inputs.report as {
        specificationResults: Array<{
          entityResults: Array<{ passed: boolean }>;
        }>;
      };
      const summary = sdk.ids.summarize(report);
      return { summary };
    },
    toCode: () => `const summary = bim.ids.summarize(report)`,
    fromCode: [{
      regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.ids\.summarize\((\w+)\)/,
      assigns: true,
      extractParams: () => ({}),
      extractInputs: (m) => [m[2]],
    }],
  },
];

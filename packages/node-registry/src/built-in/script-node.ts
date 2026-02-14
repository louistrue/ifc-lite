/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Script node — the escape hatch.
 *
 * A node that contains a Monaco editor where users write TypeScript/JavaScript.
 * Inputs arrive as typed variables, outputs are returned from the function.
 * Runs in the QuickJS sandbox with `bim.*` available.
 *
 * Like Grasshopper's script component: wires carry data in, code transforms it,
 * wires carry data out.
 */

import type { NodeDefinition } from '../types.js';

export const scriptNode: NodeDefinition = {
  id: 'script.custom',
  name: 'Script',
  category: 'Script',
  description: 'Write custom TypeScript code with full bim.* API access',
  icon: 'code',
  inputs: [
    { id: 'input', name: 'Input', type: 'any', required: false, description: 'Data from upstream nodes' },
  ],
  outputs: [
    { id: 'output', name: 'Output', type: 'any', required: false, description: 'Data for downstream nodes' },
  ],
  params: [
    {
      id: 'code',
      name: 'Code',
      widget: 'code',
      default: `// Input data is available as 'input'
// Return value becomes the output
// bim.* API is available

const walls = bim.query.byType('IfcWall')
console.log('Found', walls.length, 'walls')
return walls`,
    },
  ],
  execute: async (inputs, params, sdk) => {
    // Script execution happens in the sandbox (handled by the graph executor)
    // This execute function is a placeholder — the real execution is in
    // the graph executor which creates a sandbox and runs the code.
    //
    // For now, return a marker that tells the executor to sandbox this node.
    return {
      output: inputs.input,
      __script: String(params.code),
      __needsSandbox: true,
    };
  },
  toCode: (params) => String(params.code),
};

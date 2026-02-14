/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/node-registry — Visual node definitions and graph compiler
 *
 * Every SDK function is a visual node. Every node graph compiles to a script.
 *
 * @example
 * ```ts
 * import { getRegistry, getBuiltinNodes, compileGraph } from '@ifc-lite/node-registry';
 *
 * // Get the global registry with all built-in nodes
 * const registry = getRegistry();
 * registry.registerAll(getBuiltinNodes());
 *
 * // List all available nodes for a palette
 * const nodes = registry.getAll();
 * const categories = registry.getCategories();
 *
 * // Compile a graph to TypeScript
 * const script = compileGraph(myGraph, registry);
 * console.log(script.code);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  DataType,
  PortDefinition,
  ParamWidget,
  ParamDefinition,
  NodeCategory,
  NodeDefinition,
  NodeExecutor,
  GraphNode,
  GraphEdge,
  Graph,
} from './types.js';

// ============================================================================
// Registry
// ============================================================================

export { NodeRegistry, getRegistry } from './registry.js';

// ============================================================================
// Built-in Nodes
// ============================================================================

import { queryNodes } from './built-in/query-nodes.js';
import { viewerNodes } from './built-in/viewer-nodes.js';
import { exportNodes } from './built-in/export-nodes.js';
import { mutationNodes } from './built-in/mutation-nodes.js';
import { validationNodes } from './built-in/validation-nodes.js';
import { lensNodes } from './built-in/lens-nodes.js';
import { scriptNode } from './built-in/script-node.js';
import type { NodeDefinition } from './types.js';

/** Get all built-in node definitions */
export function getBuiltinNodes(): NodeDefinition[] {
  return [
    ...queryNodes,
    ...viewerNodes,
    ...exportNodes,
    ...mutationNodes,
    ...validationNodes,
    ...lensNodes,
    scriptNode,
  ];
}

// ============================================================================
// Compiler
// ============================================================================

export { compileGraph } from './compiler.js';
export type { CompileResult } from './compiler.js';

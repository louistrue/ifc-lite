/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Graph → Script compiler
 *
 * Takes a visual node graph (DAG) and compiles it to a TypeScript script.
 *
 * Algorithm:
 * 1. Topological sort the graph (detect cycles)
 * 2. For each node in order, emit its code using the node definition's toCode()
 * 3. Wire outputs to inputs using variable names
 *
 * The resulting script is valid TypeScript that can run in the sandbox
 * or be pasted into a standalone file.
 */

import type { Graph, GraphNode, GraphEdge } from './types.js';
import type { NodeRegistry } from './registry.js';

export interface CompileResult {
  /** Generated TypeScript code */
  code: string;
  /** Warnings (e.g., unused outputs, disconnected nodes) */
  warnings: string[];
}

/**
 * Compile a graph to a TypeScript script.
 */
export function compileGraph(graph: Graph, registry: NodeRegistry): CompileResult {
  const warnings: string[] = [];

  // Build adjacency list
  const incomingEdges = new Map<string, GraphEdge[]>();
  const outgoingEdges = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) {
    incomingEdges.set(node.id, []);
    outgoingEdges.set(node.id, []);
  }
  for (const edge of graph.edges) {
    incomingEdges.get(edge.targetNodeId)?.push(edge);
    outgoingEdges.get(edge.sourceNodeId)?.push(edge);
  }

  // Topological sort (Kahn's algorithm)
  const sorted = topologicalSort(graph.nodes, incomingEdges);
  if (sorted.length !== graph.nodes.length) {
    warnings.push('Graph contains a cycle — some nodes will not be compiled');
  }

  // Generate code
  const lines: string[] = [
    `// Generated from graph: ${graph.name}`,
    `// ${new Date().toISOString()}`,
    '',
  ];

  // Variable name map: nodeId:portId → variable name
  const varNames = new Map<string, string>();
  let varCounter = 0;

  for (const node of sorted) {
    const definition = registry.get(node.definitionId);
    if (!definition) {
      warnings.push(`Unknown node type: ${node.definitionId}`);
      continue;
    }

    // Resolve input variable names from incoming edges
    const inputVars: Record<string, string> = {};
    const incoming = incomingEdges.get(node.id) ?? [];
    for (const edge of incoming) {
      const sourceVar = varNames.get(`${edge.sourceNodeId}:${edge.sourcePortId}`);
      if (sourceVar) {
        inputVars[edge.targetPortId] = sourceVar;
      }
    }

    // Generate variable names for outputs
    const outputVars: Record<string, string> = {};
    for (const output of definition.outputs) {
      const name = `_${sanitize(definition.name)}_${output.id}_${varCounter++}`;
      outputVars[output.id] = name;
      varNames.set(`${node.id}:${output.id}`, name);
    }

    // Emit code
    const code = definition.toCode(node.params);

    if (definition.id === 'script.custom') {
      // Script nodes emit their code directly
      lines.push(`// --- Script: ${node.id} ---`);
      if (Object.keys(inputVars).length > 0) {
        const firstInput = Object.values(inputVars)[0];
        lines.push(`const input = ${firstInput}`);
      }
      lines.push(code);
      // Script nodes use 'return' — wrap in an IIFE or just emit directly
      if (Object.keys(outputVars).length > 0) {
        const firstOutput = Object.values(outputVars)[0];
        lines.push(`const ${firstOutput} = input // script output`);
      }
      lines.push('');
      continue;
    }

    // For regular nodes: substitute input references
    let emittedCode = code;

    // Replace references to input ports with their variable names
    for (const [portId, varName] of Object.entries(inputVars)) {
      emittedCode = emittedCode.replace(new RegExp(`\\b${portId}\\b`, 'g'), varName);
    }

    // If the node has outputs, assign them
    if (Object.keys(outputVars).length === 1) {
      const outputName = Object.values(outputVars)[0];
      // Replace the first `const xxx =` with `const outputName =`
      if (emittedCode.startsWith('const ')) {
        const eqIdx = emittedCode.indexOf('=');
        if (eqIdx > 0) {
          emittedCode = `const ${outputName} =${emittedCode.slice(eqIdx + 1)}`;
        }
      } else {
        emittedCode = `const ${outputName} = ${emittedCode}`;
      }
    }

    lines.push(emittedCode);
  }

  return {
    code: lines.join('\n'),
    warnings,
  };
}

/** Topological sort using Kahn's algorithm */
function topologicalSort(nodes: GraphNode[], incomingEdges: Map<string, GraphEdge[]>): GraphNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const [nodeId, edges] of incomingEdges) {
    inDegree.set(nodeId, edges.length);
    for (const edge of edges) {
      adjacency.get(edge.sourceNodeId)?.push(nodeId);
    }
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: GraphNode[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const degree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/** Sanitize a string for use as a variable name */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

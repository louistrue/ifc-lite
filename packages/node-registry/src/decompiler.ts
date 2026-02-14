/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Script → Graph decompiler
 *
 * Analyzes TypeScript/JavaScript code to reconstruct a visual node graph.
 * Detects SDK call patterns (bim.query(), bim.viewer.colorize(), etc.) and
 * maps them to node definitions.
 *
 * This enables the code ↔ graph duality: any SDK script can be viewed as
 * a visual graph, and any graph compiles back to a script.
 *
 * The decompiler reads `fromCode` patterns directly from the node registry,
 * eliminating the need for a separate hardcoded pattern list. This ensures
 * the decompiler stays in sync with node definitions automatically.
 */

import type { Graph, GraphNode, GraphEdge, FromCodePattern } from './types.js';
import type { NodeRegistry } from './registry.js';

export interface DecompileResult {
  /** Reconstructed graph */
  graph: Graph;
  /** Lines that could not be mapped to known nodes */
  unmappedLines: Array<{ line: number; text: string }>;
  /** Warnings about potential data flow issues */
  warnings: string[];
}

/** A detected SDK call in the source code */
interface DetectedCall {
  /** Variable name assigned to (if any) */
  assignedTo: string | null;
  /** The SDK pattern matched */
  pattern: string;
  /** Node definition ID */
  nodeId: string;
  /** Extracted parameters */
  params: Record<string, unknown>;
  /** Variable names used as inputs */
  inputVars: string[];
  /** Source line number */
  line: number;
}

/** A flattened pattern with its node ID for efficient matching */
interface FlattenedPattern {
  nodeId: string;
  pattern: FromCodePattern;
}

/**
 * Build a flat list of patterns from all registered nodes.
 * The order follows registration order (important for pattern priority).
 */
function collectPatterns(registry: NodeRegistry): FlattenedPattern[] {
  const result: FlattenedPattern[] = [];
  for (const node of registry.getAll()) {
    if (node.fromCode) {
      for (const pattern of node.fromCode) {
        result.push({ nodeId: node.id, pattern });
      }
    }
  }
  return result;
}

/**
 * Decompile a TypeScript/JavaScript script into a visual node graph.
 *
 * Uses the node registry's `fromCode` patterns to recognize SDK calls.
 * The registry must be populated with nodes before calling this function.
 */
export function decompileScript(code: string, registry: NodeRegistry, graphName?: string): DecompileResult {
  const lines = code.split('\n');
  const warnings: string[] = [];
  const unmappedLines: Array<{ line: number; text: string }> = [];
  const detectedCalls: DetectedCall[] = [];

  const patterns = collectPatterns(registry);

  // Pass 1: Detect SDK calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines, comments, imports
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('import ')) {
      continue;
    }

    let matched = false;
    for (const { nodeId, pattern } of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        detectedCalls.push({
          assignedTo: pattern.assigns && match[1] && /^[a-zA-Z_$]/.test(match[1]) ? match[1] : null,
          pattern: nodeId,
          nodeId,
          params: pattern.extractParams(match),
          inputVars: pattern.extractInputs(match),
          line: i + 1,
        });
        matched = true;
        break;
      }
    }

    if (!matched && line.includes('bim.')) {
      unmappedLines.push({ line: i + 1, text: line });
    }
  }

  // Pass 2: Build graph nodes and edges
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Track which variable was produced by which node:output
  const varToNodeOutput = new Map<string, { nodeId: string; portId: string }>();

  for (let i = 0; i < detectedCalls.length; i++) {
    const call = detectedCalls[i];
    const nodeInstanceId = `node_${i}`;

    // Create the graph node
    nodes.push({
      id: nodeInstanceId,
      definitionId: call.nodeId,
      params: call.params,
      position: { x: 100, y: 100 + i * 150 },
    });

    // Register output variable
    if (call.assignedTo) {
      const outputPort = getOutputPortId(call.nodeId, registry);
      varToNodeOutput.set(call.assignedTo, {
        nodeId: nodeInstanceId,
        portId: outputPort,
      });
    }

    // Create edges from input variables
    for (const inputVar of call.inputVars) {
      const source = varToNodeOutput.get(inputVar);
      if (source) {
        const inputPort = getInputPortId(call.nodeId, registry);
        edges.push({
          sourceNodeId: source.nodeId,
          sourcePortId: source.portId,
          targetNodeId: nodeInstanceId,
          targetPortId: inputPort,
        });
      } else {
        warnings.push(`Line ${call.line}: Variable '${inputVar}' not produced by a recognized SDK call`);
      }
    }
  }

  if (detectedCalls.length === 0 && lines.some(l => l.trim().length > 0 && !l.trim().startsWith('//'))) {
    warnings.push('No SDK calls detected in the script');
  }

  return {
    graph: {
      name: graphName ?? 'Decompiled Script',
      description: `Decompiled from ${detectedCalls.length} SDK call(s)`,
      nodes,
      edges,
    },
    unmappedLines,
    warnings,
  };
}

/** Get the default output port ID for a node, using the registry definition if available */
function getOutputPortId(nodeId: string, registry: NodeRegistry): string {
  const node = registry.get(nodeId);
  if (node && node.outputs.length > 0) {
    return node.outputs[0].id;
  }
  // Fallback based on convention
  if (nodeId === 'query.allEntities') return 'entities';
  if (nodeId.startsWith('query.')) return 'result';
  if (nodeId.startsWith('export.')) return 'output';
  if (nodeId.startsWith('spatial.')) return 'refs';
  return 'result';
}

/** Get the default input port ID for a node, using the registry definition if available */
function getInputPortId(nodeId: string, registry: NodeRegistry): string {
  const node = registry.get(nodeId);
  if (node && node.inputs.length > 0) {
    return node.inputs[0].id;
  }
  // Fallback based on convention
  if (nodeId.startsWith('query.filter')) return 'entities';
  if (nodeId.startsWith('viewer.') || nodeId.startsWith('export.') || nodeId.startsWith('mutate.')) return 'entities';
  return 'input';
}

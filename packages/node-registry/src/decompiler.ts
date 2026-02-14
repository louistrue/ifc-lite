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
 * Approach:
 * 1. Regex-based pattern matching (no full AST parser needed)
 * 2. Track variable assignments to infer data flow (edges)
 * 3. Map recognized patterns to known node definitions
 * 4. Return a Graph that can be rendered in the visual editor
 */

import type { Graph, GraphNode, GraphEdge } from './types.js';

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

// ── Pattern definitions ──────────────────────────────────────────────

interface PatternRule {
  /** Regex to match the code line */
  regex: RegExp;
  /** Node definition ID to map to */
  nodeId: string;
  /** Whether the first capture group is a variable assignment (const x = ...) */
  assigns: boolean;
  /** Extract params from regex match groups */
  extractParams: (match: RegExpMatchArray) => Record<string, unknown>;
  /** Extract input variable names from match */
  extractInputs: (match: RegExpMatchArray) => string[];
}

const SDK_PATTERNS: PatternRule[] = [
  // bim.query().byType('IfcWall').toArray()
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.query\(\)(?:\.model\(['"]([^'"]*)['"]\))?\.byType\(['"](\w+)['"]\)\.toArray\(\)/,
    nodeId: 'query.filterByType',
    assigns: true,
    extractParams: (m) => ({ type: m[3], modelId: m[2] || undefined }),
    extractInputs: () => [],
  },
  // bim.query().toArray() — all entities
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.query\(\)(?:\.model\(['"]([^'"]*)['"]\))?\.toArray\(\)/,
    nodeId: 'query.allEntities',
    assigns: true,
    extractParams: (m) => ({ modelId: m[2] || undefined }),
    extractInputs: () => [],
  },
  // bim.query().byType(...).where(...).toArray()
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.query\(\)(?:\.model\(['"]([^'"]*)['"]\))?\.byType\(['"](\w+)['"]\)\.where\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(?:['"]([^'"]*)['"]\s*|(\d+(?:\.\d+)?)\s*|(\w+)\s*)\)\.toArray\(\)/,
    nodeId: 'query.filterByProperty',
    assigns: true,
    extractParams: (m) => ({
      type: m[3],
      psetName: m[4],
      propName: m[5],
      operator: m[6],
      value: m[7] ?? m[8] ?? m[9],
    }),
    extractInputs: () => [],
  },
  // entities.filter(e => e.property('PsetName', 'PropName') != null) — exists check
  // MUST be before the general filter pattern to avoid false match
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\.filter\(\w+\s*=>\s*\w+\.property\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)\s*!=\s*null\)/,
    nodeId: 'query.filterByProperty',
    assigns: true,
    extractParams: (m) => ({
      psetName: m[3],
      propName: m[4],
      operator: 'exists',
    }),
    extractInputs: (m) => [m[2]],
  },
  // entities.filter(e => e.property('PsetName', 'PropName') ...)
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\.filter\(\w+\s*=>\s*\w+\.property\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)\s*(===?|!==?|>|<|>=|<=)\s*(?:['"]([^'"]*)['"]\s*|(\d+(?:\.\d+)?)\s*|(\w+)\s*)\)/,
    nodeId: 'query.filterByProperty',
    assigns: true,
    extractParams: (m) => ({
      psetName: m[3],
      propName: m[4],
      operator: m[5] === '===' ? '=' : m[5] === '!==' ? '!=' : m[5],
      value: m[6] ?? m[7] ?? m[8],
    }),
    extractInputs: (m) => [m[2]],
  },
  // bim.viewer.colorize(refs, '#color')
  {
    regex: /bim\.viewer\.colorize\((\w+)(?:\.map\([^)]+\))?,\s*['"]([^'"]+)['"]\)/,
    nodeId: 'viewer.colorize',
    assigns: false,
    extractParams: (m) => ({ color: m[2] }),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.hide(refs)
  {
    regex: /bim\.viewer\.hide\((\w+)(?:\.map\([^)]+\))?\)/,
    nodeId: 'viewer.hide',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.show(refs)
  {
    regex: /bim\.viewer\.show\((\w+)(?:\.map\([^)]+\))?\)/,
    nodeId: 'viewer.show',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.isolate(refs)
  {
    regex: /bim\.viewer\.isolate\((\w+)(?:\.map\([^)]+\))?\)/,
    nodeId: 'viewer.isolate',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.select(refs)
  {
    regex: /bim\.viewer\.select\((\w+)(?:\.map\([^)]+\))?\)/,
    nodeId: 'viewer.select',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.flyTo(refs)
  {
    regex: /bim\.viewer\.flyTo\((\w+)(?:\.map\([^)]+\))?\)/,
    nodeId: 'viewer.flyTo',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: (m) => [m[1]],
  },
  // bim.export.csv(refs, { columns: [...] })
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.export\.csv\((\w+)(?:\.map\([^)]+\))?,\s*\{[^}]*columns:\s*\[([^\]]*)\]/,
    nodeId: 'export.csv',
    assigns: true,
    extractParams: (m) => ({
      columns: m[3].split(',').map((s: string) => s.trim().replace(/['"]/g, '')).filter(Boolean),
    }),
    extractInputs: (m) => [m[2]],
  },
  // bim.export.json(refs, [...columns])
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.export\.json\((\w+)(?:\.map\([^)]+\))?,\s*\[([^\]]*)\]\)/,
    nodeId: 'export.json',
    assigns: true,
    extractParams: (m) => ({
      columns: m[3].split(',').map((s: string) => s.trim().replace(/['"]/g, '')).filter(Boolean),
    }),
    extractInputs: (m) => [m[2]],
  },
  // bim.mutate.setProperty(ref, 'PsetName', 'PropName', value)
  {
    regex: /bim\.mutate\.setProperty\((\w+)(?:\.\w+)?,\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(?:['"]([^'"]*)['"]\s*|(\d+(?:\.\d+)?)\s*|(\w+)\s*)\)/,
    nodeId: 'mutate.setProperty',
    assigns: false,
    extractParams: (m) => ({
      psetName: m[2],
      propName: m[3],
      value: m[4] ?? m[5] ?? m[6],
    }),
    extractInputs: (m) => [m[1]],
  },
  // bim.viewer.resetVisibility()
  {
    regex: /bim\.viewer\.resetVisibility\(\)/,
    nodeId: 'viewer.resetVisibility',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: () => [],
  },
  // bim.viewer.resetColors()
  {
    regex: /bim\.viewer\.resetColors\(\)/,
    nodeId: 'viewer.resetColors',
    assigns: false,
    extractParams: () => ({}),
    extractInputs: () => [],
  },
  // bim.spatial.queryBounds(modelId, bounds)
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.spatial\.queryBounds\(['"]([^'"]+)['"],/,
    nodeId: 'spatial.queryBounds',
    assigns: true,
    extractParams: (m) => ({ modelId: m[2] }),
    extractInputs: () => [],
  },
  // bim.spatial.raycast(modelId, origin, direction)
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*bim\.spatial\.raycast\(['"]([^'"]+)['"],/,
    nodeId: 'spatial.raycast',
    assigns: true,
    extractParams: (m) => ({ modelId: m[2] }),
    extractInputs: () => [],
  },
];

// ── Main decompiler ─────────────────────────────────────────────────

/**
 * Decompile a TypeScript/JavaScript script into a visual node graph.
 *
 * The decompiler scans each line for known SDK patterns and constructs
 * a graph with appropriate nodes and edges based on variable flow.
 */
export function decompileScript(code: string, graphName?: string): DecompileResult {
  const lines = code.split('\n');
  const warnings: string[] = [];
  const unmappedLines: Array<{ line: number; text: string }> = [];
  const detectedCalls: DetectedCall[] = [];

  // Pass 1: Detect SDK calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines, comments, imports
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('import ')) {
      continue;
    }

    let matched = false;
    for (const pattern of SDK_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        detectedCalls.push({
          assignedTo: pattern.assigns && match[1] && /^[a-zA-Z_$]/.test(match[1]) ? match[1] : null,
          pattern: pattern.nodeId,
          nodeId: pattern.nodeId,
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
      // Use 'result' as default output port (most nodes have a single output)
      const outputPort = getOutputPortId(call.nodeId);
      varToNodeOutput.set(call.assignedTo, {
        nodeId: nodeInstanceId,
        portId: outputPort,
      });
    }

    // Create edges from input variables
    for (const inputVar of call.inputVars) {
      const source = varToNodeOutput.get(inputVar);
      if (source) {
        const inputPort = getInputPortId(call.nodeId);
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

/** Get the default output port ID for a node definition */
function getOutputPortId(nodeId: string): string {
  // Query nodes use 'entities' or 'result'
  if (nodeId === 'query.allEntities') return 'entities';
  if (nodeId.startsWith('query.')) return 'result';
  if (nodeId.startsWith('export.')) return 'output';
  if (nodeId.startsWith('spatial.')) return 'refs';
  return 'result';
}

/** Get the default input port ID for a node definition */
function getInputPortId(nodeId: string): string {
  if (nodeId.startsWith('query.filter')) return 'entities';
  if (nodeId.startsWith('viewer.') || nodeId.startsWith('export.') || nodeId.startsWith('mutate.')) return 'entities';
  return 'input';
}

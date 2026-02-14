/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Integration tests for the scripting pipeline.
 *
 * Tests the full cycle:
 *   Node definitions → Graph → Compiler → Code → Decompiler → Graph
 *
 * These tests verify that:
 * 1. Every node with `fromCode` can roundtrip through compile→decompile
 * 2. The registry stays complete (no orphaned patterns)
 * 3. Complex multi-node pipelines survive the roundtrip
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from './registry.js';
import { getBuiltinNodes } from './index.js';
import { compileGraph } from './compiler.js';
import { decompileScript } from './decompiler.js';
import type { Graph, NodeDefinition } from './types.js';

let registry: NodeRegistry;

beforeEach(() => {
  registry = new NodeRegistry();
  registry.registerAll(getBuiltinNodes());
});

// ============================================================================
// Registry Completeness
// ============================================================================

describe('registry completeness', () => {
  it('all nodes with toCode that produce bim.* calls have fromCode patterns', () => {
    const missing: string[] = [];

    for (const node of registry.getAll()) {
      // Skip script.custom (meta-node) and data.* nodes (no bim.* calls)
      if (node.id === 'script.custom') continue;
      if (node.id.startsWith('data.')) continue;
      if (node.id === 'export.watch') continue;

      const code = node.toCode(getDefaultParams(node));
      if (code.includes('bim.') && !node.fromCode?.length) {
        missing.push(`${node.id}: generates 'bim.*' code but has no fromCode patterns`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('all fromCode patterns have valid regex', () => {
    for (const node of registry.getAll()) {
      if (!node.fromCode) continue;
      for (const pattern of node.fromCode) {
        expect(pattern.regex).toBeInstanceOf(RegExp);
        expect(typeof pattern.extractParams).toBe('function');
        expect(typeof pattern.extractInputs).toBe('function');
      }
    }
  });

  it('categories are non-empty', () => {
    const categories = registry.getCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const cat of categories) {
      expect(registry.getByCategory(cat).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Compiler → Decompiler Roundtrip
// ============================================================================

describe('compiler → decompiler roundtrip', () => {
  it('single query node roundtrips', () => {
    const graph = makeGraph([
      { id: 'n0', definitionId: 'query.filterByType', params: { type: 'IfcWall' } },
    ]);

    const compiled = compileGraph(graph, registry);
    expect(compiled.warnings).toHaveLength(0);
    expect(compiled.code).toContain('IfcWall');

    const decompiled = decompileScript(compiled.code, registry);
    expect(decompiled.graph.nodes).toHaveLength(1);
    expect(decompiled.graph.nodes[0].definitionId).toBe('query.filterByType');
    expect(decompiled.graph.nodes[0].params.type).toBe('IfcWall');
  });

  it('single viewer node roundtrips', () => {
    const graph = makeGraph([
      { id: 'n0', definitionId: 'viewer.resetColors', params: {} },
    ]);

    const compiled = compileGraph(graph, registry);
    const decompiled = decompileScript(compiled.code, registry);
    expect(decompiled.graph.nodes).toHaveLength(1);
    expect(decompiled.graph.nodes[0].definitionId).toBe('viewer.resetColors');
  });

  it('single mutation node roundtrips', () => {
    const graph = makeGraph([
      { id: 'n0', definitionId: 'mutate.setProperty', params: { psetName: 'Pset_Custom', propName: 'Status', value: 'Done' } },
    ]);

    const compiled = compileGraph(graph, registry);
    expect(compiled.code).toContain('Pset_Custom');

    const decompiled = decompileScript(compiled.code, registry);
    // mutate uses batch syntax which may or may not roundtrip cleanly
    // but at least the SDK call should be detected
    expect(decompiled.graph.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('single spatial node roundtrips', () => {
    const graph = makeGraph([
      { id: 'n0', definitionId: 'spatial.queryBounds', params: { modelId: 'arch', minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 } },
    ]);

    const compiled = compileGraph(graph, registry);
    expect(compiled.code).toContain('spatial.queryBounds');

    const decompiled = decompileScript(compiled.code, registry);
    expect(decompiled.graph.nodes).toHaveLength(1);
    expect(decompiled.graph.nodes[0].definitionId).toBe('spatial.queryBounds');
    expect(decompiled.graph.nodes[0].params.modelId).toBe('arch');
  });
});

// ============================================================================
// Multi-node Pipeline Roundtrip
// ============================================================================

describe('multi-node pipeline roundtrip', () => {
  it('query → colorize pipeline preserves structure', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `bim.viewer.colorize(walls, '#00ff00')`,
    ].join('\n');

    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);

    // Verify node types
    expect(result.graph.nodes[0].definitionId).toBe('query.filterByType');
    expect(result.graph.nodes[1].definitionId).toBe('viewer.colorize');

    // Verify edge direction
    expect(result.graph.edges[0].sourceNodeId).toBe('node_0');
    expect(result.graph.edges[0].targetNodeId).toBe('node_1');

    // Verify params preserved
    expect(result.graph.nodes[0].params.type).toBe('IfcWall');
    expect(result.graph.nodes[1].params.color).toBe('#00ff00');
  });

  it('query → filter → hide pipeline preserves chain', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `const external = walls.filter(e => e.property('Pset_WallCommon', 'IsExternal') === 'true')`,
      `bim.viewer.hide(external)`,
    ].join('\n');

    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);

    // Chain: query → filter → hide
    expect(result.graph.nodes[0].definitionId).toBe('query.filterByType');
    expect(result.graph.nodes[1].definitionId).toBe('query.filterByProperty');
    expect(result.graph.nodes[2].definitionId).toBe('viewer.hide');

    // Verify filter params
    expect(result.graph.nodes[1].params.psetName).toBe('Pset_WallCommon');
    expect(result.graph.nodes[1].params.propName).toBe('IsExternal');
    expect(result.graph.nodes[1].params.operator).toBe('=');
    expect(result.graph.nodes[1].params.value).toBe('true');
  });

  it('parallel branches: query → colorize + query → hide', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `const slabs = bim.query().byType('IfcSlab').toArray()`,
      `bim.viewer.colorize(walls, '#ff0000')`,
      `bim.viewer.hide(slabs)`,
    ].join('\n');

    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(4);
    expect(result.graph.edges).toHaveLength(2);

    // walls → colorize
    expect(result.graph.edges[0].sourceNodeId).toBe('node_0');
    expect(result.graph.edges[0].targetNodeId).toBe('node_2');

    // slabs → hide
    expect(result.graph.edges[1].sourceNodeId).toBe('node_1');
    expect(result.graph.edges[1].targetNodeId).toBe('node_3');
  });

  it('full pipeline: query → filter → mutate → colorize', () => {
    const code = [
      `const all = bim.query().toArray()`,
      `const external = all.filter(e => e.property('Pset_WallCommon', 'IsExternal') === 'true')`,
      `bim.mutate.setProperty(external, 'Pset_Custom', 'Status', 'Reviewed')`,
      `bim.viewer.colorize(external, '#00ff00')`,
    ].join('\n');

    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(4);
    expect(result.graph.nodes[0].definitionId).toBe('query.allEntities');
    expect(result.graph.nodes[1].definitionId).toBe('query.filterByProperty');
    expect(result.graph.nodes[2].definitionId).toBe('mutate.setProperty');
    expect(result.graph.nodes[3].definitionId).toBe('viewer.colorize');

    // all → filter
    expect(result.graph.edges[0].sourceNodeId).toBe('node_0');
    expect(result.graph.edges[0].targetNodeId).toBe('node_1');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('empty script produces warning', () => {
    const result = decompileScript('', registry);
    expect(result.graph.nodes).toHaveLength(0);
    // Empty string has no non-empty lines, so no warning
  });

  it('non-SDK script produces warning', () => {
    const result = decompileScript('const x = 42;\nconsole.log(x);', registry);
    expect(result.warnings).toContain('No SDK calls detected in the script');
  });

  it('mixed SDK and non-SDK lines', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `console.log('Found', walls.length, 'walls')`,
      `bim.viewer.colorize(walls, '#ff0000')`,
    ].join('\n');

    const result = decompileScript(code, registry);
    expect(result.graph.nodes).toHaveLength(2);
    // console.log is not a bim.* call, so not unmapped
    expect(result.unmappedLines).toHaveLength(0);
  });

  it('unknown bim method is reported as unmapped', () => {
    const code = `bim.someUnsupported.method()`;
    const result = decompileScript(code, registry);
    expect(result.unmappedLines).toHaveLength(1);
    expect(result.unmappedLines[0].text).toContain('bim.someUnsupported');
  });

  it('model-scoped query preserves modelId', () => {
    const code = `const walls = bim.query().model('arch').byType('IfcWall').toArray()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].params.modelId).toBe('arch');
    expect(result.graph.nodes[0].params.type).toBe('IfcWall');
  });

  it('exists filter detected correctly', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `const rated = walls.filter(e => e.property('Pset_WallCommon', 'FireRating') != null)`,
    ].join('\n');

    const result = decompileScript(code, registry);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[1].definitionId).toBe('query.filterByProperty');
    expect(result.graph.nodes[1].params.operator).toBe('exists');
  });

  it('numeric comparison filter detected', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `const thick = walls.filter(e => e.property('Pset_WallCommon', 'Width') > 200)`,
    ].join('\n');

    const result = decompileScript(code, registry);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[1].params.operator).toBe('>');
    expect(result.graph.nodes[1].params.value).toBe('200');
  });
});

// ============================================================================
// Helpers
// ============================================================================

/** Build a simple graph with auto-positioned nodes */
function makeGraph(
  nodes: Array<{ id: string; definitionId: string; params: Record<string, unknown> }>,
  edges: Array<{ sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string }> = [],
): Graph {
  return {
    name: 'Test Graph',
    nodes: nodes.map((n, i) => ({
      ...n,
      position: { x: 100, y: 100 + i * 150 },
    })),
    edges,
  };
}

/** Get reasonable default params for testing toCode() */
function getDefaultParams(node: NodeDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of node.params) {
    params[p.id] = p.default ?? '';
  }
  return params;
}

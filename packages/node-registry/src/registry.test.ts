/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry, getRegistry } from './registry.js';
import { getBuiltinNodes } from './index.js';
import { compileGraph } from './compiler.js';
import type { NodeDefinition, Graph } from './types.js';

function createTestNode(id: string, category: string = 'Query'): NodeDefinition {
  return {
    id,
    name: `Test ${id}`,
    category: category as NodeDefinition['category'],
    description: `Test node ${id}`,
    inputs: [],
    outputs: [{ id: 'out', name: 'Output', type: 'any', required: true }],
    params: [],
    execute: () => ({ out: 'test' }),
    toCode: () => `const out = 'test'`,
  };
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('registers and retrieves a node', () => {
    const node = createTestNode('test.node');
    registry.register(node);

    expect(registry.get('test.node')).toBe(node);
  });

  it('returns undefined for unknown node', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('getAll returns all registered nodes', () => {
    registry.register(createTestNode('a'));
    registry.register(createTestNode('b'));

    expect(registry.getAll()).toHaveLength(2);
  });

  it('getByCategory filters correctly', () => {
    registry.register(createTestNode('query.1', 'Query'));
    registry.register(createTestNode('viewer.1', 'Viewer'));
    registry.register(createTestNode('query.2', 'Query'));

    expect(registry.getByCategory('Query')).toHaveLength(2);
    expect(registry.getByCategory('Viewer')).toHaveLength(1);
    expect(registry.getByCategory('Export')).toHaveLength(0);
  });

  it('getCategories returns unique categories', () => {
    registry.register(createTestNode('a', 'Query'));
    registry.register(createTestNode('b', 'Viewer'));
    registry.register(createTestNode('c', 'Query'));

    const categories = registry.getCategories();
    expect(categories).toHaveLength(2);
    expect(categories).toContain('Query');
    expect(categories).toContain('Viewer');
  });

  it('unregister removes a node', () => {
    registry.register(createTestNode('test.node'));
    expect(registry.get('test.node')).toBeDefined();

    registry.unregister('test.node');
    expect(registry.get('test.node')).toBeUndefined();
  });

  it('clear removes all nodes', () => {
    registry.register(createTestNode('a'));
    registry.register(createTestNode('b'));
    registry.clear();

    expect(registry.getAll()).toHaveLength(0);
  });

  it('registerAll registers multiple nodes', () => {
    const nodes = [createTestNode('a'), createTestNode('b')];
    registry.registerAll(nodes);

    expect(registry.getAll()).toHaveLength(2);
  });
});

describe('getRegistry (singleton)', () => {
  it('returns the same instance', () => {
    const a = getRegistry();
    const b = getRegistry();
    expect(a).toBe(b);
  });
});

describe('getBuiltinNodes', () => {
  it('returns at least 15 built-in nodes', () => {
    const nodes = getBuiltinNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(15);
  });

  it('includes all expected categories', () => {
    const nodes = getBuiltinNodes();
    const categories = new Set(nodes.map(n => n.category));

    expect(categories.has('Query')).toBe(true);
    expect(categories.has('Viewer')).toBe(true);
    expect(categories.has('Data')).toBe(true);
    expect(categories.has('Export')).toBe(true);
    expect(categories.has('Mutation')).toBe(true);
    expect(categories.has('Validation')).toBe(true);
    expect(categories.has('Analysis')).toBe(true);
    expect(categories.has('Script')).toBe(true);
  });

  it('all nodes have toCode function', () => {
    const nodes = getBuiltinNodes();
    for (const node of nodes) {
      expect(typeof node.toCode).toBe('function');
    }
  });

  it('all nodes have execute function', () => {
    const nodes = getBuiltinNodes();
    for (const node of nodes) {
      expect(typeof node.execute).toBe('function');
    }
  });
});

describe('compileGraph', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.registerAll(getBuiltinNodes());
  });

  it('compiles a simple query → colorize graph', () => {
    const graph: Graph = {
      name: 'Test Graph',
      nodes: [
        {
          id: 'node-1',
          definitionId: 'query.allEntities',
          params: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'node-2',
          definitionId: 'viewer.colorize',
          params: { color: '#ff0000' },
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        {
          sourceNodeId: 'node-1',
          sourcePortId: 'entities',
          targetNodeId: 'node-2',
          targetPortId: 'entities',
        },
      ],
    };

    const result = compileGraph(graph, registry);

    expect(result.code).toContain('bim.query()');
    expect(result.code).toContain('#ff0000');
    expect(result.warnings).toHaveLength(0);
  });

  it('compiles an empty graph', () => {
    const graph: Graph = {
      name: 'Empty',
      nodes: [],
      edges: [],
    };

    const result = compileGraph(graph, registry);
    expect(result.code).toContain('Empty');
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about unknown node types', () => {
    const graph: Graph = {
      name: 'Unknown',
      nodes: [
        {
          id: 'node-1',
          definitionId: 'unknown.node',
          params: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };

    const result = compileGraph(graph, registry);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Unknown node type');
  });

  it('handles multi-node pipeline', () => {
    const graph: Graph = {
      name: 'Pipeline',
      nodes: [
        {
          id: 'n1',
          definitionId: 'query.allEntities',
          params: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'n2',
          definitionId: 'query.filterByType',
          params: { type: 'IfcWall' },
          position: { x: 200, y: 0 },
        },
        {
          id: 'n3',
          definitionId: 'viewer.colorize',
          params: { color: '#00ff00' },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { sourceNodeId: 'n1', sourcePortId: 'entities', targetNodeId: 'n2', targetPortId: 'entities' },
        { sourceNodeId: 'n2', sourcePortId: 'result', targetNodeId: 'n3', targetPortId: 'entities' },
      ],
    };

    const result = compileGraph(graph, registry);
    expect(result.code).toContain('IfcWall');
    expect(result.code).toContain('#00ff00');
    expect(result.warnings).toHaveLength(0);
  });
});

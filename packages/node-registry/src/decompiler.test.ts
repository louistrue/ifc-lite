/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeEach } from 'vitest';
import { decompileScript } from './decompiler.js';
import { NodeRegistry } from './registry.js';
import { getBuiltinNodes } from './index.js';

/** Create a fresh registry with all built-in nodes for each test */
let registry: NodeRegistry;

beforeEach(() => {
  registry = new NodeRegistry();
  registry.registerAll(getBuiltinNodes());
});

describe('decompileScript', () => {
  it('detects bim.query().byType().toArray()', () => {
    const code = `const walls = bim.query().byType('IfcWall').toArray()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('query.filterByType');
    expect(result.graph.nodes[0].params.type).toBe('IfcWall');
    expect(result.unmappedLines).toHaveLength(0);
  });

  it('detects bim.query().toArray() for all entities', () => {
    const code = `const all = bim.query().toArray()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('query.allEntities');
  });

  it('detects bim.query().model().byType().toArray()', () => {
    const code = `const walls = bim.query().model('arch').byType('IfcWall').toArray()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].params.modelId).toBe('arch');
    expect(result.graph.nodes[0].params.type).toBe('IfcWall');
  });

  it('detects viewer.colorize with hex color', () => {
    const code = `bim.viewer.colorize(walls, '#ff0000')`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('viewer.colorize');
    expect(result.graph.nodes[0].params.color).toBe('#ff0000');
  });

  it('detects viewer.hide', () => {
    const code = `bim.viewer.hide(walls)`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('viewer.hide');
  });

  it('builds edges between query and viewer calls', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `bim.viewer.colorize(walls, '#ff0000')`,
    ].join('\n');
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);

    const edge = result.graph.edges[0];
    expect(edge.sourceNodeId).toBe('node_0');
    expect(edge.targetNodeId).toBe('node_1');
  });

  it('handles a pipeline: query → filter → colorize', () => {
    const code = [
      `const walls = bim.query().byType('IfcWall').toArray()`,
      `const external = walls.filter(e => e.property('Pset_WallCommon', 'IsExternal') === 'true')`,
      `bim.viewer.colorize(external, '#ff0000')`,
    ].join('\n');
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);

    // First edge: query → filter
    expect(result.graph.edges[0].sourceNodeId).toBe('node_0');
    expect(result.graph.edges[0].targetNodeId).toBe('node_1');

    // Second edge: filter → colorize
    expect(result.graph.edges[1].sourceNodeId).toBe('node_1');
    expect(result.graph.edges[1].targetNodeId).toBe('node_2');
  });

  it('reports unmapped bim.* lines', () => {
    const code = `bim.someUnknownMethod()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(0);
    expect(result.unmappedLines).toHaveLength(1);
    expect(result.unmappedLines[0].text).toBe('bim.someUnknownMethod()');
  });

  it('skips comments and imports', () => {
    const code = [
      `// This is a comment`,
      `import { something } from 'somewhere'`,
      `/* block comment */`,
      `const walls = bim.query().byType('IfcWall').toArray()`,
    ].join('\n');
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.unmappedLines).toHaveLength(0);
  });

  it('warns when no SDK calls found', () => {
    const code = `const x = 42;\nconsole.log(x);`;
    const result = decompileScript(code, registry);

    expect(result.warnings).toContain('No SDK calls detected in the script');
  });

  it('warns about unresolved input variables', () => {
    const code = `bim.viewer.colorize(unknownVar, '#ff0000')`;
    const result = decompileScript(code, registry);

    expect(result.warnings.some(w => w.includes('unknownVar'))).toBe(true);
  });

  it('detects property filter with exists operator', () => {
    const code = `const withFire = walls.filter(e => e.property('Pset_WallCommon', 'FireRating') != null)`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('query.filterByProperty');
    expect(result.graph.nodes[0].params.operator).toBe('exists');
  });

  it('detects mutate.setProperty', () => {
    const code = `bim.mutate.setProperty(ref, 'Pset_Custom', 'Status', 'Approved')`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('mutate.setProperty');
    expect(result.graph.nodes[0].params.psetName).toBe('Pset_Custom');
    expect(result.graph.nodes[0].params.propName).toBe('Status');
    expect(result.graph.nodes[0].params.value).toBe('Approved');
  });

  it('detects export.csv', () => {
    const code = `const csv = bim.export.csv(walls, { columns: ['name', 'type'] })`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('export.csv');
    expect(result.graph.nodes[0].params.columns).toEqual(['name', 'type']);
  });

  it('uses custom graph name', () => {
    const code = `const walls = bim.query().byType('IfcWall').toArray()`;
    const result = decompileScript(code, registry, 'My Script');

    expect(result.graph.name).toBe('My Script');
  });

  it('detects spatial.queryBounds', () => {
    const code = `const nearby = bim.spatial.queryBounds('model-1', { min: [0,0,0], max: [10,10,10] })`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('spatial.queryBounds');
    expect(result.graph.nodes[0].params.modelId).toBe('model-1');
  });

  it('detects viewer.resetVisibility', () => {
    const code = `bim.viewer.resetVisibility()`;
    const result = decompileScript(code, registry);

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].definitionId).toBe('viewer.resetVisibility');
  });
});

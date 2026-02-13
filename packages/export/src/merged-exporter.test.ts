/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { MergedExporter, type MergeModelInput } from './merged-exporter.js';
import type { IfcDataStore } from '@ifc-lite/parser';

/**
 * Helper: build a minimal IfcDataStore from STEP entity lines.
 * Each entry is [expressId, type, stepText].
 */
function buildMockDataStore(
  entries: Array<[number, string, string]>,
): IfcDataStore {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const byId = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
  const byType = new Map<string, number[]>();
  let offset = 0;

  for (const [id, type, text] of entries) {
    const encoded = encoder.encode(text);
    byId.set(id, { expressId: id, type: type.toUpperCase(), byteOffset: offset, byteLength: encoded.byteLength, lineNumber: 0 });
    const upper = type.toUpperCase();
    if (!byType.has(upper)) byType.set(upper, []);
    byType.get(upper)!.push(id);
    parts.push(encoded);
    offset += encoded.byteLength;
  }

  const source = new Uint8Array(offset);
  let pos = 0;
  for (const part of parts) {
    source.set(part, pos);
    pos += part.byteLength;
  }

  return {
    fileSize: offset,
    schemaVersion: 'IFC4',
    entityCount: entries.length,
    parseTime: 0,
    source,
    entityIndex: { byId, byType },
  } as unknown as IfcDataStore;
}

function buildModel(id: string, name: string, entries: Array<[number, string, string]>): MergeModelInput {
  return { id, name, dataStore: buildMockDataStore(entries) };
}

describe('MergedExporter', () => {
  it('should export a single model unchanged', () => {
    const model = buildModel('m1', 'Model1', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'Project',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g2',$,'Site',$,$,$,$,$,$,$);"],
      [3, 'IFCWALL', "#3=IFCWALL('g3',#1,'Wall',$,$,$,$,$);"],
    ]);

    const exporter = new MergedExporter([model]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    expect(result.content).toContain('DATA;');
    expect(result.content).toContain('END-ISO-10303-21;');
    expect(result.content).toContain("#1=IFCPROJECT('g1'");
    expect(result.content).toContain("#3=IFCWALL('g3'");
    expect(result.stats.modelCount).toBe(1);
    expect(result.stats.totalEntityCount).toBe(3);
  });

  it('should remap IDs for second model to avoid collisions', () => {
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g2',$,'S',$,$,$,$,$,$,$);"],
      [3, 'IFCWALL', "#3=IFCWALL('g3',#1,'W',$,#2,$,$,$);"],
    ]);

    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g4',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCBUILDING', "#2=IFCBUILDING('g5',$,'B',$,$,$,$,$,$,$);"],
      [3, 'IFCCOLUMN', "#3=IFCCOLUMN('g6',#1,'C',$,#2,$,$,$);"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // First model entities should have original IDs (offset 0)
    expect(result.content).toContain("#1=IFCPROJECT('g1'");
    expect(result.content).toContain("#3=IFCWALL('g3'");

    // Second model entities should have remapped IDs (offset = maxId of model1 = 3)
    // So #1→#4, #2→#5, #3→#6
    // But IfcProject from model2 should be SKIPPED (entity not emitted)
    expect(result.content).not.toContain("#4=IFCPROJECT");

    // Building and Column should be remapped: #2→#5, #3→#6
    expect(result.content).toContain('#5=IFCBUILDING');
    expect(result.content).toContain('#6=IFCCOLUMN');

    // Column originally referenced #1 (project). After merge, that reference
    // should be remapped to #1 (first model's project), NOT #4 (offset)
    expect(result.content).toMatch(/#6=IFCCOLUMN\('g6',#1/);

    expect(result.stats.modelCount).toBe(2);
  });

  it('should handle visibility filtering per model in merged export', () => {
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCWALL', "#2=IFCWALL('g2',$,'W1',$,$,$,$,$);"],
      [3, 'IFCDOOR', "#3=IFCDOOR('g3',$,'D1',$,$,$,$,$);"],
    ]);

    const exporter = new MergedExporter([model1]);
    const result = exporter.export({
      schema: 'IFC4',
      projectStrategy: 'keep-first',
      visibleOnly: true,
      hiddenEntityIdsByModel: new Map([['m1', new Set([3])]]), // Hide door
    });

    expect(result.content).toContain("#1=IFCPROJECT"); // infrastructure always included
    expect(result.content).toContain("#2=IFCWALL");    // visible wall
    expect(result.content).not.toContain("#3=IFCDOOR"); // hidden door
  });

  it('should preserve spatial chain by remapping project references', () => {
    // Model1: Project#1 → (via RelAggregates#3) → Site#2
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g2',$,'S',$,$,$,$,$,$,$);"],
      [3, 'IFCRELAGGREGATES', "#3=IFCRELAGGREGATES('r1',$,$,$,#1,(#2));"],
    ]);

    // Model2: Project#1 → (via RelAggregates#4) → Site#2 → (via RelAggregates#5) → Building#3
    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g3',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g4',$,'S2',$,$,$,$,$,$,$);"],
      [3, 'IFCBUILDING', "#3=IFCBUILDING('g5',$,'B',$,$,$,$,$,$,$);"],
      [4, 'IFCRELAGGREGATES', "#4=IFCRELAGGREGATES('r2',$,$,$,#1,(#2));"],
      [5, 'IFCRELAGGREGATES', "#5=IFCRELAGGREGATES('r3',$,$,$,#2,(#3));"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Model2's IfcProject entity should NOT be in the output
    expect(result.content).not.toContain("IFCPROJECT('g3'");

    // Model2's RelAggregates linking Project→Site should be remapped:
    // Original: #4=IFCRELAGGREGATES('r2',$,$,$,#1,(#2))
    // After offset (3): #7=IFCRELAGGREGATES('r2',$,$,$,#1,(#5))
    //   #1 (project) → remapped to #1 (first model's project, NOT #4)
    //   #2 (site) → #5 (offset by 3)
    // This connects Model2's Site to Model1's Project
    expect(result.content).toMatch(/#7=IFCRELAGGREGATES\('r2',\$,\$,\$,#1,\(#5\)\)/);

    // Model2's RelAggregates linking Site→Building should be remapped:
    // #8=IFCRELAGGREGATES('r3',$,$,$,#5,(#6))
    expect(result.content).toMatch(/#8=IFCRELAGGREGATES\('r3',\$,\$,\$,#5,\(#6\)\)/);

    // Both models' sites should exist
    expect(result.content).toContain("#2=IFCSITE('g2'"); // model1 site
    expect(result.content).toContain("#5=IFCSITE('g4'"); // model2 site (remapped)

    // Model2 building should exist
    expect(result.content).toContain("#6=IFCBUILDING('g5'");
  });

  it('should throw if no models provided', () => {
    expect(() => new MergedExporter([])).toThrow('at least one model');
  });

  it('should produce valid STEP structure', () => {
    const model = buildModel('m1', 'Test', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g',$,'P',$,$,$,$,$,$);"],
    ]);

    const exporter = new MergedExporter([model]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Valid STEP file structure
    expect(result.content).toContain('ISO-10303-21;');
    expect(result.content).toContain('HEADER;');
    expect(result.content).toContain('DATA;');
    expect(result.content).toContain('ENDSEC;');
    expect(result.content).toContain('END-ISO-10303-21;');
  });
});

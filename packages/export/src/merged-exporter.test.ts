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

  it('should unify single site and remap spatial chain', () => {
    // Model1: Project#1 → Site#2 (via RelAgg#3)
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g2',$,'S',$,$,$,$,$,$,$);"],
      [3, 'IFCRELAGGREGATES', "#3=IFCRELAGGREGATES('r1',$,$,$,#1,(#2));"],
    ]);

    // Model2: Project#1 → Site#2 → Building#3
    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g3',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCSITE', "#2=IFCSITE('g4',$,'S2',$,$,$,$,$,$,$);"],
      [3, 'IFCBUILDING', "#3=IFCBUILDING('g5',$,'B',$,$,$,$,$,$,$);"],
      [4, 'IFCRELAGGREGATES', "#4=IFCRELAGGREGATES('r2',$,$,$,#1,(#2));"],
      [5, 'IFCRELAGGREGATES', "#5=IFCRELAGGREGATES('r3',$,$,$,#2,(#3));"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Project and Site from model2 should be unified (single instance each)
    expect(result.content).not.toContain("IFCPROJECT('g3'");
    expect(result.content).not.toContain("IFCSITE('g4'");

    // Model2's RelAgg Project→Site: fully redundant (both project and site
    // remapped to model1's) — should be SKIPPED to avoid duplicate tree nodes
    expect(result.content).not.toContain("IFCRELAGGREGATES('r2'");

    // Model2's RelAgg Site→Building: NOT redundant (building is new, not remapped)
    // site→#2 (unified), building→#6 (offset). Entity #5+offset(3)=#8
    expect(result.content).toMatch(/#8=IFCRELAGGREGATES\('r3',\$,\$,\$,#2,\(#6\)\)/);

    // Model2's building is kept (no building in model1 to match)
    expect(result.content).toContain("#6=IFCBUILDING('g5'");
  });

  it('should unify storeys with matching names', () => {
    // Model1: maxId=4, offset=0
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g2',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g3',$,'First Floor',$,$,$,$,$,.ELEMENT.,3000.);"],
      [4, 'IFCWALL', "#4=IFCWALL('g4',$,'W1',$,#2,$,$,$);"],
    ]);

    // Model2: offset=4
    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g5',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g6',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g7',$,'First Floor',$,$,$,$,$,.ELEMENT.,3000.);"],
      [4, 'IFCCOLUMN', "#4=IFCCOLUMN('g8',$,'C1',$,#2,$,$,$);"],
      [5, 'IFCRELCONTAINEDINSPATIALSTRUCTURE', "#5=IFCRELCONTAINEDINSPATIALSTRUCTURE('r1',$,$,$,(#4),#2);"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Both storeys should be unified (same names)
    expect(result.content).not.toContain("IFCBUILDINGSTOREY('g6'");
    expect(result.content).not.toContain("IFCBUILDINGSTOREY('g7'");

    // Column from model2: #4→#8 (offset), references #2(storey)→#2 (unified)
    expect(result.content).toMatch(/#8=IFCCOLUMN\('g8',\$,'C1',\$,#2/);

    // RelContained: (#4→#8), #2→#2 (unified storey)
    expect(result.content).toMatch(/#9=IFCRELCONTAINEDINSPATIALSTRUCTURE\('r1',\$,\$,\$,\(#8\),#2\)/);
  });

  it('should unify storeys by elevation when names differ', () => {
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g2',$,'EG',$,$,$,$,$,.ELEMENT.,0.);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g3',$,'OG1',$,$,$,$,$,.ELEMENT.,3000.);"],
    ]);

    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g4',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g5',$,'Ground',$,$,$,$,$,.ELEMENT.,0.);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g6',$,'Level 1',$,$,$,$,$,.ELEMENT.,3000.);"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Names differ but elevations match → storeys should be unified
    expect(result.content).not.toContain("IFCBUILDINGSTOREY('g5'");
    expect(result.content).not.toContain("IFCBUILDINGSTOREY('g6'");

    // First model's storeys are preserved
    expect(result.content).toContain("IFCBUILDINGSTOREY('g2'");
    expect(result.content).toContain("IFCBUILDINGSTOREY('g3'");
  });

  it('should keep unmatched storeys as separate entities', () => {
    // Model1: maxId=2, offset=0
    const model1 = buildModel('m1', 'Arch', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g1',$,'P',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g2',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.);"],
    ]);

    // Model2: offset=2
    const model2 = buildModel('m2', 'Struct', [
      [1, 'IFCPROJECT', "#1=IFCPROJECT('g3',$,'P2',$,$,$,$,$,$);"],
      [2, 'IFCBUILDINGSTOREY', "#2=IFCBUILDINGSTOREY('g4',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g5',$,'Roof',$,$,$,$,$,.ELEMENT.,9000.);"],
    ]);

    const exporter = new MergedExporter([model1, model2]);
    const result = exporter.export({ schema: 'IFC4', projectStrategy: 'keep-first' });

    // Ground Floor should be unified
    expect(result.content).not.toContain("IFCBUILDINGSTOREY('g4'");

    // Roof has no match in model1 → kept as new entity (#3+2=#5)
    expect(result.content).toContain("#5=IFCBUILDINGSTOREY('g5'");
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { collectReferencedEntityIds, getVisibleEntityIds } from './reference-collector.js';
import type { IfcDataStore } from '@ifc-lite/parser';

/**
 * Helper: encode a set of STEP entity lines into a source buffer + entity index.
 * Each entry is [expressId, type, stepText].
 */
function buildTestData(
  entries: Array<[number, string, string]>,
): { source: Uint8Array; entityIndex: Map<number, { type: string; byteOffset: number; byteLength: number }> } {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entityIndex = new Map<number, { type: string; byteOffset: number; byteLength: number }>();
  let offset = 0;

  for (const [id, type, text] of entries) {
    const encoded = encoder.encode(text);
    entityIndex.set(id, { type, byteOffset: offset, byteLength: encoded.byteLength });
    parts.push(encoded);
    offset += encoded.byteLength;
  }

  // Concatenate all parts
  const source = new Uint8Array(offset);
  let pos = 0;
  for (const part of parts) {
    source.set(part, pos);
    pos += part.byteLength;
  }

  return { source, entityIndex };
}

describe('collectReferencedEntityIds', () => {
  it('should collect direct references from a root entity', () => {
    const { source, entityIndex } = buildTestData([
      [1, 'IFCWALL', "#1=IFCWALL('guid',#2,'Wall',$,#3,#4,$,$);"],
      [2, 'IFCOWNERHISTORY', "#2=IFCOWNERHISTORY(#5,$,$,$);"],
      [3, 'IFCLOCALPLACEMENT', "#3=IFCLOCALPLACEMENT($,#6);"],
      [4, 'IFCPRODUCTDEFINITIONSHAPE', "#4=IFCPRODUCTDEFINITIONSHAPE($,$,(#7));"],
      [5, 'IFCPERSONANDORGANIZATION', "#5=IFCPERSONANDORGANIZATION(#8,#9);"],
      [6, 'IFCAXIS2PLACEMENT3D', "#6=IFCAXIS2PLACEMENT3D(#10,$,$);"],
      [7, 'IFCSHAPEREPRESENTATION', "#7=IFCSHAPEREPRESENTATION(#11,'Body','Brep',(#12));"],
      [8, 'IFCPERSON', "#8=IFCPERSON($,'Author',$,$,$,$,$,$);"],
      [9, 'IFCORGANIZATION', "#9=IFCORGANIZATION($,'Org',$,$,$);"],
      [10, 'IFCCARTESIANPOINT', '#10=IFCCARTESIANPOINT((0.,0.,0.));'],
      [11, 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT', "#11=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#13,$,.MODEL_VIEW.,$);"],
      [12, 'IFCEXTRUDEDAREASOLID', '#12=IFCEXTRUDEDAREASOLID(#14,#15,#16,2.5);'],
      [13, 'IFCGEOMETRICREPRESENTATIONCONTEXT', "#13=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#17,$);"],
      [14, 'IFCRECTANGLEPROFILEDEF', "#14=IFCRECTANGLEPROFILEDEF(.AREA.,$,#18,0.2,5.0);"],
      [15, 'IFCAXIS2PLACEMENT3D', '#15=IFCAXIS2PLACEMENT3D(#10,$,$);'],
      [16, 'IFCDIRECTION', '#16=IFCDIRECTION((0.,0.,1.));'],
      [17, 'IFCAXIS2PLACEMENT3D', '#17=IFCAXIS2PLACEMENT3D(#10,$,$);'],
      [18, 'IFCAXIS2PLACEMENT2D', '#18=IFCAXIS2PLACEMENT2D(#19,$);'],
      [19, 'IFCCARTESIANPOINT', '#19=IFCCARTESIANPOINT((0.,0.));'],
    ]);

    const closure = collectReferencedEntityIds(
      new Set([1]),
      source,
      entityIndex,
    );

    // Should include wall and all transitive references
    expect(closure.has(1)).toBe(true);   // root: IFCWALL
    expect(closure.has(2)).toBe(true);   // IFCOWNERHISTORY
    expect(closure.has(3)).toBe(true);   // IFCLOCALPLACEMENT
    expect(closure.has(4)).toBe(true);   // IFCPRODUCTDEFINITIONSHAPE
    expect(closure.has(5)).toBe(true);   // IFCPERSONANDORGANIZATION
    expect(closure.has(6)).toBe(true);   // IFCAXIS2PLACEMENT3D
    expect(closure.has(7)).toBe(true);   // IFCSHAPEREPRESENTATION
    expect(closure.has(10)).toBe(true);  // IFCCARTESIANPOINT (shared)
    expect(closure.has(12)).toBe(true);  // IFCEXTRUDEDAREASOLID
    expect(closure.has(13)).toBe(true);  // IFCGEOMETRICREPRESENTATIONCONTEXT
    expect(closure.has(19)).toBe(true);  // IFCCARTESIANPOINT (leaf)
    expect(closure.size).toBe(19);       // All entities reachable from wall
  });

  it('should handle multiple roots', () => {
    const { source, entityIndex } = buildTestData([
      [1, 'IFCWALL', "#1=IFCWALL('g1',#3,'W1',$,$,$,$,$);"],
      [2, 'IFCDOOR', "#2=IFCDOOR('g2',#3,'D1',$,$,$,$,$);"],
      [3, 'IFCOWNERHISTORY', '#3=IFCOWNERHISTORY($,$,$,$);'],
      [4, 'IFCSLAB', "#4=IFCSLAB('g3',#3,'S1',$,$,$,$,$);"],
    ]);

    const closure = collectReferencedEntityIds(
      new Set([1, 2]),
      source,
      entityIndex,
    );

    expect(closure.has(1)).toBe(true);   // root: wall
    expect(closure.has(2)).toBe(true);   // root: door
    expect(closure.has(3)).toBe(true);   // shared owner history
    expect(closure.has(4)).toBe(false);  // slab not reachable from roots
    expect(closure.size).toBe(3);
  });

  it('should handle circular references without infinite loop', () => {
    const { source, entityIndex } = buildTestData([
      [1, 'IFCRELCONTAINEDINSPATIALSTRUCTURE', "#1=IFCRELCONTAINEDINSPATIALSTRUCTURE('g',$,$,$,(#2),#3);"],
      [2, 'IFCWALL', "#2=IFCWALL('g',#4,'W',$,#5,$,$,$);"],
      [3, 'IFCBUILDINGSTOREY', "#3=IFCBUILDINGSTOREY('g',#4,'S',$,$,$,$,$,$,$);"],
      [4, 'IFCOWNERHISTORY', '#4=IFCOWNERHISTORY(#1,$,$,$);'], // circular: references #1
      [5, 'IFCLOCALPLACEMENT', '#5=IFCLOCALPLACEMENT($,$);'],
    ]);

    const closure = collectReferencedEntityIds(
      new Set([1]),
      source,
      entityIndex,
    );

    // Should complete without infinite loop
    expect(closure.has(1)).toBe(true);
    expect(closure.has(2)).toBe(true);
    expect(closure.has(3)).toBe(true);
    expect(closure.has(4)).toBe(true);
    expect(closure.has(5)).toBe(true);
    expect(closure.size).toBe(5);
  });

  it('should handle empty root set', () => {
    const { source, entityIndex } = buildTestData([
      [1, 'IFCWALL', "#1=IFCWALL('g',$,'W',$,$,$,$,$);"],
    ]);

    const closure = collectReferencedEntityIds(
      new Set(),
      source,
      entityIndex,
    );

    expect(closure.size).toBe(0);
  });

  it('should skip references to non-existent entities', () => {
    const { source, entityIndex } = buildTestData([
      [1, 'IFCWALL', "#1=IFCWALL('g',#999,'W',$,$,$,$,$);"],
    ]);

    const closure = collectReferencedEntityIds(
      new Set([1]),
      source,
      entityIndex,
    );

    expect(closure.has(1)).toBe(true);
    expect(closure.has(999)).toBe(false); // Not in entity index
    expect(closure.size).toBe(1);
  });
});

describe('getVisibleEntityIds', () => {
  function createMockDataStore(
    entries: Array<[number, string]>,
  ): IfcDataStore {
    const byId = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
    const byType = new Map<string, number[]>();

    for (const [id, type] of entries) {
      byId.set(id, { expressId: id, type, byteOffset: 0, byteLength: 0, lineNumber: 0 });
      const upper = type.toUpperCase();
      if (!byType.has(upper)) byType.set(upper, []);
      byType.get(upper)!.push(id);
    }

    return {
      entityIndex: { byId, byType },
      source: new Uint8Array(0),
    } as unknown as IfcDataStore;
  }

  it('should include all entities when nothing is hidden', () => {
    const store = createMockDataStore([
      [1, 'IFCPROJECT'],
      [2, 'IFCSITE'],
      [3, 'IFCBUILDING'],
      [4, 'IFCBUILDINGSTOREY'],
      [5, 'IFCWALL'],
      [6, 'IFCDOOR'],
      [7, 'IFCOWNERHISTORY'],
    ]);

    const visible = getVisibleEntityIds(store, new Set(), null);

    expect(visible.size).toBe(7);
  });

  it('should exclude hidden entities', () => {
    const store = createMockDataStore([
      [1, 'IFCPROJECT'],
      [5, 'IFCWALL'],
      [6, 'IFCDOOR'],
      [7, 'IFCWINDOW'],
    ]);

    const visible = getVisibleEntityIds(store, new Set([5, 7]), null);

    expect(visible.has(1)).toBe(true);   // spatial structure, always included
    expect(visible.has(5)).toBe(false);  // hidden wall
    expect(visible.has(6)).toBe(true);   // visible door
    expect(visible.has(7)).toBe(false);  // hidden window
  });

  it('should respect isolation (only isolated entities visible)', () => {
    const store = createMockDataStore([
      [1, 'IFCPROJECT'],
      [2, 'IFCOWNERHISTORY'],
      [5, 'IFCWALL'],
      [6, 'IFCDOOR'],
      [7, 'IFCWINDOW'],
    ]);

    const visible = getVisibleEntityIds(store, new Set(), new Set([5]));

    expect(visible.has(1)).toBe(true);   // spatial structure, always included
    expect(visible.has(2)).toBe(true);   // infrastructure, always included
    expect(visible.has(5)).toBe(true);   // isolated wall
    expect(visible.has(6)).toBe(false);  // not in isolated set
    expect(visible.has(7)).toBe(false);  // not in isolated set
  });

  it('should always include spatial structure and infrastructure', () => {
    const store = createMockDataStore([
      [1, 'IFCPROJECT'],
      [2, 'IFCSITE'],
      [3, 'IFCBUILDING'],
      [4, 'IFCBUILDINGSTOREY'],
      [5, 'IFCOWNERHISTORY'],
      [6, 'IFCAPPLICATION'],
      [7, 'IFCGEOMETRICREPRESENTATIONCONTEXT'],
      [8, 'IFCUNITASSIGNMENT'],
      [9, 'IFCSIUNIT'],
      [10, 'IFCWALL'],
    ]);

    // Hide the wall and isolate nothing visible
    const visible = getVisibleEntityIds(store, new Set([10]), null);

    // All infrastructure and spatial structure must be present
    expect(visible.has(1)).toBe(true);   // IFCPROJECT
    expect(visible.has(2)).toBe(true);   // IFCSITE
    expect(visible.has(3)).toBe(true);   // IFCBUILDING
    expect(visible.has(4)).toBe(true);   // IFCBUILDINGSTOREY
    expect(visible.has(5)).toBe(true);   // IFCOWNERHISTORY
    expect(visible.has(6)).toBe(true);   // IFCAPPLICATION
    expect(visible.has(7)).toBe(true);   // IFCGEOMETRICREPRESENTATIONCONTEXT
    expect(visible.has(8)).toBe(true);   // IFCUNITASSIGNMENT
    expect(visible.has(9)).toBe(true);   // IFCSIUNIT
    expect(visible.has(10)).toBe(false); // hidden wall
  });
});

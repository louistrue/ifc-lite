/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { StepExporter } from './step-exporter.js';

function buildMockDataStore(entries: Array<[number, string, string]>): IfcDataStore {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const byId = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
  const byType = new Map<string, number[]>();
  let offset = 0;

  for (const [id, type, text] of entries) {
    const encoded = encoder.encode(text);
    byId.set(id, { expressId: id, type: type.toUpperCase(), byteOffset: offset, byteLength: encoded.byteLength, lineNumber: 0 });
    if (!byType.has(type.toUpperCase())) {
      byType.set(type.toUpperCase(), []);
    }
    byType.get(type.toUpperCase())!.push(id);
    parts.push(encoded);
    offset += encoded.byteLength;
  }

  const source = new Uint8Array(offset);
  let position = 0;
  for (const part of parts) {
    source.set(part, position);
    position += part.byteLength;
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

describe('StepExporter', () => {
  it('rewrites root attributes on exported STEP entities', () => {
    const dataStore = buildMockDataStore([
      [1, 'IFCCOLUMN', "#1=IFCCOLUMN('g',$,'Old Name','Old Description','Old Type',$,$,'OLD-TAG',.COLUMN.);"],
    ]);
    const mutationView = new MutablePropertyView(null, 'model-1');
    mutationView.setAttribute(1, 'Name', 'Updated Name');
    mutationView.setAttribute(1, 'Description', '');
    mutationView.setAttribute(1, 'ObjectType', 'CSV Type');
    mutationView.setAttribute(1, 'Tag', 'CSV-TAG');
    mutationView.setAttribute(1, 'PredefinedType', 'USERDEFINED');

    const exporter = new StepExporter(dataStore, mutationView);
    const result = exporter.export({
      schema: 'IFC4',
      includeGeometry: true,
      includeProperties: true,
      includeQuantities: true,
      includeRelationships: true,
      applyMutations: true,
    });

    expect(result.content).toContain(
      "#1=IFCCOLUMN('g',$,'Updated Name',$,'CSV Type',$,$,'CSV-TAG',.USERDEFINED.);",
    );
    expect(result.stats.modifiedEntityCount).toBe(1);
  });
});

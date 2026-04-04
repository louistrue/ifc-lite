/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EntityTable } from '../src/entity-table.js';
import type { IfcEntity, EntityIndex } from '@ifc-lite/parser';

function makeEntity(expressId: number, type: string, attrs: any[] = []): IfcEntity {
  return { expressId, type, attributes: attrs };
}

function makeIndex(entities: IfcEntity[]): EntityIndex {
  const byId = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
  const byType = new Map<string, number[]>();

  for (const e of entities) {
    byId.set(e.expressId, { expressId: e.expressId, type: e.type, byteOffset: 0, byteLength: 0, lineNumber: 0 });
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e.expressId);
  }

  return { byId, byType };
}

describe('EntityTable', () => {
  const wall1 = makeEntity(1, 'IFCWALL', ['abc123', 'Wall-A']);
  const wall2 = makeEntity(2, 'IFCWALL', ['def456', 'Wall-B']);
  const door1 = makeEntity(3, 'IFCDOOR', ['ghi789', 'Door-A']);

  const allEntities = [wall1, wall2, door1];
  const entityMap = new Map(allEntities.map(e => [e.expressId, e]));
  const index = makeIndex(allEntities);

  function makeTable(): EntityTable {
    return new EntityTable(entityMap, index);
  }

  // ── getEntity ─────────────────────────────────────────────────

  it('should return an entity by its expressId', () => {
    const table = makeTable();
    const entity = table.getEntity(1);
    expect(entity).not.toBeNull();
    expect(entity!.expressId).toBe(1);
    expect(entity!.type).toBe('IFCWALL');
  });

  it('should return null for a non-existent expressId', () => {
    const table = makeTable();
    expect(table.getEntity(999)).toBeNull();
  });

  // ── getEntitiesByType ─────────────────────────────────────────

  it('should return all entities of a given type', () => {
    const table = makeTable();
    const walls = table.getEntitiesByType('IFCWALL');
    expect(walls).toHaveLength(2);
    expect(walls.map(w => w.expressId).sort()).toEqual([1, 2]);
  });

  it('should return empty array for a type with no entities', () => {
    const table = makeTable();
    const beams = table.getEntitiesByType('IFCBEAM');
    expect(beams).toEqual([]);
  });

  // ── hasEntity ─────────────────────────────────────────────────

  it('should report true for existing entity', () => {
    const table = makeTable();
    expect(table.hasEntity(1)).toBe(true);
    expect(table.hasEntity(3)).toBe(true);
  });

  it('should report false for non-existent entity', () => {
    const table = makeTable();
    expect(table.hasEntity(999)).toBe(false);
  });

  // ── getAllEntities ────────────────────────────────────────────

  it('should return all entities', () => {
    const table = makeTable();
    const all = table.getAllEntities();
    expect(all).toHaveLength(3);
    expect(new Set(all.map(e => e.expressId))).toEqual(new Set([1, 2, 3]));
  });

  it('should return empty array for empty table', () => {
    const emptyTable = new EntityTable(new Map(), { byId: new Map(), byType: new Map() });
    expect(emptyTable.getAllEntities()).toEqual([]);
  });
});

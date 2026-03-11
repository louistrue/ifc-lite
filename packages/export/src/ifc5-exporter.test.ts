/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { Ifc5Exporter } from './ifc5-exporter.js';
import {
  StringTable,
  EntityTableBuilder,
  PropertyTableBuilder,
  RelationshipGraphBuilder,
  PropertyValueType,
} from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';

/**
 * Build a minimal IfcDataStore with the given entities for testing.
 */
function buildMinimalDataStore(
  entities: Array<{
    expressId: number;
    type: string;
    globalId?: string;
    name?: string;
    description?: string;
  }>,
): IfcDataStore {
  const strings = new StringTable();
  const entityBuilder = new EntityTableBuilder(entities.length, strings);

  for (const e of entities) {
    entityBuilder.add(
      e.expressId,
      e.type,
      e.globalId ?? '',
      e.name ?? '',
      e.description ?? '',
      '',
    );
  }

  const propertyBuilder = new PropertyTableBuilder(strings);
  const relBuilder = new RelationshipGraphBuilder();

  return {
    fileSize: 0,
    schemaVersion: 'IFC4',
    entityCount: entities.length,
    parseTime: 0,
    source: new Uint8Array(0),
    entityIndex: { byId: new Map(), byType: new Map() },
    strings,
    entities: entityBuilder.build(),
    properties: propertyBuilder.build(),
    quantities: { count: 0, entityId: new Uint32Array(0), qsetName: new Uint32Array(0), quantityName: new Uint32Array(0), quantityType: new Uint8Array(0), value: new Float64Array(0), getForEntity: () => [] } as any,
    relationships: relBuilder.build(),
  } as unknown as IfcDataStore;
}

describe('Ifc5Exporter', () => {
  describe('imports', () => {
    it('includes IFC core import when bsi::ifc::class attributes are present', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'TestWall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      expect(file.imports).toEqual(
        expect.arrayContaining([
          { uri: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx' },
        ]),
      );
    });

    it('includes IFC prop import when properties are present', () => {
      const strings = new StringTable();
      const entityBuilder = new EntityTableBuilder(1, strings);
      entityBuilder.add(1, 'IFCWALL', 'abc', 'Wall', '', '');

      const propertyBuilder = new PropertyTableBuilder(strings);
      propertyBuilder.add({
        entityId: 1,
        psetName: 'Pset_WallCommon',
        propName: 'IsExternal',
        value: true,
        type: PropertyValueType.Boolean,
      });

      const relBuilder = new RelationshipGraphBuilder();

      const dataStore = {
        fileSize: 0,
        schemaVersion: 'IFC4',
        entityCount: 1,
        parseTime: 0,
        source: new Uint8Array(0),
        entityIndex: { byId: new Map(), byType: new Map() },
        strings,
        entities: entityBuilder.build(),
        properties: propertyBuilder.build(),
        quantities: { count: 0, entityId: new Uint32Array(0), qsetName: new Uint32Array(0), quantityName: new Uint32Array(0), quantityType: new Uint8Array(0), value: new Float64Array(0), getForEntity: () => [] } as any,
        relationships: relBuilder.build(),
      } as unknown as IfcDataStore;

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false });
      const file = JSON.parse(result.content);

      expect(file.imports).toEqual(
        expect.arrayContaining([
          { uri: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx' },
        ]),
      );
    });

    it('includes USD import when geometry is present', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'TestWall' },
      ]);

      const meshes = [{
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0] as [number, number, number, number],
      }];

      const geometryResult = { meshes } as any;

      const exporter = new Ifc5Exporter(dataStore, geometryResult);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      expect(file.imports).toEqual(
        expect.arrayContaining([
          { uri: 'https://ifcx.dev/@openusd.org/usd@v1.ifcx' },
        ]),
      );
    });

    it('does not include USD import when geometry is excluded', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'TestWall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const usdImport = file.imports.find(
        (i: { uri: string }) => i.uri.includes('openusd.org'),
      );
      expect(usdImport).toBeUndefined();
    });

    it('imports format matches real IFC5 files (objects with uri)', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'Wall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      for (const imp of file.imports) {
        expect(imp).toHaveProperty('uri');
        expect(typeof imp.uri).toBe('string');
        expect(imp.uri).toMatch(/^https:\/\//);
      }
    });
  });

  describe('output structure', () => {
    it('produces valid IFCX structure with header, imports, schemas, data', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'TestWall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false });
      const file = JSON.parse(result.content);

      expect(file).toHaveProperty('header');
      expect(file).toHaveProperty('imports');
      expect(file).toHaveProperty('schemas');
      expect(file).toHaveProperty('data');
      expect(file.header.ifcxVersion).toBe('IFCX-1.0');
      expect(Array.isArray(file.imports)).toBe(true);
      expect(Array.isArray(file.data)).toBe(true);
    });

    it('sets bsi::ifc::class attribute on entities', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'TestWall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const node = file.data[0];
      expect(node.attributes['bsi::ifc::class']).toBeDefined();
      expect(node.attributes['bsi::ifc::class']).toHaveProperty('code');
    });
  });
});

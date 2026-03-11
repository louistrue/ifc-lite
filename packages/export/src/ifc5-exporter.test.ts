/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Ifc5Exporter } from './ifc5-exporter.js';
import {
  StringTable,
  EntityTableBuilder,
  PropertyTableBuilder,
  RelationshipGraphBuilder,
  PropertyValueType,
} from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import {
  ALL_OFFICIAL_SCHEMAS,
  STANDARD_IMPORT_URIS,
  validateIfcxFile,
  validateValue,
} from './__fixtures__/ifc5-official-schemas.js';

// ============================================================================
// Reference file helpers
// ============================================================================

const MODELS_DIR = resolve(__dirname, '../../../tests/models/ifc5');

function loadReferenceFile(filename: string): any {
  return JSON.parse(readFileSync(resolve(MODELS_DIR, filename), 'utf-8'));
}

// ============================================================================
// Test data builder
// ============================================================================

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
    entityBuilder.add(e.expressId, e.type, e.globalId ?? '', e.name ?? '', e.description ?? '', '');
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

function makeMockMeshes(expressId: number) {
  return [{
    expressId,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    color: [0.8, 0.6, 0.4, 0.9] as [number, number, number, number],
  }];
}

// ============================================================================
// Official schema validation tests
// ============================================================================

describe('Ifc5Exporter', () => {
  describe('official schema validation', () => {
    it('export with geometry + properties produces zero validation errors against official schemas', () => {
      const strings = new StringTable();
      const entityBuilder = new EntityTableBuilder(1, strings);
      entityBuilder.add(1, 'IFCWALL', 'abc-123', 'TestWall', 'A test wall', '');

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
        fileSize: 0, schemaVersion: 'IFC4', entityCount: 1, parseTime: 0,
        source: new Uint8Array(0),
        entityIndex: { byId: new Map(), byType: new Map() },
        strings,
        entities: entityBuilder.build(),
        properties: propertyBuilder.build(),
        quantities: { count: 0, entityId: new Uint32Array(0), qsetName: new Uint32Array(0), quantityName: new Uint32Array(0), quantityType: new Uint8Array(0), value: new Float64Array(0), getForEntity: () => [] } as any,
        relationships: relBuilder.build(),
      } as unknown as IfcDataStore;

      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      const errors = validateIfcxFile(file);
      expect(errors).toEqual([]);
    });

    it('export without geometry produces zero validation errors', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const errors = validateIfcxFile(file);
      expect(errors).toEqual([]);
    });

    it('every attribute key in export output has a matching official schema', () => {
      const strings = new StringTable();
      const entityBuilder = new EntityTableBuilder(1, strings);
      entityBuilder.add(1, 'IFCWALL', 'abc', 'Wall', 'desc', '');
      const propertyBuilder = new PropertyTableBuilder(strings);
      propertyBuilder.add({
        entityId: 1, psetName: 'Pset_WallCommon', propName: 'IsExternal',
        value: true, type: PropertyValueType.Boolean,
      });
      const relBuilder = new RelationshipGraphBuilder();
      const dataStore = {
        fileSize: 0, schemaVersion: 'IFC4', entityCount: 1, parseTime: 0,
        source: new Uint8Array(0),
        entityIndex: { byId: new Map(), byType: new Map() },
        strings, entities: entityBuilder.build(),
        properties: propertyBuilder.build(),
        quantities: { count: 0, entityId: new Uint32Array(0), qsetName: new Uint32Array(0), quantityName: new Uint32Array(0), quantityType: new Uint8Array(0), value: new Float64Array(0), getForEntity: () => [] } as any,
        relationships: relBuilder.build(),
      } as unknown as IfcDataStore;

      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      // Collect every attribute key used in the export
      const usedKeys = new Set<string>();
      for (const node of file.data) {
        for (const key of Object.keys(node.attributes ?? {})) {
          usedKeys.add(key);
        }
      }

      // Every key must either be in the official schemas or follow the
      // bsi::ifc::prop:: pattern (custom properties are allowed by spec)
      const unknownKeys: string[] = [];
      for (const key of usedKeys) {
        if (ALL_OFFICIAL_SCHEMAS[key]) continue;
        // Custom properties under bsi::ifc::prop:: are allowed
        if (key.startsWith('bsi::ifc::prop::')) continue;
        unknownKeys.push(key);
      }

      expect(unknownKeys).toEqual([]);
    });

    it('does NOT use deprecated bsi::ifc::globalId attribute', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'some-guid', name: 'Wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false });
      const file = JSON.parse(result.content);

      for (const node of file.data) {
        expect(node.attributes?.['bsi::ifc::globalId']).toBeUndefined();
        expect(node.attributes?.['bsi::ifc::name']).toBeUndefined();
        expect(node.attributes?.['bsi::ifc::description']).toBeUndefined();
      }
    });

    it('uses bsi::ifc::prop::Name and bsi::ifc::prop::Description instead', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'MyWall', description: 'A wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const node = file.data[0];
      expect(node.attributes['bsi::ifc::prop::Name']).toBe('MyWall');
      expect(node.attributes['bsi::ifc::prop::Description']).toBe('A wall');
    });
  });

  describe('bsi::ifc::class', () => {
    it('has both code and uri matching official schema', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'Wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const cls = file.data[0].attributes['bsi::ifc::class'];
      expect(cls).toEqual({
        code: 'IfcWall',
        uri: 'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/5/class/IfcWall',
      });

      // Validate against official schema
      const schema = ALL_OFFICIAL_SCHEMAS['bsi::ifc::class'];
      const errors = validateValue(cls, schema.value, 'bsi::ifc::class');
      expect(errors).toEqual([]);
    });

    it('uri pattern matches real IFC5 reference files', () => {
      const ref = loadReferenceFile('Hello_Wall_hello-wall.ifcx');
      // Extract the URI pattern from reference
      const refUriPattern = /^https:\/\/identifier\.buildingsmart\.org\/uri\/buildingsmart\/ifc\/\d[.\d]*\/class\/\w+$/;
      for (const node of ref.data) {
        const cls = node.attributes?.['bsi::ifc::class'];
        if (cls) expect(cls.uri).toMatch(refUriPattern);
      }

      // Our export must match same pattern
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const file = JSON.parse(exporter.export({ includeGeometry: false, includeProperties: false }).content);
      expect(file.data[0].attributes['bsi::ifc::class'].uri).toMatch(refUriPattern);
    });
  });

  describe('usd::usdgeom::mesh', () => {
    it('only contains points and faceVertexIndices (per official schema)', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);
      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const file = JSON.parse(exporter.export().content);

      const mesh = file.data[0].attributes['usd::usdgeom::mesh'];
      // Must have the required keys
      expect(mesh).toHaveProperty('points');
      expect(mesh).toHaveProperty('faceVertexIndices');
      // Must NOT have keys outside the official schema
      const allowedKeys = new Set(['points', 'faceVertexIndices']);
      for (const key of Object.keys(mesh)) {
        expect(allowedKeys.has(key)).toBe(true);
      }

      // Validate value against official schema
      const schema = ALL_OFFICIAL_SCHEMAS['usd::usdgeom::mesh'];
      const errors = validateValue(mesh, schema.value, 'usd::usdgeom::mesh');
      expect(errors).toEqual([]);
    });

    it('points are arrays of [x,y,z] reals', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);
      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const file = JSON.parse(exporter.export().content);

      const mesh = file.data[0].attributes['usd::usdgeom::mesh'];
      expect(Array.isArray(mesh.points)).toBe(true);
      for (const pt of mesh.points) {
        expect(Array.isArray(pt)).toBe(true);
        expect(pt).toHaveLength(3);
        for (const v of pt) expect(typeof v).toBe('number');
      }
    });

    it('faceVertexIndices are integers', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);
      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const file = JSON.parse(exporter.export().content);

      const mesh = file.data[0].attributes['usd::usdgeom::mesh'];
      expect(Array.isArray(mesh.faceVertexIndices)).toBe(true);
      for (const idx of mesh.faceVertexIndices) {
        expect(Number.isInteger(idx)).toBe(true);
      }
    });
  });

  describe('imports', () => {
    it('import URIs match those used in real IFC5 files', () => {
      const ref = loadReferenceFile('Hello_Wall_hello-wall.ifcx');
      const refUris = new Set((ref.imports ?? []).map((i: any) => i.uri));

      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'Wall' },
      ]);
      const meshes = makeMockMeshes(1);
      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const file = JSON.parse(exporter.export().content);

      for (const imp of file.imports) {
        expect(imp).toHaveProperty('uri');
        expect(typeof imp.uri).toBe('string');
        expect(refUris).toContain(imp.uri);
      }
    });

    it('includes prop import when name/description are written', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall', description: 'Desc' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const file = JSON.parse(exporter.export({ includeGeometry: false, includeProperties: false }).content);

      const propImport = file.imports.find(
        (i: { uri: string }) => i.uri === STANDARD_IMPORT_URIS.IFC_PROP,
      );
      expect(propImport).toBeDefined();
    });
  });

  describe('cross-validation against reference files', () => {
    it('reference file Hello_Wall_hello-wall.ifcx passes official schema validation', () => {
      const ref = loadReferenceFile('Hello_Wall_hello-wall.ifcx');
      const errors = validateIfcxFile(ref);
      expect(errors).toEqual([]);
    });

    it('reference file ACCA_Building passes official schema validation', () => {
      const ref = loadReferenceFile('ACCA_Building_esempio_01_edificius.ifcx');
      const errors = validateIfcxFile(ref);
      expect(errors).toEqual([]);
    });

    it('reference file IFC_Hero_Model passes official schema validation', () => {
      const ref = loadReferenceFile('IFC_Hero_Model_IFC_Hero_Model.ifcx');
      const errors = validateIfcxFile(ref);
      expect(errors).toEqual([]);
    });
  });
});

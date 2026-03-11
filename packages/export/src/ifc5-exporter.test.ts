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

// ============================================================================
// Reference-based validation helpers
// ============================================================================

/** Load a real IFC5 reference file from the test models directory. */
function loadReferenceFile(filename: string): any {
  const path = resolve(__dirname, '../../../tests/models/ifc5', filename);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Extract the structural "shape" of every attribute type from a reference file.
 * Returns a map from attribute key to expected shape (required keys, value types).
 */
function extractAttributeShapes(refFile: any): Map<string, { requiredKeys?: string[]; valueType?: string }> {
  const shapes = new Map<string, { requiredKeys?: string[]; valueType?: string }>();
  for (const node of refFile.data ?? []) {
    for (const [key, val] of Object.entries(node.attributes ?? {})) {
      if (shapes.has(key)) continue;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        shapes.set(key, { requiredKeys: Object.keys(val as object).sort(), valueType: 'object' });
      } else if (Array.isArray(val)) {
        shapes.set(key, { valueType: 'array' });
      } else {
        shapes.set(key, { valueType: typeof val });
      }
    }
  }
  return shapes;
}

/**
 * Validate an IFCX file against the structural shapes extracted from a reference.
 * Returns an array of error messages (empty = valid).
 */
function validateAgainstReference(
  exportedFile: any,
  referenceShapes: Map<string, { requiredKeys?: string[]; valueType?: string }>,
): string[] {
  const errors: string[] = [];

  // Validate top-level structure
  if (!exportedFile.header) errors.push('Missing "header" field');
  if (!Array.isArray(exportedFile.imports)) errors.push('"imports" must be an array');
  if (typeof exportedFile.schemas !== 'object') errors.push('"schemas" must be an object');
  if (!Array.isArray(exportedFile.data)) errors.push('"data" must be an array');

  // Validate imports format
  for (const imp of exportedFile.imports ?? []) {
    if (typeof imp !== 'object' || typeof imp.uri !== 'string') {
      errors.push(`Import must be an object with "uri" string, got: ${JSON.stringify(imp)}`);
    }
  }

  // Validate each data node's attributes match reference shapes
  for (const node of exportedFile.data ?? []) {
    for (const [key, val] of Object.entries(node.attributes ?? {})) {
      const shape = referenceShapes.get(key);
      if (!shape) continue; // Unknown attribute, can't validate

      // Validate required keys for object values
      if (shape.requiredKeys && val && typeof val === 'object' && !Array.isArray(val)) {
        for (const reqKey of shape.requiredKeys) {
          if (!(reqKey in (val as Record<string, unknown>))) {
            errors.push(
              `[${node.path}].attributes["${key}"]: Expected object to have key "${reqKey}". ` +
              `Got keys: [${Object.keys(val as object).join(', ')}]`,
            );
          }
        }
      }

      // Validate value type
      if (shape.valueType === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
        errors.push(`[${node.path}].attributes["${key}"]: Expected object, got ${typeof val}`);
      }
      if (shape.valueType === 'array' && !Array.isArray(val)) {
        errors.push(`[${node.path}].attributes["${key}"]: Expected array, got ${typeof val}`);
      }
    }
  }

  return errors;
}

// ============================================================================
// Test data builders
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

// ============================================================================
// Tests
// ============================================================================

describe('Ifc5Exporter', () => {
  // Load reference shapes once from the official Hello Wall example
  const helloWallRef = loadReferenceFile('Hello_Wall_hello-wall.ifcx');
  const referenceShapes = extractAttributeShapes(helloWallRef);

  describe('schema compliance against reference files', () => {
    it('bsi::ifc::class has required "code" and "uri" keys (matching Hello_Wall reference)', () => {
      const refShape = referenceShapes.get('bsi::ifc::class');
      expect(refShape).toBeDefined();
      expect(refShape!.requiredKeys).toContain('code');
      expect(refShape!.requiredKeys).toContain('uri');

      // Now verify our export matches
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'Wall' },
      ]);
      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const node = file.data[0];
      const cls = node.attributes['bsi::ifc::class'];
      expect(cls).toHaveProperty('code');
      expect(cls).toHaveProperty('uri');
      expect(cls.code).toBe('IfcWall');
      expect(cls.uri).toMatch(/^https:\/\/identifier\.buildingsmart\.org\/uri\/buildingsmart\/ifc\/5\/class\/IfcWall$/);
    });

    it('bsi::ifc::class uri follows the buildingSMART identifier pattern', () => {
      // Verify the URI pattern matches what real files use
      for (const node of helloWallRef.data) {
        const cls = node.attributes?.['bsi::ifc::class'];
        if (!cls) continue;
        expect(cls.uri).toMatch(
          /^https:\/\/identifier\.buildingsmart\.org\/uri\/buildingsmart\/ifc\/\d[.\d]*\/class\/\w+$/,
        );
      }
    });

    it('exported attributes pass structural validation against Hello_Wall reference', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'TestWall' },
      ]);

      const meshes = [{
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0] as [number, number, number, number],
      }];

      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      const errors = validateAgainstReference(file, referenceShapes);
      expect(errors).toEqual([]);
    });

    it('validates against multiple reference files', () => {
      // Load shapes from a different reference file (ACCA building)
      const accaRef = loadReferenceFile('ACCA_Building_esempio_01_edificius.ifcx');
      const accaShapes = extractAttributeShapes(accaRef);

      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const errors = validateAgainstReference(file, accaShapes);
      expect(errors).toEqual([]);
    });
  });

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

    it('import URIs match those used in real IFC5 files', () => {
      // Extract import URIs from the real reference file
      const refImportUris = new Set(
        (helloWallRef.imports ?? []).map((i: any) => i.uri),
      );

      // Our exporter should only use URIs that real files also use
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'abc', name: 'Wall' },
      ]);

      const meshes = [{
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0] as [number, number, number, number],
      }];

      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      for (const imp of file.imports) {
        expect(refImportUris).toContain(imp.uri);
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

    it('bsi::ifc::class has both code and uri', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'TestWall' },
      ]);

      const exporter = new Ifc5Exporter(dataStore);
      const result = exporter.export({ includeGeometry: false, includeProperties: false });
      const file = JSON.parse(result.content);

      const node = file.data[0];
      expect(node.attributes['bsi::ifc::class']).toEqual({
        code: 'IfcWall',
        uri: 'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/5/class/IfcWall',
      });
    });

    it('usd::usdgeom::mesh has required points and faceVertexIndices keys', () => {
      const meshShape = referenceShapes.get('usd::usdgeom::mesh');
      expect(meshShape).toBeDefined();
      expect(meshShape!.requiredKeys).toContain('points');
      expect(meshShape!.requiredKeys).toContain('faceVertexIndices');

      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);

      const meshes = [{
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0] as [number, number, number, number],
      }];

      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      const node = file.data[0];
      const mesh = node.attributes['usd::usdgeom::mesh'];
      expect(mesh).toHaveProperty('points');
      expect(mesh).toHaveProperty('faceVertexIndices');
      expect(Array.isArray(mesh.points)).toBe(true);
      expect(Array.isArray(mesh.faceVertexIndices)).toBe(true);
    });

    it('bsi::ifc::presentation::diffuseColor is an array of 3 numbers', () => {
      const dataStore = buildMinimalDataStore([
        { expressId: 1, type: 'IFCWALL', globalId: 'g1', name: 'Wall' },
      ]);

      const meshes = [{
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.6, 0.4, 1.0] as [number, number, number, number],
      }];

      const exporter = new Ifc5Exporter(dataStore, { meshes } as any);
      const result = exporter.export();
      const file = JSON.parse(result.content);

      const node = file.data[0];
      const color = node.attributes['bsi::ifc::presentation::diffuseColor'];
      expect(Array.isArray(color)).toBe(true);
      expect(color).toHaveLength(3);
      expect(color.every((c: unknown) => typeof c === 'number')).toBe(true);
    });
  });
});

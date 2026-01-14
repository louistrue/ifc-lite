/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests for @ifc-lite/cache
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  StringTable,
  EntityTableBuilder,
  PropertyTableBuilder,
  QuantityTableBuilder,
  RelationshipGraphBuilder,
  PropertyValueType,
  QuantityType,
  RelationshipType,
} from '@ifc-lite/data';
import { BinaryCacheWriter, BinaryCacheReader, xxhash64, SchemaVersion } from './index.js';
import type { IfcDataStore } from './types.js';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';

describe('xxhash64', () => {
  it('should hash empty buffer', () => {
    const hash = xxhash64(new Uint8Array(0));
    assert.ok(typeof hash === 'bigint');
  });

  it('should produce consistent hashes', () => {
    const data = new TextEncoder().encode('Hello, World!');
    const hash1 = xxhash64(data);
    const hash2 = xxhash64(data);
    assert.strictEqual(hash1, hash2);
  });

  it('should produce different hashes for different data', () => {
    const data1 = new TextEncoder().encode('Hello');
    const data2 = new TextEncoder().encode('World');
    const hash1 = xxhash64(data1);
    const hash2 = xxhash64(data2);
    assert.notStrictEqual(hash1, hash2);
  });
});

describe('BinaryCacheWriter and BinaryCacheReader', () => {
  let dataStore: IfcDataStore;
  let sourceBuffer: ArrayBuffer;

  beforeEach(() => {
    // Create test data
    const strings = new StringTable();

    // Build entity table
    const entityBuilder = new EntityTableBuilder(10, strings);
    entityBuilder.add(1, 'IfcProject', 'guid-project', 'Test Project', '', '', false, false);
    entityBuilder.add(2, 'IfcSite', 'guid-site', 'Test Site', '', '', false, false);
    entityBuilder.add(3, 'IfcBuilding', 'guid-building', 'Test Building', '', '', false, false);
    entityBuilder.add(4, 'IfcWall', 'guid-wall-1', 'Wall 1', '', '', true, false);
    entityBuilder.add(5, 'IfcWall', 'guid-wall-2', 'Wall 2', '', '', true, false);
    const entities = entityBuilder.build();

    // Build property table
    const propertyBuilder = new PropertyTableBuilder(strings);
    propertyBuilder.add({
      entityId: 4,
      psetName: 'Pset_WallCommon',
      psetGlobalId: 'pset-guid-1',
      propName: 'IsExternal',
      propType: PropertyValueType.Boolean,
      value: true,
    });
    propertyBuilder.add({
      entityId: 4,
      psetName: 'Pset_WallCommon',
      psetGlobalId: 'pset-guid-1',
      propName: 'FireRating',
      propType: PropertyValueType.Label,
      value: 'REI60',
    });
    const properties = propertyBuilder.build();

    // Build quantity table
    const quantityBuilder = new QuantityTableBuilder(strings);
    quantityBuilder.add({
      entityId: 4,
      qsetName: 'Qto_WallBaseQuantities',
      quantityName: 'Length',
      quantityType: QuantityType.Length,
      value: 5.5,
    });
    quantityBuilder.add({
      entityId: 4,
      qsetName: 'Qto_WallBaseQuantities',
      quantityName: 'GrossVolume',
      quantityType: QuantityType.Volume,
      value: 2.75,
    });
    const quantities = quantityBuilder.build();

    // Build relationship graph
    const relationshipBuilder = new RelationshipGraphBuilder();
    relationshipBuilder.addEdge(3, 4, RelationshipType.ContainsElements, 100);
    relationshipBuilder.addEdge(3, 5, RelationshipType.ContainsElements, 101);
    const relationships = relationshipBuilder.build();

    dataStore = {
      schema: SchemaVersion.IFC4,
      entityCount: 5,
      strings,
      entities,
      properties,
      quantities,
      relationships,
    };

    // Mock source buffer
    sourceBuffer = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=IFCPROJECT();\nENDSEC;\nEND-ISO-10303-21;').buffer;
  });

  it('should write and read cache without geometry', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    assert.ok(cacheBuffer instanceof ArrayBuffer);
    assert.ok(cacheBuffer.byteLength > 0);

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    assert.strictEqual(result.dataStore.entityCount, 5);
    assert.strictEqual(result.dataStore.schema, SchemaVersion.IFC4);
    assert.strictEqual(result.geometry, undefined);
  });

  it('should write and read cache with geometry', async () => {
    const meshes: MeshData[] = [
      {
        expressId: 4,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0],
      },
    ];

    const coordinateInfo: CoordinateInfo = {
      originShift: { x: 0, y: 0, z: 0 },
      originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
      shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
      isGeoReferenced: false,
    };

    const geometry = {
      meshes,
      totalVertices: 3,
      totalTriangles: 1,
      coordinateInfo,
    };

    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, geometry, sourceBuffer);

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    assert.ok(result.geometry);
    assert.strictEqual(result.geometry.meshes.length, 1);
    assert.strictEqual(result.geometry.meshes[0].expressId, 4);
    assert.strictEqual(result.geometry.totalVertices, 3);
    assert.strictEqual(result.geometry.totalTriangles, 1);
  });

  it('should validate cache against source', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();

    // Valid source
    assert.ok(reader.validate(cacheBuffer, sourceBuffer));

    // Modified source
    const modifiedSource = new TextEncoder().encode('MODIFIED IFC FILE').buffer;
    assert.ok(!reader.validate(cacheBuffer, modifiedSource));
  });

  it('should read header only', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();
    const header = reader.readHeader(cacheBuffer);

    assert.strictEqual(header.version, 1);
    assert.strictEqual(header.entityCount, 5);
    assert.strictEqual(header.schema, SchemaVersion.IFC4);
    assert.ok(header.sections.length > 0);
  });

  it('should preserve entity data through round-trip', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    // Check entities
    const { entities, strings } = result.dataStore;
    assert.strictEqual(entities.count, 5);

    // Check that we can retrieve entity names
    assert.strictEqual(entities.getName(1), 'Test Project');
    assert.strictEqual(entities.getName(4), 'Wall 1');
    assert.strictEqual(entities.getTypeName(4), 'IfcWall');
  });

  it('should preserve property data through round-trip', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    const { properties } = result.dataStore;
    const psets = properties.getForEntity(4);

    assert.strictEqual(psets.length, 1);
    assert.strictEqual(psets[0].name, 'Pset_WallCommon');
    assert.strictEqual(psets[0].properties.length, 2);

    // Check property values
    const isExternal = properties.getPropertyValue(4, 'Pset_WallCommon', 'IsExternal');
    assert.strictEqual(isExternal, true);

    const fireRating = properties.getPropertyValue(4, 'Pset_WallCommon', 'FireRating');
    assert.strictEqual(fireRating, 'REI60');
  });

  it('should preserve quantity data through round-trip', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    const { quantities } = result.dataStore;
    const qsets = quantities.getForEntity(4);

    assert.strictEqual(qsets.length, 1);
    assert.strictEqual(qsets[0].name, 'Qto_WallBaseQuantities');

    const length = quantities.getQuantityValue(4, 'Qto_WallBaseQuantities', 'Length');
    assert.strictEqual(length, 5.5);
  });

  it('should preserve relationship data through round-trip', async () => {
    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, undefined, sourceBuffer, {
      includeGeometry: false,
    });

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer);

    const { relationships } = result.dataStore;

    // Check forward relationships
    const contained = relationships.getRelated(3, RelationshipType.ContainsElements, 'forward');
    assert.ok(contained.includes(4));
    assert.ok(contained.includes(5));

    // Check inverse relationships
    const containers = relationships.getRelated(4, RelationshipType.ContainsElements, 'inverse');
    assert.ok(containers.includes(3));
  });

  it('should skip geometry when requested', async () => {
    const meshes: MeshData[] = [
      {
        expressId: 4,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.8, 0.8, 0.8, 1.0],
      },
    ];

    const geometry = {
      meshes,
      totalVertices: 3,
      totalTriangles: 1,
      coordinateInfo: {
        originShift: { x: 0, y: 0, z: 0 },
        originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
        shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
        isGeoReferenced: false,
      },
    };

    const writer = new BinaryCacheWriter();
    const cacheBuffer = await writer.write(dataStore, geometry, sourceBuffer);

    const reader = new BinaryCacheReader();
    const result = await reader.read(cacheBuffer, { skipGeometry: true });

    assert.strictEqual(result.geometry, undefined);
    assert.ok(result.dataStore.entities);
  });
});

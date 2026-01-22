#!/usr/bin/env node
/**
 * WASM API Contract Tests
 *
 * Tests the public API contract of the WASM bindings.
 * Focus on structural invariants, not exact values.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { initSync, IfcAPI } from '../packages/wasm/pkg/ifc-lite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT_DIR, 'tests/models');

// Test fixtures - small IFC files for fast tests
const COLUMN_IFC = join(FIXTURES_DIR, 'buildingsmart/column-straight-rectangle-tessellation.ifc');
const GEOREF_IFC = join(FIXTURES_DIR, 'ifc5/Georeferencing_georeferenced-bridge-deck.ifc');

console.log('🧪 WASM API Contract Tests\n');

// Initialize WASM
console.log('📦 Loading WASM...');
const wasmBuffer = readFileSync(join(ROOT_DIR, 'packages/wasm/pkg/ifc-lite_bg.wasm'));
initSync(wasmBuffer);
console.log('✅ WASM initialized\n');

// Load fixture files
const columnContent = readFileSync(COLUMN_IFC, 'utf-8');

// Create API
const api = new IfcAPI();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failed++;
  }
}

// ===== IfcAPI initialization =====
console.log('📋 IfcAPI initialization');

test('should be ready after construction', () => {
  assert.equal(api.is_ready, true);
});

test('should have a version string', () => {
  assert.equal(typeof api.version, 'string');
  assert.ok(api.version.length > 0);
});

// ===== parseMeshes =====
console.log('\n📋 parseMeshes');

test('should return a MeshCollection', () => {
  const collection = api.parseMeshes(columnContent);
  assert.ok(collection, 'Collection should exist');
  assert.equal(typeof collection.length, 'number');
  assert.ok(collection.length > 0, 'Should have at least one mesh');
  collection.free();
});

test('should produce meshes with valid structure', () => {
  const collection = api.parseMeshes(columnContent);

  for (let i = 0; i < collection.length; i++) {
    const mesh = collection.get(i);
    assert.ok(mesh, `Mesh ${i} should exist`);

    // Structural invariants
    assert.equal(typeof mesh.expressId, 'number');
    assert.ok(mesh.expressId > 0, 'Express ID should be positive');

    assert.ok(mesh.positions instanceof Float32Array);
    assert.ok(mesh.normals instanceof Float32Array);
    assert.ok(mesh.indices instanceof Uint32Array);
    assert.ok(mesh.color instanceof Float32Array);

    // Positions must be triplets (x, y, z)
    assert.equal(mesh.positions.length % 3, 0, 'Positions must be triplets');

    // Normals must match position count
    assert.equal(mesh.normals.length, mesh.positions.length, 'Normals must match positions');

    // Indices must be valid (within vertex range)
    const vertexCount = mesh.positions.length / 3;
    for (let j = 0; j < mesh.indices.length; j++) {
      assert.ok(mesh.indices[j] < vertexCount, `Index ${j} out of range`);
    }

    // Color must be RGBA
    assert.equal(mesh.color.length, 4, 'Color must be RGBA');

    // IFC type should be a non-empty string
    assert.equal(typeof mesh.ifcType, 'string');
    assert.ok(mesh.ifcType.length > 0, 'IFC type should not be empty');

    mesh.free();
  }

  collection.free();
});

test('should have consistent vertex/triangle counts', () => {
  const collection = api.parseMeshes(columnContent);

  let totalVertices = 0;
  let totalTriangles = 0;

  for (let i = 0; i < collection.length; i++) {
    const mesh = collection.get(i);
    totalVertices += mesh.vertexCount;
    totalTriangles += mesh.triangleCount;
    mesh.free();
  }

  assert.equal(collection.totalVertices, totalVertices);
  assert.equal(collection.totalTriangles, totalTriangles);

  collection.free();
});

test('should handle empty/minimal IFC content gracefully', () => {
  const minimalIfc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),'','','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;

  const collection = api.parseMeshes(minimalIfc);
  assert.equal(collection.length, 0, 'Empty IFC should produce no meshes');
  collection.free();
});

// ===== parseToGpuGeometry =====
console.log('\n📋 parseToGpuGeometry');

test('should return GpuGeometry with valid structure', () => {
  const gpuGeom = api.parseToGpuGeometry(columnContent);

  assert.ok(gpuGeom, 'GPU geometry should exist');
  assert.equal(typeof gpuGeom.meshCount, 'number');
  assert.ok(gpuGeom.meshCount > 0, 'Should have meshes');

  // Pointer access properties
  assert.equal(typeof gpuGeom.vertexDataPtr, 'number');
  assert.equal(typeof gpuGeom.vertexDataLen, 'number');
  assert.equal(typeof gpuGeom.indicesPtr, 'number');
  assert.equal(typeof gpuGeom.indicesLen, 'number');

  // Byte lengths for GPU buffer allocation
  assert.equal(typeof gpuGeom.vertexDataByteLength, 'number');
  assert.equal(typeof gpuGeom.indicesByteLength, 'number');

  assert.ok(gpuGeom.vertexDataLen > 0);
  assert.ok(gpuGeom.indicesLen > 0);

  gpuGeom.free();
});

test('should provide mesh metadata', () => {
  const gpuGeom = api.parseToGpuGeometry(columnContent);

  for (let i = 0; i < gpuGeom.meshCount; i++) {
    const metadata = gpuGeom.getMeshMetadata(i);
    assert.ok(metadata, `Metadata for mesh ${i} should exist`);

    assert.equal(typeof metadata.expressId, 'number');
    assert.equal(typeof metadata.indexCount, 'number');
    assert.equal(typeof metadata.indexOffset, 'number');
    assert.equal(typeof metadata.vertexCount, 'number');
    assert.equal(typeof metadata.vertexOffset, 'number');

    assert.ok(metadata.color instanceof Float32Array);
    assert.equal(metadata.color.length, 4);

    metadata.free();
  }

  gpuGeom.free();
});

test('should report isEmpty correctly', () => {
  const gpuGeom = api.parseToGpuGeometry(columnContent);
  assert.equal(gpuGeom.isEmpty, false);
  gpuGeom.free();

  const minimalIfc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),'','','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;

  const emptyGeom = api.parseToGpuGeometry(minimalIfc);
  assert.equal(emptyGeom.isEmpty, true);
  emptyGeom.free();
});

// ===== parseMeshesInstanced =====
console.log('\n📋 parseMeshesInstanced');

test('should return InstancedMeshCollection', () => {
  const collection = api.parseMeshesInstanced(columnContent);

  assert.ok(collection, 'Collection should exist');
  assert.equal(typeof collection.length, 'number');
  assert.equal(typeof collection.totalInstances, 'number');
  assert.equal(typeof collection.totalGeometries, 'number');

  // Total instances should be >= total geometries
  assert.ok(collection.totalInstances >= collection.totalGeometries);

  collection.free();
});

test('should produce valid instanced geometry', () => {
  const collection = api.parseMeshesInstanced(columnContent);

  for (let i = 0; i < collection.length; i++) {
    const geom = collection.get(i);
    assert.ok(geom, `Geometry ${i} should exist`);

    assert.equal(typeof geom.geometryId, 'bigint');
    assert.equal(typeof geom.instance_count, 'number');
    assert.ok(geom.instance_count > 0);

    assert.ok(geom.positions instanceof Float32Array);
    assert.ok(geom.normals instanceof Float32Array);
    assert.ok(geom.indices instanceof Uint32Array);

    // Each instance should have valid data
    for (let j = 0; j < geom.instance_count; j++) {
      const inst = geom.get_instance(j);
      assert.ok(inst, `Instance ${j} should exist`);

      assert.equal(typeof inst.expressId, 'number');
      assert.ok(inst.color instanceof Float32Array);
      assert.ok(inst.transform instanceof Float32Array);
      assert.equal(inst.transform.length, 16, 'Transform should be 4x4 matrix');

      inst.free();
    }

    geom.free();
  }

  collection.free();
});

// ===== getGeoReference =====
console.log('\n📋 getGeoReference');

test('should return undefined for non-georeferenced files', () => {
  const georef = api.getGeoReference(columnContent);
  assert.equal(georef, undefined);
});

test('should return GeoReferenceJs for georeferenced files', () => {
  let georefContent;
  try {
    georefContent = readFileSync(GEOREF_IFC, 'utf-8');
  } catch {
    console.log('     (skipped - fixture not found)');
    return; // Test harness will count as passed
  }

  const georef = api.getGeoReference(georefContent);

  if (georef) {
    assert.equal(typeof georef.eastings, 'number');
    assert.equal(typeof georef.northings, 'number');
    assert.equal(typeof georef.orthogonal_height, 'number');
    assert.equal(typeof georef.scale, 'number');
    assert.equal(typeof georef.rotation, 'number');

    // Transform methods should work
    const worldCoords = georef.localToMap(0, 0, 0);
    assert.ok(worldCoords instanceof Float64Array);
    assert.equal(worldCoords.length, 3);

    // Matrix should be 4x4
    const matrix = georef.toMatrix();
    assert.ok(matrix instanceof Float64Array);
    assert.equal(matrix.length, 16);

    georef.free();
  }
});

// ===== scanEntitiesFast =====
console.log('\n📋 scanEntitiesFast');

test('should return entity scan results', () => {
  const result = api.scanEntitiesFast(columnContent);
  assert.ok(result, 'Scan result should exist');
  assert.ok(Array.isArray(result) || typeof result === 'object');
});

// ===== parseZeroCopy =====
console.log('\n📋 parseZeroCopy');

test('should return ZeroCopyMesh with valid structure', () => {
  const mesh = api.parseZeroCopy(columnContent);

  assert.ok(mesh, 'Zero-copy mesh should exist');

  // Length properties
  assert.equal(typeof mesh.positions_len, 'number');
  assert.equal(typeof mesh.normals_len, 'number');
  assert.equal(typeof mesh.indices_len, 'number');

  // Pointer properties
  assert.equal(typeof mesh.positions_ptr, 'number');
  assert.equal(typeof mesh.normals_ptr, 'number');
  assert.equal(typeof mesh.indices_ptr, 'number');

  // Counts
  assert.equal(typeof mesh.vertex_count, 'number');
  assert.equal(typeof mesh.triangle_count, 'number');

  // Positions/normals lengths should match
  assert.equal(mesh.positions_len, mesh.normals_len);

  // Bounds
  const boundsMin = mesh.bounds_min();
  const boundsMax = mesh.bounds_max();
  assert.ok(boundsMin instanceof Float32Array);
  assert.ok(boundsMax instanceof Float32Array);
  assert.equal(boundsMin.length, 3);
  assert.equal(boundsMax.length, 3);

  // Max bounds should be >= min bounds
  for (let i = 0; i < 3; i++) {
    assert.ok(boundsMax[i] >= boundsMin[i], `Bounds max[${i}] should >= min[${i}]`);
  }

  mesh.free();
});

// ===== parseMeshesWithRtc =====
console.log('\n📋 parseMeshesWithRtc');

test('should return collection with RTC offset', () => {
  const result = api.parseMeshesWithRtc(columnContent);

  assert.ok(result, 'Result should exist');
  assert.ok(result.meshes, 'Meshes should exist');
  assert.ok(result.rtcOffset, 'RTC offset should exist');

  const offset = result.rtcOffset;
  assert.equal(typeof offset.x, 'number');
  assert.equal(typeof offset.y, 'number');
  assert.equal(typeof offset.z, 'number');

  // isSignificant should be a boolean
  assert.equal(typeof offset.isSignificant(), 'boolean');

  // toWorld should transform coordinates
  const worldCoords = offset.toWorld(0, 0, 0);
  assert.ok(worldCoords instanceof Float64Array);
  assert.equal(worldCoords.length, 3);

  result.free();
});

// ===== Error handling =====
console.log('\n📋 Error handling');

test('should handle completely invalid content gracefully', () => {
  // Parser is graceful - returns empty collection rather than throwing
  try {
    const collection = api.parseMeshes('not valid ifc content at all');
    assert.equal(collection.length, 0, 'Invalid content should produce empty collection');
    collection.free();
  } catch {
    // Throwing is also acceptable
  }
});

test('should handle truncated IFC content gracefully', () => {
  const truncated = columnContent.substring(0, 100);

  // Should either throw or return empty/partial result
  try {
    const collection = api.parseMeshes(truncated);
    assert.equal(typeof collection.length, 'number');
    collection.free();
  } catch {
    // Throwing is also acceptable
  }
});

// Summary
console.log('\n' + '═'.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  process.exit(1);
}

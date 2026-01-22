#!/usr/bin/env node
/**
 * Integration Pipeline Tests
 *
 * Tests the full IFC → parse → geometry pipeline.
 * Ensures packages work together correctly.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { initSync, IfcAPI } from '../packages/wasm/pkg/ifc-lite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT_DIR, 'tests/models');

// Test fixtures
const COLUMN_IFC = join(FIXTURES_DIR, 'buildingsmart/column-straight-rectangle-tessellation.ifc');
const WALL_IFC = join(FIXTURES_DIR, 'buildingsmart/wall-with-opening-and-window.ifc');
const DUPLEX_IFC = join(FIXTURES_DIR, 'ara3d/duplex.ifc');

console.log('🧪 Integration Pipeline Tests\n');

// Initialize WASM
console.log('📦 Loading WASM...');
const wasmBuffer = readFileSync(join(ROOT_DIR, 'packages/wasm/pkg/ifc-lite_bg.wasm'));
initSync(wasmBuffer);
const api = new IfcAPI();
console.log('✅ WASM initialized\n');

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

// ===== Parse → Mesh Pipeline =====
console.log('📋 Parse → Mesh Pipeline');

test('column: parse produces valid geometry', () => {
  const content = readFileSync(COLUMN_IFC, 'utf-8');
  const collection = api.parseMeshes(content);

  assert.ok(collection.length > 0, 'Should produce meshes');

  // Verify mesh integrity
  for (let i = 0; i < collection.length; i++) {
    const mesh = collection.get(i);

    // Basic structure
    assert.ok(mesh.positions.length > 0, 'Should have positions');
    assert.ok(mesh.indices.length > 0, 'Should have indices');

    // Triangles must be complete
    assert.equal(mesh.indices.length % 3, 0, 'Indices must form complete triangles');

    // All indices must reference valid vertices
    const vertexCount = mesh.positions.length / 3;
    const maxIndex = Math.max(...mesh.indices);
    assert.ok(maxIndex < vertexCount, 'All indices must be valid');

    mesh.free();
  }

  collection.free();
});

test('wall with opening: parse handles boolean operations', () => {
  const content = readFileSync(WALL_IFC, 'utf-8');
  const collection = api.parseMeshes(content);

  // Wall with opening should still produce valid geometry
  assert.ok(collection.length > 0, 'Wall fixture should produce at least one mesh');

  for (let i = 0; i < collection.length; i++) {
    const mesh = collection.get(i);
    assert.equal(mesh.positions.length % 3, 0, 'Positions must be triplets');
    mesh.free();
  }

  collection.free();
});

test('duplex: parse handles complex building model', () => {
  const content = readFileSync(DUPLEX_IFC, 'utf-8');
  const collection = api.parseMeshes(content);

  // Duplex is a complete building - should have many meshes
  assert.ok(collection.length > 10, 'Complex model should have many meshes');
  assert.ok(collection.totalVertices > 1000, 'Should have significant geometry');
  assert.ok(collection.totalTriangles > 500, 'Should have many triangles');

  collection.free();
});

// ===== GPU Geometry Pipeline =====
console.log('\n📋 GPU Geometry Pipeline');

test('column: GPU geometry has valid buffer structure', () => {
  const content = readFileSync(COLUMN_IFC, 'utf-8');
  const gpuGeom = api.parseToGpuGeometry(content);

  assert.ok(gpuGeom.meshCount > 0, 'Should have meshes');

  // Verify buffer alignment
  assert.ok(gpuGeom.vertexDataByteLength > 0, 'Should have vertex data');
  assert.ok(gpuGeom.indicesByteLength > 0, 'Should have index data');

  // Byte lengths should be properly aligned
  assert.equal(gpuGeom.indicesByteLength % 4, 0, 'Index buffer should be 4-byte aligned');

  // Mesh metadata should be consistent
  let totalIndexCount = 0;
  for (let i = 0; i < gpuGeom.meshCount; i++) {
    const meta = gpuGeom.getMeshMetadata(i);
    totalIndexCount += meta.indexCount;
    meta.free();
  }
  assert.equal(totalIndexCount, gpuGeom.indicesLen, 'Mesh index counts should sum to total');

  gpuGeom.free();
});

test('duplex: GPU geometry handles large models', () => {
  const content = readFileSync(DUPLEX_IFC, 'utf-8');
  const gpuGeom = api.parseToGpuGeometry(content);

  assert.ok(gpuGeom.meshCount > 10, 'Should have many meshes');
  assert.ok(gpuGeom.totalVertexCount > 1000, 'Should have many vertices');
  assert.ok(!gpuGeom.isEmpty, 'Should not be empty');

  gpuGeom.free();
});

// ===== Instanced Geometry Pipeline =====
console.log('\n📋 Instanced Geometry Pipeline');

test('duplex: instancing groups identical geometries', () => {
  const content = readFileSync(DUPLEX_IFC, 'utf-8');

  // Get instanced count
  const instanced = api.parseMeshesInstanced(content);
  const uniqueGeometries = instanced.length;
  const totalInstances = instanced.totalInstances;

  // Instancing should group identical geometries
  assert.ok(uniqueGeometries > 0, 'Should have unique geometries');
  assert.ok(totalInstances >= uniqueGeometries, 'Total instances should be >= unique geometries');

  // Calculate deduplication ratio
  const ratio = totalInstances / uniqueGeometries;
  console.log(`     Deduplication: ${totalInstances} instances → ${uniqueGeometries} unique (${ratio.toFixed(1)}x)`);

  // Verify instance data integrity
  for (let i = 0; i < Math.min(instanced.length, 5); i++) {
    const geom = instanced.get(i);
    assert.ok(geom.instance_count > 0, 'Each geometry should have at least 1 instance');
    assert.ok(geom.positions.length > 0, 'Each geometry should have positions');
    geom.free();
  }

  instanced.free();
});

// ===== Cross-Package Consistency =====
console.log('\n📋 Cross-Package Consistency');

test('mesh counts match across APIs', () => {
  const content = readFileSync(COLUMN_IFC, 'utf-8');

  const meshes = api.parseMeshes(content);
  const gpuGeom = api.parseToGpuGeometry(content);

  assert.equal(meshes.length, gpuGeom.meshCount, 'Mesh count should be consistent');

  // Vertex counts should also match
  assert.equal(meshes.totalVertices, gpuGeom.totalVertexCount, 'Vertex count should match');

  meshes.free();
  gpuGeom.free();
});

test('triangle counts match across APIs', () => {
  const content = readFileSync(COLUMN_IFC, 'utf-8');

  const meshes = api.parseMeshes(content);
  const gpuGeom = api.parseToGpuGeometry(content);

  assert.equal(meshes.totalTriangles, gpuGeom.totalTriangleCount, 'Triangle count should match');

  meshes.free();
  gpuGeom.free();
});

// Summary
console.log('\n' + '═'.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  process.exit(1);
}

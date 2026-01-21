/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { GLTFExporter } from './gltf-exporter.js';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';

// Helper to create a minimal mesh for testing
function createTestMesh(expressId: number): MeshData {
  return {
    expressId,
    ifcType: 'IfcWall',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), // Triangle
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    color: [0.5, 0.5, 0.5, 1.0] as [number, number, number, number],
  };
}

// Helper to create a minimal GeometryResult
function createTestGeometryResult(meshCount: number = 1): GeometryResult {
  const meshes = Array.from({ length: meshCount }, (_, i) => createTestMesh(i + 1));
  const totalVertices = meshes.reduce((sum, m) => sum + m.positions.length / 3, 0);
  const totalTriangles = meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);

  return {
    meshes,
    totalVertices,
    totalTriangles,
    coordinateInfo: {
      originShift: { x: 0, y: 0, z: 0 },
      originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
      shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
      isGeoReferenced: false,
    },
  };
}

describe('GLTFExporter', () => {
  it('should export valid GLB binary', () => {
    const geometryResult = createTestGeometryResult(1);
    const exporter = new GLTFExporter(geometryResult);

    const glb = exporter.exportGLB();

    // GLB magic header is "glTF" (0x46546C67)
    const magic = new DataView(glb.buffer).getUint32(0, true);
    assert.equal(magic, 0x46546C67, 'GLB should have correct magic header');

    // GLB version should be 2
    const version = new DataView(glb.buffer).getUint32(4, true);
    assert.equal(version, 2, 'GLB version should be 2');
  });

  it('should export valid glTF JSON', () => {
    const geometryResult = createTestGeometryResult(1);
    const exporter = new GLTFExporter(geometryResult);

    const { json } = exporter.exportGLTF();
    const gltf = JSON.parse(json);

    // Check required glTF properties
    assert.ok(gltf.asset, 'glTF should have asset');
    assert.equal(gltf.asset.version, '2.0', 'glTF version should be 2.0');
    assert.ok(Array.isArray(gltf.scenes), 'glTF should have scenes array');
    assert.ok(Array.isArray(gltf.nodes), 'glTF should have nodes array');
    assert.ok(Array.isArray(gltf.meshes), 'glTF should have meshes array');
  });

  it('should include metadata when option is enabled', () => {
    const geometryResult = createTestGeometryResult(2);
    const exporter = new GLTFExporter(geometryResult);

    const { json } = exporter.exportGLTF({ includeMetadata: true });
    const gltf = JSON.parse(json);

    // Check metadata in asset extras
    assert.ok(gltf.asset.extras, 'glTF asset should have extras');
    assert.equal(gltf.asset.extras.meshCount, 2, 'Mesh count should match');
  });

  it('should handle multiple meshes', () => {
    const meshCount = 5;
    const geometryResult = createTestGeometryResult(meshCount);
    const exporter = new GLTFExporter(geometryResult);

    const { json } = exporter.exportGLTF();
    const gltf = JSON.parse(json);

    // Each mesh should create a node
    assert.equal(gltf.nodes.length, meshCount, 'Node count should match mesh count');
  });
});

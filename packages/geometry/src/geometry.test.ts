/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Package Unit Tests
 *
 * Tests pure utility functions that don't require WASM.
 * Focus on contract/behavior testing, not implementation details.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BufferBuilder } from './buffer-builder.js';
import { CoordinateHandler } from './coordinate-handler.js';
import { deduplicateMeshes, getDeduplicationStats } from './geometry-deduplicator.js';
import type { MeshData } from './types.js';

// Helper to create test mesh data
function createTestMesh(overrides: Partial<MeshData> & { expressId: number }): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    color: [1, 1, 1, 1] as [number, number, number, number],
    ...overrides,
  };
}

describe('BufferBuilder', () => {
  let builder: BufferBuilder;

  beforeEach(() => {
    builder = new BufferBuilder();
  });

  describe('buildInterleavedBuffer', () => {
    it('should create interleaved position+normal buffer', () => {
      const mesh = createTestMesh({ expressId: 1 });
      const buffer = builder.buildInterleavedBuffer(mesh);

      // 3 vertices × 6 floats each (pos + normal)
      assert.equal(buffer.length, 18);

      // First vertex: position (0,0,0) then normal (0,0,1)
      assert.equal(buffer[0], 0); // x
      assert.equal(buffer[1], 0); // y
      assert.equal(buffer[2], 0); // z
      assert.equal(buffer[3], 0); // nx
      assert.equal(buffer[4], 0); // ny
      assert.equal(buffer[5], 1); // nz
    });

    it('should preserve all vertex data', () => {
      const mesh = createTestMesh({
        expressId: 1,
        positions: new Float32Array([1, 2, 3, 4, 5, 6]),
        normals: new Float32Array([0.5, 0.5, 0, 0, 1, 0]),
      });

      const buffer = builder.buildInterleavedBuffer(mesh);

      // 2 vertices × 6 floats
      assert.equal(buffer.length, 12);

      // Vertex 1
      assert.equal(buffer[0], 1);
      assert.equal(buffer[1], 2);
      assert.equal(buffer[2], 3);
      assert.equal(buffer[3], 0.5);
      assert.equal(buffer[4], 0.5);
      assert.equal(buffer[5], 0);

      // Vertex 2
      assert.equal(buffer[6], 4);
      assert.equal(buffer[7], 5);
      assert.equal(buffer[8], 6);
      assert.equal(buffer[9], 0);
      assert.equal(buffer[10], 1);
      assert.equal(buffer[11], 0);
    });
  });

  describe('processMeshes', () => {
    it('should calculate correct totals', () => {
      const meshes = [
        createTestMesh({ expressId: 1 }), // 3 vertices, 1 triangle
        createTestMesh({
          expressId: 2,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), // 4 normals to match 4 vertices
          indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
        }), // 4 vertices, 2 triangles
      ];

      const result = builder.processMeshes(meshes);

      assert.equal(result.totalVertices, 7);
      assert.equal(result.totalTriangles, 3);
      assert.equal(result.meshes.length, 2);
    });

    it('should handle empty mesh array', () => {
      const result = builder.processMeshes([]);

      assert.equal(result.totalVertices, 0);
      assert.equal(result.totalTriangles, 0);
      assert.equal(result.meshes.length, 0);
    });
  });
});

describe('CoordinateHandler', () => {
  let handler: CoordinateHandler;

  beforeEach(() => {
    handler = new CoordinateHandler();
  });

  describe('calculateBounds', () => {
    it('should calculate correct bounding box', () => {
      const meshes = [
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([0, 0, 0, 10, 5, 3]),
        }),
        createTestMesh({
          expressId: 2,
          positions: new Float32Array([-5, -10, -2, 20, 15, 8]),
        }),
      ];

      const bounds = handler.calculateBounds(meshes);

      assert.equal(bounds.min.x, -5);
      assert.equal(bounds.min.y, -10);
      assert.equal(bounds.min.z, -2);
      assert.equal(bounds.max.x, 20);
      assert.equal(bounds.max.y, 15);
      assert.equal(bounds.max.z, 8);
    });

    it('should filter out corrupted values', () => {
      const meshes = [
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([0, 0, 0, 1e8, 1e8, 1e8, 10, 10, 10]), // middle vertex corrupted
        }),
      ];

      const bounds = handler.calculateBounds(meshes);

      // Corrupted vertex (1e8 > 1e7 threshold) should be excluded
      assert.equal(bounds.max.x, 10);
      assert.equal(bounds.max.y, 10);
      assert.equal(bounds.max.z, 10);
    });
  });

  describe('needsShift', () => {
    it('should return false for small coordinates', () => {
      const bounds = {
        min: { x: -100, y: -100, z: -10 },
        max: { x: 100, y: 100, z: 50 },
      };

      assert.equal(handler.needsShift(bounds), false);
    });

    it('should return true for large coordinates (>10km)', () => {
      const bounds = {
        min: { x: 500000, y: 5000000, z: 0 },
        max: { x: 500100, y: 5000100, z: 50 },
      };

      assert.equal(handler.needsShift(bounds), true);
    });
  });

  describe('processMeshes', () => {
    it('should not shift small coordinate models', () => {
      const meshes = [
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([0, 0, 0, 10, 10, 10]),
        }),
      ];

      const info = handler.processMeshes(meshes);

      assert.equal(info.isGeoReferenced, false);
      assert.equal(info.originShift.x, 0);
      assert.equal(info.originShift.y, 0);
      assert.equal(info.originShift.z, 0);
    });

    it('should shift large coordinate models to origin', () => {
      const meshes = [
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([500000, 5000000, 100, 500100, 5000100, 150]),
        }),
      ];

      const originalPositions = new Float32Array(meshes[0].positions);
      const info = handler.processMeshes(meshes);

      assert.equal(info.isGeoReferenced, true);

      // Shift should be approximately the centroid
      assert.ok(Math.abs(info.originShift.x - 500050) < 1);
      assert.ok(Math.abs(info.originShift.y - 5000050) < 1);

      // Positions should be shifted (mutated in-place)
      assert.ok(
        Math.abs(meshes[0].positions[0]) < 100,
        'X should be shifted near origin'
      );
      assert.ok(
        Math.abs(meshes[0].positions[1]) < 100,
        'Y should be shifted near origin'
      );
    });

    it('should handle empty mesh array', () => {
      const info = handler.processMeshes([]);

      assert.equal(info.isGeoReferenced, false);
      assert.equal(info.originShift.x, 0);
    });
  });

  describe('coordinate conversion', () => {
    it('should round-trip local to world and back', () => {
      const meshes = [
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([500000, 5000000, 100, 500100, 5000100, 150]),
        }),
      ];

      handler.processMeshes(meshes);

      const localPoint = { x: 10, y: 20, z: 5 };
      const worldPoint = handler.toWorldCoordinates(localPoint);
      const backToLocal = handler.toLocalCoordinates(worldPoint);

      assert.ok(Math.abs(backToLocal.x - localPoint.x) < 0.001);
      assert.ok(Math.abs(backToLocal.y - localPoint.y) < 0.001);
      assert.ok(Math.abs(backToLocal.z - localPoint.z) < 0.001);
    });
  });

  describe('incremental processing', () => {
    it('should accumulate bounds across batches', () => {
      handler.processMeshesIncremental([
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([0, 0, 0, 10, 10, 10]),
        }),
      ]);

      handler.processMeshesIncremental([
        createTestMesh({
          expressId: 2,
          positions: new Float32Array([-5, -5, -5, 20, 20, 20]),
        }),
      ]);

      const info = handler.getFinalCoordinateInfo();

      assert.equal(info.originalBounds.min.x, -5);
      assert.equal(info.originalBounds.max.x, 20);
    });

    it('should reset state for new file', () => {
      handler.processMeshesIncremental([
        createTestMesh({
          expressId: 1,
          positions: new Float32Array([0, 0, 0, 10, 10, 10]),
        }),
      ]);

      handler.reset();

      const info = handler.getCurrentCoordinateInfo();
      assert.equal(info, null);
    });
  });
});

describe('GeometryDeduplicator', () => {
  describe('deduplicateMeshes', () => {
    it('should group identical meshes', () => {
      // Two meshes with identical geometry
      const mesh1 = createTestMesh({ expressId: 1, color: [1, 0, 0, 1] });
      const mesh2 = createTestMesh({ expressId: 2, color: [0, 1, 0, 1] });

      const result = deduplicateMeshes([mesh1, mesh2]);

      // Should produce 1 unique geometry with 2 instances
      assert.equal(result.length, 1);
      assert.equal(result[0].instances.length, 2);
      assert.equal(result[0].instances[0].expressId, 1);
      assert.equal(result[0].instances[1].expressId, 2);
    });

    it('should keep different geometries separate', () => {
      const mesh1 = createTestMesh({
        expressId: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const mesh2 = createTestMesh({
        expressId: 2,
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), // Different size
      });

      const result = deduplicateMeshes([mesh1, mesh2]);

      // Should produce 2 unique geometries
      assert.equal(result.length, 2);
      assert.equal(result[0].instances.length, 1);
      assert.equal(result[1].instances.length, 1);
    });

    it('should preserve geometry data in result', () => {
      const mesh = createTestMesh({
        expressId: 1,
        positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      });

      const result = deduplicateMeshes([mesh]);

      assert.deepEqual(Array.from(result[0].positions), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.deepEqual(Array.from(result[0].normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
      assert.deepEqual(Array.from(result[0].indices), [0, 1, 2]);
    });

    it('should handle empty input', () => {
      const result = deduplicateMeshes([]);
      assert.equal(result.length, 0);
    });
  });

  describe('getDeduplicationStats', () => {
    it('should calculate correct statistics', () => {
      const mesh1 = createTestMesh({ expressId: 1 });
      const mesh2 = createTestMesh({ expressId: 2 }); // Same geometry
      const mesh3 = createTestMesh({
        expressId: 3,
        positions: new Float32Array([0, 0, 0, 5, 5, 5, 2, 2, 2]), // Different
      });

      const instanced = deduplicateMeshes([mesh1, mesh2, mesh3]);
      const stats = getDeduplicationStats(instanced);

      assert.equal(stats.inputMeshes, 3);
      assert.equal(stats.uniqueGeometries, 2);
      assert.equal(stats.totalInstances, 3);
      assert.equal(stats.maxInstancesPerGeometry, 2); // mesh1 and mesh2
      assert.equal(stats.deduplicationRatio, 1.5); // 3/2
    });
  });
});

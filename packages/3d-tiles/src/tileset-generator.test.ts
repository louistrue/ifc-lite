/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { TilesetGenerator, computeGlobalBounds, computeGeometricError, aabbToBoundingVolume } from './tileset-generator.js';
import { buildGlbContent } from './tile-content-builder.js';
import { FederatedTilesetBuilder } from './federated-tileset-builder.js';
import { RemoteTileLoader } from './remote-tile-loader.js';
import { simplifyMesh, simplifyMeshes, simplifyForParentTile } from './mesh-simplifier.js';
import { ImplicitTilingGenerator, mortonEncode3D, mortonEncode2D } from './implicit-tiling-generator.js';
import type { MeshData, GeometryResult } from '@ifc-lite/geometry';

// ═══════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function makeMesh(expressId: number, x: number, y: number, z: number, size: number = 1): MeshData {
  const half = size / 2;
  // Simple box-like triangle at the given position
  return {
    expressId,
    positions: new Float32Array([
      x - half, y - half, z - half,
      x + half, y - half, z - half,
      x + half, y + half, z - half,
      x - half, y + half, z + half,
    ]),
    normals: new Float32Array([
      0, 0, -1,
      0, 0, -1,
      0, 0, -1,
      0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    color: [0.8, 0.8, 0.8, 1.0],
  };
}

/**
 * Create a mesh with many vertices for testing simplification.
 * Generates a subdivided plane with gridSize x gridSize quads.
 */
function makeDetailedMesh(expressId: number, x: number, y: number, z: number, gridSize: number = 8): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let gy = 0; gy <= gridSize; gy++) {
    for (let gx = 0; gx <= gridSize; gx++) {
      positions.push(x + gx, y + gy, z);
      normals.push(0, 0, 1);
    }
  }

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const i = gy * (gridSize + 1) + gx;
      indices.push(i, i + 1, i + gridSize + 1);
      indices.push(i + 1, i + gridSize + 2, i + gridSize + 1);
    }
  }

  return {
    expressId,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    color: [0.5, 0.5, 0.5, 1.0],
  };
}

function makeGeometryResult(meshes: MeshData[]): GeometryResult {
  let totalTriangles = 0;
  let totalVertices = 0;
  for (const m of meshes) {
    totalVertices += m.positions.length / 3;
    totalTriangles += m.indices.length / 3;
  }
  return {
    meshes,
    totalTriangles,
    totalVertices,
    coordinateInfo: {
      hasLargeCoordinates: false,
      shift: { x: 0, y: 0, z: 0 },
      bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// computeGlobalBounds
// ═══════════════════════════════════════════════════════════════════════════

describe('computeGlobalBounds', () => {
  it('computes bounds across multiple meshes', () => {
    const meshes = [
      makeMesh(1, 0, 0, 0),
      makeMesh(2, 10, 5, 3),
    ];
    const bounds = computeGlobalBounds(meshes);
    expect(bounds.min[0]).toBeLessThanOrEqual(-0.5);
    expect(bounds.max[0]).toBeGreaterThanOrEqual(10.5);
    expect(bounds.max[1]).toBeGreaterThanOrEqual(5.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeGeometricError
// ═══════════════════════════════════════════════════════════════════════════

describe('computeGeometricError', () => {
  it('returns half the diagonal of the bounding box', () => {
    const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 0, 0] as [number, number, number] };
    const error = computeGeometricError(bounds);
    expect(error).toBeCloseTo(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// aabbToBoundingVolume
// ═══════════════════════════════════════════════════════════════════════════

describe('aabbToBoundingVolume', () => {
  it('produces correct box format', () => {
    const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 6, 4] as [number, number, number] };
    const bv = aabbToBoundingVolume(bounds);
    expect(bv.box).toBeDefined();
    // Center: [5, 3, 2]
    expect(bv.box![0]).toBeCloseTo(5);
    expect(bv.box![1]).toBeCloseTo(3);
    expect(bv.box![2]).toBeCloseTo(2);
    // Half extents on diagonal: [5, 0, 0, 0, 3, 0, 0, 0, 2]
    expect(bv.box![3]).toBeCloseTo(5);
    expect(bv.box![7]).toBeCloseTo(3);
    expect(bv.box![11]).toBeCloseTo(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TilesetGenerator
// ═══════════════════════════════════════════════════════════════════════════

describe('TilesetGenerator', () => {
  it('generates an empty tileset from empty geometry', () => {
    const generator = new TilesetGenerator();
    const result = generator.generate({ meshes: [], totalTriangles: 0, totalVertices: 0, coordinateInfo: { hasLargeCoordinates: false, shift: { x: 0, y: 0, z: 0 }, bounds: { min: [0, 0, 0], max: [0, 0, 0] } } });
    expect(result.tileset.asset.version).toBe('1.1');
    expect(result.tiles).toHaveLength(0);
  });

  it('generates a single-tile tileset for small geometry', () => {
    const meshes = [makeMesh(1, 0, 0, 0), makeMesh(2, 1, 0, 0)];
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ maxMeshesPerTile: 10 });
    const result = generator.generate(geom);

    expect(result.tileset.asset.version).toBe('1.1');
    expect(result.tileset.root.boundingVolume.box).toBeDefined();
    expect(result.tiles.length).toBeGreaterThanOrEqual(1);
    // Should have content at the leaf
    expect(result.tiles[0].glb.byteLength).toBeGreaterThan(0);
    expect(result.tiles[0].expressIds).toContain(1);
    expect(result.tiles[0].expressIds).toContain(2);
  });

  it('splits into multiple tiles when meshes exceed limit', () => {
    // Create many meshes spread across space
    const meshes: MeshData[] = [];
    for (let i = 0; i < 20; i++) {
      meshes.push(makeMesh(i + 1, i * 10, 0, 0));
    }
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ maxMeshesPerTile: 5 });
    const result = generator.generate(geom);

    expect(result.tiles.length).toBeGreaterThan(1);
    // All express IDs should be covered
    const allIds = result.tiles.flatMap(t => t.expressIds).sort((a, b) => a - b);
    expect(allIds).toHaveLength(20);
    expect(allIds[0]).toBe(1);
    expect(allIds[19]).toBe(20);
  });

  it('includes metadata schema when enabled', () => {
    const meshes = [makeMesh(1, 0, 0, 0)];
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ includeMetadata: true, modelId: 'arch' });
    const result = generator.generate(geom);
    expect(result.tileset.schema?.id).toBe('ifc-lite-arch');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildGlbContent
// ═══════════════════════════════════════════════════════════════════════════

describe('buildGlbContent', () => {
  it('produces valid GLB magic bytes', () => {
    const meshes = [makeMesh(1, 0, 0, 0)];
    const glb = buildGlbContent(meshes);

    // GLB magic: 0x46546C67 = 'glTF'
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546C67);
    // Version 2
    expect(view.getUint32(4, true)).toBe(2);
  });

  it('handles empty mesh array', () => {
    const glb = buildGlbContent([]);
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546C67);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FederatedTilesetBuilder
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedTilesetBuilder', () => {
  it('creates empty root tileset with no models', () => {
    const builder = new FederatedTilesetBuilder();
    const result = builder.build([]);
    expect(result.asset.version).toBe('1.1');
    expect(result.root.geometricError).toBe(0);
  });

  it('creates federated tileset with multiple models', () => {
    const builder = new FederatedTilesetBuilder();
    const result = builder.build([
      {
        modelId: 'architecture',
        uri: 'arch/tileset.json',
        bounds: { min: [0, 0, 0], max: [50, 30, 10] },
      },
      {
        modelId: 'structure',
        uri: 'struct/tileset.json',
        bounds: { min: [0, 0, -5], max: [50, 30, 12] },
      },
      {
        modelId: 'mep',
        uri: 'mep/tileset.json',
        bounds: { min: [5, 5, 0], max: [45, 25, 9] },
      },
    ]);

    expect(result.asset.version).toBe('1.1');
    expect(result.root.children).toHaveLength(3);
    expect(result.root.children![0].content!.uri).toBe('arch/tileset.json');
    expect(result.root.children![1].content!.uri).toBe('struct/tileset.json');
    expect(result.root.children![2].content!.uri).toBe('mep/tileset.json');
    expect(result.root.refine).toBe('ADD');
  });

  it('includes model metadata schema when enabled', () => {
    const builder = new FederatedTilesetBuilder({ includeModelMetadata: true });
    const result = builder.build([
      {
        modelId: 'arch',
        uri: 'arch/tileset.json',
        bounds: { min: [0, 0, 0], max: [10, 10, 10] },
      },
    ]);
    expect(result.schema?.id).toBe('ifc-lite-federation');
    expect(result.schema?.classes?.IfcModel).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RemoteTileLoader
// ═══════════════════════════════════════════════════════════════════════════

describe('RemoteTileLoader', () => {
  it('resolves URLs correctly', async () => {
    const fetchedUrls: string[] = [];
    const mockFetch = async (url: string): Promise<Response> => {
      fetchedUrls.push(url);
      return new Response(JSON.stringify({
        asset: { version: '1.1' },
        geometricError: 100,
        root: {
          boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
          geometricError: 0,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const loader = new RemoteTileLoader({
      baseUrl: 'https://bucket.s3.amazonaws.com/project/',
      fetchFn: mockFetch as typeof fetch,
    });

    await loader.loadTileset('tileset.json');
    expect(fetchedUrls[0]).toBe('https://bucket.s3.amazonaws.com/project/tileset.json');
  });

  it('caches tilesets', async () => {
    let fetchCount = 0;
    const mockFetch = async (): Promise<Response> => {
      fetchCount++;
      return new Response(JSON.stringify({
        asset: { version: '1.1' },
        geometricError: 0,
        root: {
          boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
          geometricError: 0,
        },
      }), { status: 200 });
    };

    const loader = new RemoteTileLoader({
      baseUrl: 'https://example.com/',
      fetchFn: mockFetch as typeof fetch,
      enableCache: true,
    });

    await loader.loadTileset('tileset.json');
    await loader.loadTileset('tileset.json');
    expect(fetchCount).toBe(1);
  });

  it('reports cache stats', async () => {
    const mockFetch = async (url: string): Promise<Response> => {
      if (url.endsWith('.json')) {
        return new Response(JSON.stringify({
          asset: { version: '1.1' },
          geometricError: 0,
          root: { boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, geometricError: 0 },
        }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    };

    const loader = new RemoteTileLoader({
      baseUrl: 'https://example.com/',
      fetchFn: mockFetch as typeof fetch,
    });

    await loader.loadTileset('tileset.json');
    await loader.loadTileContent('tiles/tile_0.glb');

    const stats = loader.getCacheStats();
    expect(stats.tilesets).toBe(1);
    expect(stats.tiles).toBe(1);
    expect(stats.totalBytes).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mesh Simplifier
// ═══════════════════════════════════════════════════════════════════════════

describe('simplifyMesh', () => {
  it('returns null for empty mesh', () => {
    const mesh: MeshData = {
      expressId: 1,
      positions: new Float32Array([]),
      normals: new Float32Array([]),
      indices: new Uint32Array([]),
      color: [1, 1, 1, 1],
    };
    expect(simplifyMesh(mesh)).toBeNull();
  });

  it('preserves trivial meshes (≤ 4 triangles)', () => {
    const mesh = makeMesh(1, 0, 0, 0);
    const result = simplifyMesh(mesh);
    expect(result).not.toBeNull();
    expect(result!.indices.length).toBe(mesh.indices.length);
    expect(result!.expressId).toBe(1);
  });

  it('reduces vertex count on detailed meshes', () => {
    const mesh = makeDetailedMesh(42, 0, 0, 0, 16);
    const originalVertexCount = mesh.positions.length / 3;
    const originalTriCount = mesh.indices.length / 3;

    const result = simplifyMesh(mesh, { targetRatio: 0.25 });
    expect(result).not.toBeNull();

    const simplifiedVertexCount = result!.positions.length / 3;
    const simplifiedTriCount = result!.indices.length / 3;

    // Should have significantly fewer vertices and triangles
    expect(simplifiedVertexCount).toBeLessThan(originalVertexCount);
    expect(simplifiedTriCount).toBeLessThan(originalTriCount);
    expect(result!.expressId).toBe(42);
  });

  it('preserves expressId and color', () => {
    const mesh = makeDetailedMesh(99, 5, 5, 5, 10);
    mesh.color = [0.2, 0.4, 0.6, 0.8];

    const result = simplifyMesh(mesh);
    expect(result).not.toBeNull();
    expect(result!.expressId).toBe(99);
    expect(result!.color).toEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it('produces valid normals (normalized)', () => {
    const mesh = makeDetailedMesh(1, 0, 0, 0, 12);
    const result = simplifyMesh(mesh);
    expect(result).not.toBeNull();

    // Check that normals are unit vectors
    for (let i = 0; i < result!.normals.length; i += 3) {
      const nx = result!.normals[i], ny = result!.normals[i + 1], nz = result!.normals[i + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(len).toBeCloseTo(1.0, 3);
    }
  });
});

describe('simplifyMeshes', () => {
  it('simplifies multiple meshes preserving all', () => {
    const meshes = [
      makeDetailedMesh(1, 0, 0, 0, 10),
      makeDetailedMesh(2, 20, 0, 0, 10),
      makeDetailedMesh(3, 40, 0, 0, 10),
    ];

    const results = simplifyMeshes(meshes);
    expect(results).toHaveLength(3);
    expect(results.map(m => m.expressId)).toEqual([1, 2, 3]);
  });
});

describe('simplifyForParentTile', () => {
  it('produces more aggressive simplification at lower depths', () => {
    const meshes = [
      makeDetailedMesh(1, 0, 0, 0, 16),
      makeDetailedMesh(2, 20, 0, 0, 16),
    ];

    const rootLevel = simplifyForParentTile(meshes, 0, 5);
    const midLevel = simplifyForParentTile(meshes, 3, 5);

    const rootTriCount = rootLevel.reduce((sum, m) => sum + m.indices.length / 3, 0);
    const midTriCount = midLevel.reduce((sum, m) => sum + m.indices.length / 3, 0);

    // Root level (depth 0) should have fewer triangles than mid level (depth 3)
    expect(rootTriCount).toBeLessThanOrEqual(midTriCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPLACE Refinement
// ═══════════════════════════════════════════════════════════════════════════

describe('TilesetGenerator REPLACE mode', () => {
  it('generates parent tiles with LOD content in REPLACE mode', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 20; i++) {
      meshes.push(makeDetailedMesh(i + 1, i * 15, 0, 0, 8));
    }
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ maxMeshesPerTile: 5, refine: 'REPLACE' });
    const result = generator.generate(geom);

    // Should have more tiles than ADD mode (parent LOD tiles + leaf tiles)
    expect(result.tiles.length).toBeGreaterThan(4);

    // Root tile should use REPLACE refinement
    expect(result.tileset.root.refine).toBe('REPLACE');

    // Internal nodes should have content (LOD GLBs)
    const hasParentContent = result.tiles.some(t => t.path.includes('lod'));
    expect(hasParentContent).toBe(true);
  });

  it('parent LOD tiles have valid GLB format', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 20; i++) {
      meshes.push(makeDetailedMesh(i + 1, i * 15, 0, 0, 8));
    }
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ maxMeshesPerTile: 5, refine: 'REPLACE' });
    const result = generator.generate(geom);

    const lodTiles = result.tiles.filter(t => t.path.includes('lod'));
    for (const tile of lodTiles) {
      const view = new DataView(tile.glb.buffer, tile.glb.byteOffset, tile.glb.byteLength);
      expect(view.getUint32(0, true)).toBe(0x46546C67); // glTF magic
      expect(view.getUint32(4, true)).toBe(2); // version 2
    }
  });

  it('falls back to ADD when refine option is ADD (default)', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 20; i++) {
      meshes.push(makeMesh(i + 1, i * 10, 0, 0));
    }
    const geom = makeGeometryResult(meshes);
    const generator = new TilesetGenerator({ maxMeshesPerTile: 5 });
    const result = generator.generate(geom);

    // No LOD tiles should exist
    const hasLodTiles = result.tiles.some(t => t.path.includes('lod'));
    expect(hasLodTiles).toBe(false);

    // Root should use ADD
    if (result.tileset.root.children) {
      expect(result.tileset.root.refine).toBe('ADD');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Morton Codes
// ═══════════════════════════════════════════════════════════════════════════

describe('Morton encoding', () => {
  it('mortonEncode3D produces unique values for distinct inputs', () => {
    const codes = new Set<number>();
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          codes.add(mortonEncode3D(x, y, z));
        }
      }
    }
    // 4x4x4 = 64 unique codes
    expect(codes.size).toBe(64);
  });

  it('mortonEncode3D(0,0,0) is 0', () => {
    expect(mortonEncode3D(0, 0, 0)).toBe(0);
  });

  it('mortonEncode2D produces unique values for distinct inputs', () => {
    const codes = new Set<number>();
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        codes.add(mortonEncode2D(x, y));
      }
    }
    // 8x8 = 64 unique codes
    expect(codes.size).toBe(64);
  });

  it('mortonEncode2D preserves spatial locality', () => {
    // Adjacent cells should have nearby Morton codes
    const m00 = mortonEncode2D(0, 0);
    const m10 = mortonEncode2D(1, 0);
    const m01 = mortonEncode2D(0, 1);
    expect(Math.abs(m10 - m00)).toBeLessThanOrEqual(2);
    expect(Math.abs(m01 - m00)).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ImplicitTilingGenerator
// ═══════════════════════════════════════════════════════════════════════════

describe('ImplicitTilingGenerator', () => {
  it('generates empty output for empty geometry', () => {
    const generator = new ImplicitTilingGenerator();
    const result = generator.generate({
      meshes: [],
      totalTriangles: 0,
      totalVertices: 0,
      coordinateInfo: {
        hasLargeCoordinates: false,
        shift: { x: 0, y: 0, z: 0 },
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      },
    });
    expect(result.tileset.asset.version).toBe('1.1');
    expect(result.tiles).toHaveLength(0);
    expect(result.subtrees).toHaveLength(0);
  });

  it('generates octree implicit tileset for many meshes', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 50; i++) {
      meshes.push(makeMesh(i + 1, i * 5, (i % 5) * 5, (i % 3) * 5));
    }
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      subdivisionScheme: 'OCTREE',
      maxMeshesPerTile: 10,
      subtreeLevels: 3,
    });
    const result = generator.generate(geom);

    // Should have implicit tiling on root
    expect(result.tileset.root.implicitTiling).toBeDefined();
    expect(result.tileset.root.implicitTiling!.subdivisionScheme).toBe('OCTREE');
    expect(result.tileset.root.refine).toBe('REPLACE');

    // Should have tile content
    expect(result.tiles.length).toBeGreaterThan(0);

    // Should have at least one subtree
    expect(result.subtrees.length).toBeGreaterThan(0);

    // All tiles should have valid GLB content
    for (const tile of result.tiles) {
      expect(tile.glb.byteLength).toBeGreaterThan(0);
      const view = new DataView(tile.glb.buffer, tile.glb.byteOffset, tile.glb.byteLength);
      expect(view.getUint32(0, true)).toBe(0x46546C67);
    }
  });

  it('generates quadtree implicit tileset', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 30; i++) {
      meshes.push(makeMesh(i + 1, i * 5, (i % 5) * 5, 0));
    }
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      subdivisionScheme: 'QUADTREE',
      maxMeshesPerTile: 8,
    });
    const result = generator.generate(geom);

    expect(result.tileset.root.implicitTiling!.subdivisionScheme).toBe('QUADTREE');
    expect(result.tiles.length).toBeGreaterThan(0);
    expect(result.subtrees.length).toBeGreaterThan(0);
  });

  it('subtree availability bitstreams have correct structure', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 40; i++) {
      meshes.push(makeMesh(i + 1, i * 5, (i % 4) * 5, (i % 2) * 5));
    }
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      subdivisionScheme: 'OCTREE',
      maxMeshesPerTile: 10,
      subtreeLevels: 2,
    });
    const result = generator.generate(geom);

    for (const subtree of result.subtrees) {
      // Each subtree should have tile and content availability
      expect(subtree.subtreeJson.tileAvailability).toBeDefined();
      expect(subtree.subtreeJson.contentAvailability).toHaveLength(1);

      // Buffer should exist and have non-zero length
      expect(subtree.buffer.byteLength).toBeGreaterThan(0);

      // Buffer views should reference valid ranges
      if (subtree.subtreeJson.bufferViews) {
        for (const bv of subtree.subtreeJson.bufferViews) {
          expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(subtree.buffer.byteLength);
        }
      }
    }
  });

  it('content template URI matches tile paths', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 20; i++) {
      meshes.push(makeMesh(i + 1, i * 10, (i % 3) * 10, 0));
    }
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      subdivisionScheme: 'OCTREE',
      maxMeshesPerTile: 5,
      contentBasePath: './tiles/',
    });
    const result = generator.generate(geom);

    // Content URI template should use the configured base path
    expect(result.tileset.root.content!.uri).toContain('./tiles/');

    // All generated tile paths should match the template pattern
    for (const tile of result.tiles) {
      expect(tile.path).toMatch(/^\.\/tiles\/\d+\/\d+\/\d+\/\d+\.glb$/);
    }
  });

  it('includes metadata schema when enabled', () => {
    const meshes = [makeMesh(1, 0, 0, 0)];
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      includeMetadata: true,
      modelId: 'test-model',
    });
    const result = generator.generate(geom);

    expect(result.tileset.schema?.id).toBe('ifc-lite-implicit-test-model');
  });

  it('covers all express IDs across generated tiles', () => {
    const meshes: MeshData[] = [];
    for (let i = 0; i < 30; i++) {
      meshes.push(makeMesh(i + 1, i * 5, (i % 5) * 5, (i % 3) * 5));
    }
    const geom = makeGeometryResult(meshes);

    const generator = new ImplicitTilingGenerator({
      subdivisionScheme: 'OCTREE',
      maxMeshesPerTile: 8,
    });
    const result = generator.generate(geom);

    // Leaf-level tiles (deepest level) should cover all express IDs
    // Note: parent tiles also have expressIds due to LOD simplification,
    // but we just check that every input ID appears somewhere
    const allIds = new Set(result.tiles.flatMap(t => t.expressIds));
    for (let i = 1; i <= 30; i++) {
      expect(allIds.has(i)).toBe(true);
    }
  });
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TilesetGenerator - Convert IFC geometry into a 3D Tiles 1.1 tileset
 *
 * Takes GeometryResult (meshes with positions, normals, indices) and produces
 * a tileset.json with a spatial octree hierarchy, where each leaf tile is a
 * GLB file containing a subset of meshes.
 *
 * The spatial subdivision uses the existing BVH infrastructure from @ifc-lite/spatial
 * to group meshes by bounding volume.
 */

import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import type { AABB } from '@ifc-lite/spatial';
import type {
  Tile,
  Tileset,
  TilesetGeneratorOptions,
  TilesetOutput,
  GeneratedTile,
  BoundingVolume,
} from './types.js';
import { buildGlbContent } from './tile-content-builder.js';
import { simplifyForParentTile } from './mesh-simplifier.js';

const DEFAULT_MAX_MESHES_PER_TILE = 256;
const DEFAULT_CONTENT_BASE_PATH = './tiles/';

/**
 * Generate a complete 3D Tiles 1.1 tileset from IFC geometry.
 *
 * The geometry is spatially subdivided into an octree. Each leaf node
 * becomes a tile with GLB content containing the meshes in that region.
 */
export class TilesetGenerator {
  private options: Required<TilesetGeneratorOptions>;

  constructor(options: TilesetGeneratorOptions = {}) {
    this.options = {
      maxMeshesPerTile: options.maxMeshesPerTile ?? DEFAULT_MAX_MESHES_PER_TILE,
      minGeometricError: options.minGeometricError ?? 0,
      contentBasePath: options.contentBasePath ?? DEFAULT_CONTENT_BASE_PATH,
      includeMetadata: options.includeMetadata ?? true,
      modelId: options.modelId ?? 'default',
      refine: options.refine ?? 'ADD',
    };
  }

  /**
   * Generate tileset from geometry result.
   * Returns the tileset.json and all tile GLB files.
   */
  generate(geometryResult: GeometryResult): TilesetOutput {
    const meshes = geometryResult.meshes.filter(
      m => m.positions.length > 0 && m.indices.length > 0
    );

    if (meshes.length === 0) {
      return this.buildEmptyTileset();
    }

    // Compute global bounding box
    const globalBounds = computeGlobalBounds(meshes);
    const globalGeometricError = computeGeometricError(globalBounds);

    // Build spatial tree
    const tiles: GeneratedTile[] = [];
    let tileIndex = 0;

    // Estimate max depth for LOD simplification ratio scaling
    const estimatedMaxDepth = Math.min(
      15,
      Math.ceil(Math.log2(meshes.length / this.options.maxMeshesPerTile)) + 1,
    );

    const rootTile = this.buildTileTree(
      meshes,
      globalBounds,
      globalGeometricError,
      tiles,
      () => tileIndex++,
      0,
      Math.max(1, estimatedMaxDepth),
    );

    const tileset: Tileset = {
      asset: {
        version: '1.1',
        generator: 'IFC-Lite',
        tilesetVersion: '1.0.0',
      },
      geometricError: globalGeometricError,
      root: rootTile,
    };

    if (this.options.includeMetadata) {
      tileset.schema = {
        id: `ifc-lite-${this.options.modelId}`,
        classes: {
          IfcElement: {
            name: 'IFC Element',
            properties: {
              expressId: { type: 'SCALAR', componentType: 'UINT32', description: 'IFC Express ID' },
            },
          },
        },
      };
    }

    return { tileset, tiles };
  }

  /**
   * Recursively build the tile tree by spatially subdividing meshes.
   *
   * In ADD mode, internal nodes have no content; leaf tiles hold all geometry.
   * In REPLACE mode, internal nodes contain simplified LOD geometry;
   * children replace the parent as the viewer zooms in.
   */
  private buildTileTree(
    meshes: MeshData[],
    bounds: AABB,
    geometricError: number,
    outputTiles: GeneratedTile[],
    nextTileIndex: () => number,
    depth: number,
    maxDepth: number,
  ): Tile {
    const boundingVolume = aabbToBoundingVolume(bounds);

    // Leaf condition: few enough meshes or small enough error
    if (
      meshes.length <= this.options.maxMeshesPerTile ||
      geometricError <= this.options.minGeometricError ||
      depth > 15 // safety limit
    ) {
      return this.buildLeafTile(meshes, boundingVolume, outputTiles, nextTileIndex);
    }

    // Split along longest axis
    const size = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const axis = size[0] >= size[1] && size[0] >= size[2] ? 0
      : size[1] >= size[2] ? 1 : 2;
    const mid = (bounds.min[axis] + bounds.max[axis]) / 2;

    // Partition meshes by centroid
    const left: MeshData[] = [];
    const right: MeshData[] = [];

    for (const mesh of meshes) {
      const centroid = meshCentroid(mesh, axis);
      if (centroid <= mid) {
        left.push(mesh);
      } else {
        right.push(mesh);
      }
    }

    // If partition failed (all on one side), fall through to leaf
    if (left.length === 0 || right.length === 0) {
      return this.buildLeafTile(meshes, boundingVolume, outputTiles, nextTileIndex);
    }

    const leftBounds = computeGlobalBounds(left);
    const rightBounds = computeGlobalBounds(right);
    const childError = geometricError / 2;

    const children: Tile[] = [
      this.buildTileTree(left, leftBounds, childError, outputTiles, nextTileIndex, depth + 1, maxDepth),
      this.buildTileTree(right, rightBounds, childError, outputTiles, nextTileIndex, depth + 1, maxDepth),
    ];

    const refine = this.options.refine;

    // In REPLACE mode, parent tiles get simplified LOD content
    if (refine === 'REPLACE') {
      const simplified = simplifyForParentTile(meshes, depth, maxDepth);
      if (simplified.length > 0) {
        const idx = nextTileIndex();
        const path = `${this.options.contentBasePath}tile_lod_${idx}.glb`;
        const glb = buildGlbContent(simplified);
        const expressIds = simplified.map(m => m.expressId);
        outputTiles.push({ path, glb, expressIds });

        return {
          boundingVolume,
          geometricError,
          refine: 'REPLACE',
          content: { uri: path },
          children,
        };
      }
    }

    return {
      boundingVolume,
      geometricError,
      refine,
      children,
    };
  }

  /**
   * Build a leaf tile with GLB content.
   */
  private buildLeafTile(
    meshes: MeshData[],
    boundingVolume: BoundingVolume,
    outputTiles: GeneratedTile[],
    nextTileIndex: () => number,
  ): Tile {
    const idx = nextTileIndex();
    const path = `${this.options.contentBasePath}tile_${idx}.glb`;
    const glb = buildGlbContent(meshes);
    const expressIds = meshes.map(m => m.expressId);

    outputTiles.push({ path, glb, expressIds });

    return {
      boundingVolume,
      geometricError: this.options.minGeometricError,
      content: { uri: path },
    };
  }

  private buildEmptyTileset(): TilesetOutput {
    return {
      tileset: {
        asset: { version: '1.1', generator: 'IFC-Lite' },
        geometricError: 0,
        root: {
          boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
          geometricError: 0,
        },
      },
      tiles: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function meshCentroid(mesh: MeshData, axis: number): number {
  let sum = 0;
  const count = mesh.positions.length / 3;
  for (let i = axis; i < mesh.positions.length; i += 3) {
    sum += mesh.positions[i];
  }
  return sum / count;
}

export function computeGlobalBounds(meshes: MeshData[]): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Compute geometric error from bounding box diagonal (in meters).
 * This is a heuristic: root error = diagonal / 2, halved at each tree level.
 */
export function computeGeometricError(bounds: AABB): number {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

/**
 * Convert an AABB to a 3D Tiles bounding volume box.
 * The box format is: [centerX, centerY, centerZ, halfX, 0, 0, 0, halfY, 0, 0, 0, halfZ]
 */
export function aabbToBoundingVolume(bounds: AABB): BoundingVolume {
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const hx = (bounds.max[0] - bounds.min[0]) / 2;
  const hy = (bounds.max[1] - bounds.min[1]) / 2;
  const hz = (bounds.max[2] - bounds.min[2]) / 2;

  return {
    box: [cx, cy, cz, hx, 0, 0, 0, hy, 0, 0, 0, hz],
  };
}

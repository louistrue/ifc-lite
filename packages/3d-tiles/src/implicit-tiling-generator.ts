/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ImplicitTilingGenerator - Generate 3D Tiles 1.1 implicit tilesets
 *
 * For very large models (millions of elements) the explicit tile tree in
 * tileset.json becomes prohibitively large. Implicit tiling defines the
 * tree structure algorithmically (octree or quadtree) and stores only
 * availability bitstreams in compact subtree files.
 *
 * Each tile's content URI follows a template: `{level}/{x}/{y}/{z}.glb`
 * (octree) or `{level}/{x}/{y}.glb` (quadtree). The viewer can derive
 * bounding volumes and geometric errors from the level alone.
 *
 * References:
 * - OGC 3D Tiles 1.1 Implicit Tiling:
 *   https://docs.ogc.org/cs/22-025r4/22-025r4.html#toc62
 * - CesiumGS/3d-tiles implicit tiling spec:
 *   https://github.com/CesiumGS/3d-tiles/blob/main/specification/ImplicitTiling/README.adoc
 */

import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import type { AABB } from '@ifc-lite/spatial';
import type {
  Tileset,
  BoundingVolume,
  ImplicitTilesetGeneratorOptions,
  ImplicitTilesetOutput,
  GeneratedTile,
  GeneratedSubtree,
  Subtree,
} from './types.js';
import { buildGlbContent } from './tile-content-builder.js';
import { computeGlobalBounds, computeGeometricError, aabbToBoundingVolume } from './tileset-generator.js';
import { simplifyForParentTile } from './mesh-simplifier.js';

const DEFAULT_SUBTREE_LEVELS = 4;

/**
 * Morton code helpers for spatial indexing.
 *
 * Morton codes (Z-order curves) interleave the bits of x, y, z coordinates
 * to produce a single integer that preserves spatial locality.
 */

function spreadBits3(v: number): number {
  // Spread bits of a 10-bit value to every 3rd bit position
  v = v & 0x3FF;
  v = (v | (v << 16)) & 0x030000FF;
  v = (v | (v << 8)) & 0x0300F00F;
  v = (v | (v << 4)) & 0x030C30C3;
  v = (v | (v << 2)) & 0x09249249;
  return v;
}

function mortonEncode3D(x: number, y: number, z: number): number {
  return spreadBits3(x) | (spreadBits3(y) << 1) | (spreadBits3(z) << 2);
}

function spreadBits2(v: number): number {
  v = v & 0xFFFF;
  v = (v | (v << 8)) & 0x00FF00FF;
  v = (v | (v << 4)) & 0x0F0F0F0F;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v;
}

function mortonEncode2D(x: number, y: number): number {
  return spreadBits2(x) | (spreadBits2(y) << 1);
}

/**
 * An implicit octree/quadtree node, identified by level + coordinates.
 */
interface ImplicitNode {
  level: number;
  x: number;
  y: number;
  z: number; // always 0 for quadtree
  bounds: AABB;
  meshIndices: number[];
  mortonIndex: number;
}

/**
 * Generate a 3D Tiles 1.1 tileset with implicit tiling.
 *
 * Instead of an explicit tree of tiles in tileset.json, this produces:
 * - A single root tile with `implicitTiling` extension
 * - Subtree files (`.subtree`) containing availability bitstreams
 * - GLB tiles named by template `{level}/{x}/{y}/{z}.glb`
 */
export class ImplicitTilingGenerator {
  private options: Required<ImplicitTilesetGeneratorOptions>;

  constructor(options: ImplicitTilesetGeneratorOptions = {}) {
    this.options = {
      subdivisionScheme: options.subdivisionScheme ?? 'OCTREE',
      maxMeshesPerTile: options.maxMeshesPerTile ?? 256,
      subtreeLevels: options.subtreeLevels ?? DEFAULT_SUBTREE_LEVELS,
      contentBasePath: options.contentBasePath ?? './tiles/',
      subtreeBasePath: options.subtreeBasePath ?? './subtrees/',
      includeMetadata: options.includeMetadata ?? true,
      modelId: options.modelId ?? 'default',
      minGeometricError: options.minGeometricError ?? 0,
    };
  }

  /**
   * Generate an implicit tileset from IFC geometry.
   */
  generate(geometryResult: GeometryResult): ImplicitTilesetOutput {
    const meshes = geometryResult.meshes.filter(
      m => m.positions.length > 0 && m.indices.length > 0
    );

    if (meshes.length === 0) {
      return this.buildEmptyOutput();
    }

    const globalBounds = computeGlobalBounds(meshes);
    const globalError = computeGeometricError(globalBounds);
    const isOctree = this.options.subdivisionScheme === 'OCTREE';

    // Determine how many levels we need
    const availableLevels = this.computeAvailableLevels(meshes.length);

    // Build the implicit tree: assign meshes to nodes at each level
    const nodes = this.buildImplicitTree(meshes, globalBounds, availableLevels, isOctree);

    // Generate tile content (GLB files) for nodes that have meshes
    const tiles: GeneratedTile[] = [];
    const nodeHasContent = new Map<string, boolean>();

    for (const node of nodes) {
      if (node.meshIndices.length === 0) continue;

      const nodeMeshes = node.meshIndices.map(i => meshes[i]);
      const isLeaf = node.level === availableLevels - 1;

      // For non-leaf nodes, generate simplified LOD content
      const contentMeshes = isLeaf
        ? nodeMeshes
        : simplifyForParentTile(nodeMeshes, node.level, availableLevels - 1);

      if (contentMeshes.length === 0) continue;

      const path = this.tileContentPath(node, isOctree);
      const glb = buildGlbContent(contentMeshes);
      const expressIds = contentMeshes.map(m => m.expressId);

      tiles.push({ path, glb, expressIds });
      nodeHasContent.set(nodeKey(node), true);
    }

    // Generate subtree files
    const subtrees = this.generateSubtrees(
      nodes,
      nodeHasContent,
      availableLevels,
      isOctree,
    );

    // Build the tileset.json with implicit tiling on the root
    const rootBoundingVolume = this.makeRootBoundingVolume(globalBounds, isOctree);

    const tileset: Tileset = {
      asset: {
        version: '1.1',
        generator: 'IFC-Lite Implicit',
        tilesetVersion: '1.0.0',
      },
      geometricError: globalError,
      root: {
        boundingVolume: rootBoundingVolume,
        geometricError: globalError,
        refine: 'REPLACE',
        content: {
          uri: isOctree
            ? `${this.options.contentBasePath}{level}/{x}/{y}/{z}.glb`
            : `${this.options.contentBasePath}{level}/{x}/{y}.glb`,
        },
        implicitTiling: {
          subdivisionScheme: this.options.subdivisionScheme,
          subtreeLevels: this.options.subtreeLevels,
          availableLevels,
          subtrees: {
            uri: isOctree
              ? `${this.options.subtreeBasePath}{level}/{x}/{y}/{z}.subtree`
              : `${this.options.subtreeBasePath}{level}/{x}/{y}.subtree`,
          },
        },
      },
    };

    if (this.options.includeMetadata) {
      tileset.schema = {
        id: `ifc-lite-implicit-${this.options.modelId}`,
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

    return { tileset, tiles, subtrees };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TREE CONSTRUCTION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Compute number of levels needed based on mesh count and max per tile.
   */
  private computeAvailableLevels(meshCount: number): number {
    if (meshCount <= this.options.maxMeshesPerTile) return 1;

    const branchFactor = this.options.subdivisionScheme === 'OCTREE' ? 8 : 4;
    // levels = ceil(log_branchFactor(meshCount / maxPerTile)) + 1
    let levels = Math.ceil(
      Math.log(meshCount / this.options.maxMeshesPerTile) / Math.log(branchFactor)
    ) + 1;

    // Clamp to reasonable range
    return Math.max(1, Math.min(levels, 15));
  }

  /**
   * Build the implicit tree by assigning meshes to nodes at every level.
   *
   * For each mesh, we compute which cell it belongs to at the deepest level,
   * then propagate it up to all ancestor levels.
   */
  private buildImplicitTree(
    meshes: MeshData[],
    globalBounds: AABB,
    availableLevels: number,
    isOctree: boolean,
  ): ImplicitNode[] {
    const nodesMap = new Map<string, ImplicitNode>();

    // Make the bounding box a cube (for octree) or square (for quadtree)
    // so cells are uniform at each level
    const uniformBounds = this.makeUniformBounds(globalBounds, isOctree);

    const bx = uniformBounds.min[0];
    const by = uniformBounds.min[1];
    const bz = uniformBounds.min[2];
    const sx = uniformBounds.max[0] - uniformBounds.min[0];
    const sy = uniformBounds.max[1] - uniformBounds.min[1];
    const sz = uniformBounds.max[2] - uniformBounds.min[2];

    const deepestLevel = availableLevels - 1;
    const divisionsAtDeepest = 1 << deepestLevel; // 2^deepestLevel

    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      // Compute mesh centroid
      let cx = 0, cy = 0, cz = 0;
      const vertCount = mesh.positions.length / 3;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        cx += mesh.positions[i];
        cy += mesh.positions[i + 1];
        cz += mesh.positions[i + 2];
      }
      cx /= vertCount; cy /= vertCount; cz /= vertCount;

      // Map centroid to deepest-level cell coordinates
      const gx = Math.min(Math.floor(((cx - bx) / sx) * divisionsAtDeepest), divisionsAtDeepest - 1);
      const gy = Math.min(Math.floor(((cy - by) / sy) * divisionsAtDeepest), divisionsAtDeepest - 1);
      const gz = isOctree
        ? Math.min(Math.floor(((cz - bz) / sz) * divisionsAtDeepest), divisionsAtDeepest - 1)
        : 0;

      // Add to all ancestor levels
      for (let level = 0; level < availableLevels; level++) {
        const shift = deepestLevel - level;
        const lx = gx >> shift;
        const ly = gy >> shift;
        const lz = isOctree ? (gz >> shift) : 0;

        const key = `${level}/${lx}/${ly}/${lz}`;
        let node = nodesMap.get(key);
        if (!node) {
          const cellSize = 1 << (deepestLevel - level);
          const cellSizeX = (sx / divisionsAtDeepest) * cellSize;
          const cellSizeY = (sy / divisionsAtDeepest) * cellSize;
          const cellSizeZ = isOctree ? (sz / divisionsAtDeepest) * cellSize : sz;

          node = {
            level,
            x: lx,
            y: ly,
            z: lz,
            bounds: {
              min: [
                bx + lx * cellSizeX,
                by + ly * cellSizeY,
                isOctree ? bz + lz * cellSizeZ : bz,
              ],
              max: [
                bx + lx * cellSizeX + cellSizeX,
                by + ly * cellSizeY + cellSizeY,
                isOctree ? bz + lz * cellSizeZ + cellSizeZ : bz + sz,
              ],
            },
            meshIndices: [],
            mortonIndex: isOctree
              ? mortonEncode3D(lx, ly, lz)
              : mortonEncode2D(lx, ly),
          };
          nodesMap.set(key, node);
        }

        // Only store mesh indices at the deepest level to avoid duplication
        // Parent nodes will simplify the meshes from all their descendants
        if (level === deepestLevel) {
          node.meshIndices.push(mi);
        }
      }
    }

    // Now populate parent nodes: each parent collects meshes from its children
    // Work from deepest level up to root
    for (let level = deepestLevel - 1; level >= 0; level--) {
      for (const node of nodesMap.values()) {
        if (node.level !== level) continue;

        // Collect mesh indices from direct children
        const childLevel = level + 1;
        const branchFactor = isOctree ? 2 : 2; // 2 subdivisions per axis
        for (let dx = 0; dx < branchFactor; dx++) {
          for (let dy = 0; dy < branchFactor; dy++) {
            if (isOctree) {
              for (let dz = 0; dz < branchFactor; dz++) {
                const childKey = `${childLevel}/${node.x * 2 + dx}/${node.y * 2 + dy}/${node.z * 2 + dz}`;
                const child = nodesMap.get(childKey);
                if (child) {
                  node.meshIndices.push(...child.meshIndices);
                }
              }
            } else {
              const childKey = `${childLevel}/${node.x * 2 + dx}/${node.y * 2 + dy}/0`;
              const child = nodesMap.get(childKey);
              if (child) {
                node.meshIndices.push(...child.meshIndices);
              }
            }
          }
        }
      }
    }

    return Array.from(nodesMap.values());
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUBTREE GENERATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate subtree files containing availability bitstreams.
   *
   * A subtree covers `subtreeLevels` of the implicit tree starting at a
   * given root node. The availability bitstreams encode:
   * - tileAvailability: which nodes in this subtree exist
   * - contentAvailability: which nodes have content (GLB)
   * - childSubtreeAvailability: which children at the bottom level
   *   have their own subtrees
   */
  private generateSubtrees(
    nodes: ImplicitNode[],
    nodeHasContent: Map<string, boolean>,
    availableLevels: number,
    isOctree: boolean,
  ): GeneratedSubtree[] {
    const subtreeLevels = Math.min(this.options.subtreeLevels, availableLevels);
    const subtrees: GeneratedSubtree[] = [];

    // Build a set of all existing nodes for fast lookup
    const nodeExists = new Set<string>();
    for (const node of nodes) {
      if (node.meshIndices.length > 0) {
        nodeExists.add(nodeKey(node));
      }
    }

    // Generate subtrees starting at level 0 and every subtreeLevels interval
    this.generateSubtreeRecursive(
      0, 0, 0, 0,
      subtreeLevels,
      availableLevels,
      isOctree,
      nodeExists,
      nodeHasContent,
      subtrees,
    );

    return subtrees;
  }

  private generateSubtreeRecursive(
    level: number,
    x: number,
    y: number,
    z: number,
    subtreeLevels: number,
    availableLevels: number,
    isOctree: boolean,
    nodeExists: Set<string>,
    nodeHasContent: Map<string, boolean>,
    subtrees: GeneratedSubtree[],
  ): void {
    const branchFactor = isOctree ? 8 : 4;

    // Total nodes in this subtree
    let totalNodes = 0;
    for (let l = 0; l < subtreeLevels; l++) {
      totalNodes += Math.pow(branchFactor, l);
    }

    // Number of potential child subtrees (nodes at the bottom level)
    const childSubtreeCount = Math.pow(branchFactor, subtreeLevels);

    // Build availability bitstreams
    const tileAvailBits = new Uint8Array(Math.ceil(totalNodes / 8));
    const contentAvailBits = new Uint8Array(Math.ceil(totalNodes / 8));
    const childSubtreeAvailBits = new Uint8Array(Math.ceil(childSubtreeCount / 8));

    let hasAnyTile = false;

    // Iterate over all nodes in this subtree
    let bitIndex = 0;
    for (let localLevel = 0; localLevel < subtreeLevels; localLevel++) {
      const globalLevel = level + localLevel;
      const divisionsPerAxis = 1 << localLevel;

      const rangeX = isOctree ? divisionsPerAxis : divisionsPerAxis;
      const rangeY = divisionsPerAxis;
      const rangeZ = isOctree ? divisionsPerAxis : 1;

      for (let lz = 0; lz < rangeZ; lz++) {
        for (let ly = 0; ly < rangeY; ly++) {
          for (let lx = 0; lx < rangeX; lx++) {
            const globalX = x * divisionsPerAxis + lx;
            const globalY = y * divisionsPerAxis + ly;
            const globalZ = isOctree ? z * divisionsPerAxis + lz : 0;

            const key = `${globalLevel}/${globalX}/${globalY}/${globalZ}`;

            if (nodeExists.has(key)) {
              tileAvailBits[bitIndex >> 3] |= (1 << (bitIndex & 7));
              hasAnyTile = true;

              if (nodeHasContent.has(key)) {
                contentAvailBits[bitIndex >> 3] |= (1 << (bitIndex & 7));
              }
            }

            bitIndex++;
          }
        }
      }
    }

    if (!hasAnyTile) return;

    // Check child subtrees at the bottom level of this subtree
    const nextSubtreeLevel = level + subtreeLevels;
    if (nextSubtreeLevel < availableLevels) {
      let childBitIndex = 0;
      const childDivisionsPerAxis = 1 << subtreeLevels;
      const childRangeZ = isOctree ? childDivisionsPerAxis : 1;

      for (let cz = 0; cz < childRangeZ; cz++) {
        for (let cy = 0; cy < childDivisionsPerAxis; cy++) {
          for (let cx = 0; cx < childDivisionsPerAxis; cx++) {
            const childGlobalX = x * childDivisionsPerAxis + cx;
            const childGlobalY = y * childDivisionsPerAxis + cy;
            const childGlobalZ = isOctree ? z * childDivisionsPerAxis + cz : 0;

            // Check if any node exists in the child subtree range
            const childKey = `${nextSubtreeLevel}/${childGlobalX}/${childGlobalY}/${childGlobalZ}`;
            if (nodeExists.has(childKey)) {
              childSubtreeAvailBits[childBitIndex >> 3] |= (1 << (childBitIndex & 7));

              // Recursively generate child subtree
              this.generateSubtreeRecursive(
                nextSubtreeLevel,
                childGlobalX,
                childGlobalY,
                childGlobalZ,
                Math.min(subtreeLevels, availableLevels - nextSubtreeLevel),
                availableLevels,
                isOctree,
                nodeExists,
                nodeHasContent,
                subtrees,
              );
            }

            childBitIndex++;
          }
        }
      }
    }

    // Pack subtree into binary format
    const buffer = packSubtreeBuffer(tileAvailBits, contentAvailBits, childSubtreeAvailBits);

    const subtreeJson: Subtree = {
      buffers: [{ byteLength: buffer.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: tileAvailBits.byteLength },
        { buffer: 0, byteOffset: tileAvailBits.byteLength, byteLength: contentAvailBits.byteLength },
        {
          buffer: 0,
          byteOffset: tileAvailBits.byteLength + contentAvailBits.byteLength,
          byteLength: childSubtreeAvailBits.byteLength,
        },
      ],
      tileAvailability: { bufferView: 0 },
      contentAvailability: [{ bufferView: 1 }],
      childSubtreeAvailability: nextSubtreeLevel < availableLevels
        ? { bufferView: 2 }
        : { constant: 0 },
    };

    const path = isOctree
      ? `${this.options.subtreeBasePath}${level}/${x}/${y}/${z}.subtree`
      : `${this.options.subtreeBasePath}${level}/${x}/${y}.subtree`;

    subtrees.push({ path, subtreeJson, buffer });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private tileContentPath(node: ImplicitNode, isOctree: boolean): string {
    return isOctree
      ? `${this.options.contentBasePath}${node.level}/${node.x}/${node.y}/${node.z}.glb`
      : `${this.options.contentBasePath}${node.level}/${node.x}/${node.y}.glb`;
  }

  /**
   * Make bounds uniform (cube for octree, square XY for quadtree)
   * so that cell subdivision is uniform at each level.
   */
  private makeUniformBounds(bounds: AABB, isOctree: boolean): AABB {
    const sx = bounds.max[0] - bounds.min[0];
    const sy = bounds.max[1] - bounds.min[1];
    const sz = bounds.max[2] - bounds.min[2];

    if (isOctree) {
      const maxSize = Math.max(sx, sy, sz);
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      const cz = (bounds.min[2] + bounds.max[2]) / 2;
      const half = maxSize / 2;
      return {
        min: [cx - half, cy - half, cz - half],
        max: [cx + half, cy + half, cz + half],
      };
    } else {
      const maxXY = Math.max(sx, sy);
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      const half = maxXY / 2;
      return {
        min: [cx - half, cy - half, bounds.min[2]],
        max: [cx + half, cy + half, bounds.max[2]],
      };
    }
  }

  /**
   * Root bounding volume for the implicit tileset.
   * Must be a cube (octree) or rectangular prism (quadtree) that tiles
   * the entire model extent.
   */
  private makeRootBoundingVolume(globalBounds: AABB, isOctree: boolean): BoundingVolume {
    const uniformBounds = this.makeUniformBounds(globalBounds, isOctree);
    return aabbToBoundingVolume(uniformBounds);
  }

  private buildEmptyOutput(): ImplicitTilesetOutput {
    return {
      tileset: {
        asset: { version: '1.1', generator: 'IFC-Lite Implicit' },
        geometricError: 0,
        root: {
          boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
          geometricError: 0,
        },
      },
      tiles: [],
      subtrees: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function nodeKey(node: ImplicitNode): string {
  return `${node.level}/${node.x}/${node.y}/${node.z}`;
}

/**
 * Pack availability bitstreams into a single binary buffer.
 * Concatenates all bitstreams with 8-byte alignment padding.
 */
function packSubtreeBuffer(
  tileAvail: Uint8Array,
  contentAvail: Uint8Array,
  childSubtreeAvail: Uint8Array,
): Uint8Array {
  const totalSize = tileAvail.byteLength + contentAvail.byteLength + childSubtreeAvail.byteLength;
  const buffer = new Uint8Array(totalSize);
  buffer.set(tileAvail, 0);
  buffer.set(contentAvail, tileAvail.byteLength);
  buffer.set(childSubtreeAvail, tileAvail.byteLength + contentAvail.byteLength);
  return buffer;
}

// Export Morton code functions for testing and external use
export { mortonEncode3D, mortonEncode2D };

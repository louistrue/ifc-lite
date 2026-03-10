/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D Tiles 1.1 type definitions
 * Based on OGC 3D Tiles specification
 * https://docs.ogc.org/cs/22-025r4/22-025r4.html
 */

// ═══════════════════════════════════════════════════════════════════════════
// TILESET
// ═══════════════════════════════════════════════════════════════════════════

export interface Tileset {
  asset: TilesetAsset;
  /** Geometric error at the root level (meters). Controls when root tile loads. */
  geometricError: number;
  root: Tile;
  /** Optional schema for metadata (3D Tiles 1.1) */
  schema?: TilesetSchema;
  /** Optional extension declarations */
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface TilesetAsset {
  version: '1.1';
  tilesetVersion?: string;
  generator?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE
// ═══════════════════════════════════════════════════════════════════════════

export interface Tile {
  boundingVolume: BoundingVolume;
  /**
   * Geometric error for this tile (meters).
   * When camera error < this value, children are loaded instead.
   * Leaf tiles should have geometricError = 0.
   */
  geometricError: number;
  /** Tile content (glTF/GLB in 3D Tiles 1.1) */
  content?: TileContent;
  /** Child tiles for LOD hierarchy */
  children?: Tile[];
  /** How to refine when switching to children */
  refine?: 'ADD' | 'REPLACE';
  /** Optional 4x4 column-major transform */
  transform?: number[];
  /** Implicit tiling extension (3D Tiles 1.1) */
  implicitTiling?: ImplicitTiling;
}

export interface TileContent {
  /** URI to the tile content (GLB file or external tileset.json) */
  uri: string;
  /** Optional bounding volume for the content (tighter than tile volume) */
  boundingVolume?: BoundingVolume;
  /** Optional metadata group (3D Tiles 1.1) */
  group?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPLICIT TILING (3D Tiles 1.1)
// ═══════════════════════════════════════════════════════════════════════════

export interface ImplicitTiling {
  /** Subdivision scheme */
  subdivisionScheme: 'QUADTREE' | 'OCTREE';
  /** Number of levels in each subtree */
  subtreeLevels: number;
  /** Number of levels available */
  availableLevels: number;
  /** Subtree file URI template (e.g., 'subtrees/{level}/{x}/{y}/{z}.subtree') */
  subtrees: { uri: string };
}

/**
 * Subtree descriptor per the 3D Tiles 1.1 implicit tiling spec.
 * Stores availability bitstreams for a portion of the implicit tree.
 */
export interface Subtree {
  /** Which tile nodes exist in this subtree */
  tileAvailability: Availability;
  /** Which tile nodes have content */
  contentAvailability: Availability[];
  /** Which child subtrees exist (for the bottom layer of this subtree) */
  childSubtreeAvailability: Availability;
  /** Inline binary buffers for availability bitstreams */
  buffers?: SubtreeBuffer[];
  /** Views into buffers */
  bufferViews?: SubtreeBufferView[];
}

export interface Availability {
  /** All available (constant true) */
  constant?: 0 | 1;
  /** Index into bufferViews for the bitstream */
  bufferView?: number;
}

export interface SubtreeBuffer {
  byteLength: number;
}

export interface SubtreeBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOUNDING VOLUMES
// ═══════════════════════════════════════════════════════════════════════════

export interface BoundingVolume {
  /** Axis-aligned bounding box: [centerX, centerY, centerZ, halfX, 0, 0, 0, halfY, 0, 0, 0, halfZ] */
  box?: number[];
  /** Bounding sphere: [centerX, centerY, centerZ, radius] */
  sphere?: number[];
  /** Geographic region: [west, south, east, north, minHeight, maxHeight] in radians */
  region?: number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA & METADATA (3D Tiles 1.1)
// ═══════════════════════════════════════════════════════════════════════════

export interface TilesetSchema {
  id: string;
  name?: string;
  description?: string;
  classes?: Record<string, SchemaClass>;
}

export interface SchemaClass {
  name?: string;
  description?: string;
  properties?: Record<string, SchemaProperty>;
}

export interface SchemaProperty {
  type: 'SCALAR' | 'STRING' | 'BOOLEAN' | 'ENUM' | 'VEC2' | 'VEC3' | 'VEC4';
  componentType?: 'INT8' | 'UINT8' | 'INT16' | 'UINT16' | 'INT32' | 'UINT32' | 'FLOAT32' | 'FLOAT64';
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATOR OPTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface TilesetGeneratorOptions {
  /** Maximum meshes per leaf tile (default: 256) */
  maxMeshesPerTile?: number;
  /** Minimum geometric error for leaf tiles in meters (default: 0) */
  minGeometricError?: number;
  /** Base path for tile content URIs (default: './tiles/') */
  contentBasePath?: string;
  /** Include IFC metadata in tileset schema (default: true) */
  includeMetadata?: boolean;
  /** Optional model identifier for federation */
  modelId?: string;
  /**
   * Refinement strategy (default: 'ADD').
   * - 'ADD': Parent tiles have no content; children are added on top.
   * - 'REPLACE': Parent tiles contain simplified LOD geometry;
   *   children replace the parent when the viewer zooms in.
   */
  refine?: 'ADD' | 'REPLACE';
}

export interface ImplicitTilesetGeneratorOptions {
  /** Subdivision scheme (default: 'OCTREE') */
  subdivisionScheme?: 'QUADTREE' | 'OCTREE';
  /** Maximum meshes per leaf tile (default: 256) */
  maxMeshesPerTile?: number;
  /** Number of levels per subtree file (default: 4) */
  subtreeLevels?: number;
  /** Base path for tile content URIs (default: './tiles/') */
  contentBasePath?: string;
  /** Base path for subtree files (default: './subtrees/') */
  subtreeBasePath?: string;
  /** Include IFC metadata in tileset schema (default: true) */
  includeMetadata?: boolean;
  /** Model identifier for federation */
  modelId?: string;
  /** Minimum geometric error in meters (default: 0) */
  minGeometricError?: number;
}

export interface ImplicitTilesetOutput {
  /** The tileset.json content */
  tileset: Tileset;
  /** Generated tile GLB files keyed by template path */
  tiles: GeneratedTile[];
  /** Generated subtree binary files */
  subtrees: GeneratedSubtree[];
}

export interface GeneratedSubtree {
  /** Path for this subtree (e.g., 'subtrees/0/0/0/0.subtree') */
  path: string;
  /** Subtree JSON descriptor */
  subtreeJson: Subtree;
  /** Binary buffer for availability bitstreams */
  buffer: Uint8Array;
}

export interface FederatedTilesetOptions {
  /** Base geometric error for the federated root (default: 100) */
  rootGeometricError?: number;
  /** Include per-model metadata groups */
  includeModelMetadata?: boolean;
}

export interface RemoteTileLoaderOptions {
  /** Base URL for fetching tiles (e.g., 'https://bucket.s3.amazonaws.com/project/') */
  baseUrl: string;
  /** Custom fetch function (for auth headers, etc.) */
  fetchFn?: typeof fetch;
  /** Maximum concurrent tile requests (default: 6) */
  maxConcurrency?: number;
  /** Cache parsed tilesets in memory (default: true) */
  enableCache?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATED OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratedTile {
  /** Path for this tile's content (e.g., 'tiles/tile_0.glb') */
  path: string;
  /** GLB binary content */
  glb: Uint8Array;
  /** Express IDs contained in this tile */
  expressIds: number[];
}

export interface TilesetOutput {
  /** The tileset.json content */
  tileset: Tileset;
  /** Generated tile GLB files */
  tiles: GeneratedTile[];
}

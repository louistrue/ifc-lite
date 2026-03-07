/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/3d-tiles - 3D Tiles 1.1 generation, federation, and remote loading
 *
 * Generate OGC 3D Tiles 1.1 tilesets from IFC geometry, federate multiple
 * models as external tilesets, and load tiles on-demand from cloud storage.
 *
 * Supports both explicit tile trees (ADD/REPLACE refinement with mesh
 * simplification for parent LOD) and implicit tiling (octree/quadtree with
 * availability bitstreams) for very large models.
 */

export { TilesetGenerator, computeGlobalBounds, computeGeometricError, aabbToBoundingVolume } from './tileset-generator.js';
export { FederatedTilesetBuilder, type ExternalTilesetRef } from './federated-tileset-builder.js';
export { RemoteTileLoader, type LoadedTile, type ViewFrustumParams } from './remote-tile-loader.js';
export { buildGlbContent } from './tile-content-builder.js';
export { simplifyMesh, simplifyMeshes, simplifyForParentTile } from './mesh-simplifier.js';
export { ImplicitTilingGenerator, mortonEncode3D, mortonEncode2D } from './implicit-tiling-generator.js';

export type {
  Tileset,
  TilesetAsset,
  Tile,
  TileContent,
  BoundingVolume,
  TilesetSchema,
  SchemaClass,
  SchemaProperty,
  TilesetGeneratorOptions,
  FederatedTilesetOptions,
  RemoteTileLoaderOptions,
  GeneratedTile,
  TilesetOutput,
  ImplicitTiling,
  Subtree,
  Availability,
  SubtreeBuffer,
  SubtreeBufferView,
  ImplicitTilesetGeneratorOptions,
  ImplicitTilesetOutput,
  GeneratedSubtree,
} from './types.js';

export type { SimplificationOptions } from './mesh-simplifier.js';

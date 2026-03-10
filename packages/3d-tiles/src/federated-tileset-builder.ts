/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FederatedTilesetBuilder - Combine multiple IFC model tilesets
 *
 * Creates a root tileset.json that references external tilesets (one per model).
 * This enables model federation at the 3D Tiles level: each discipline
 * (architecture, structure, MEP) is an independent tileset that can be
 * loaded, unloaded, and updated separately.
 *
 * The root tileset uses the 'ADD' refine strategy so all models are
 * composited together. Each child references an external tileset.json URI.
 */

import type { AABB } from '@ifc-lite/spatial';
import { AABBUtils } from '@ifc-lite/spatial';
import type {
  Tileset,
  Tile,
  FederatedTilesetOptions,
  BoundingVolume,
} from './types.js';
import { aabbToBoundingVolume, computeGeometricError } from './tileset-generator.js';

export interface ExternalTilesetRef {
  /** Unique model identifier (e.g., 'architecture', 'structure', 'mep') */
  modelId: string;
  /** URI to the model's tileset.json (relative or absolute) */
  uri: string;
  /** Bounding box of this model (for the root tile's bounding volume) */
  bounds: AABB;
  /** Optional 4x4 column-major transform to apply to this model */
  transform?: number[];
}

/**
 * Build a federated root tileset that references external tilesets.
 *
 * Each model is an external tileset child. Viewers that support
 * 3D Tiles will fetch each child tileset independently, enabling:
 * - Independent loading/unloading of disciplines
 * - Separate update cycles (re-export structure without touching arch)
 * - Parallel fetching from different storage locations
 */
export class FederatedTilesetBuilder {
  private options: Required<FederatedTilesetOptions>;

  constructor(options: FederatedTilesetOptions = {}) {
    this.options = {
      rootGeometricError: options.rootGeometricError ?? 100,
      includeModelMetadata: options.includeModelMetadata ?? true,
    };
  }

  /**
   * Build a federated root tileset from external tileset references.
   */
  build(models: ExternalTilesetRef[]): Tileset {
    if (models.length === 0) {
      return this.buildEmptyRoot();
    }

    // Compute combined bounding volume across all models
    let combinedBounds = models[0].bounds;
    for (let i = 1; i < models.length; i++) {
      combinedBounds = AABBUtils.union(combinedBounds, models[i].bounds);
    }

    const rootError = Math.max(
      this.options.rootGeometricError,
      computeGeometricError(combinedBounds),
    );

    // Each model becomes a child tile pointing to an external tileset
    const children: Tile[] = models.map(model => {
      const tile: Tile = {
        boundingVolume: aabbToBoundingVolume(model.bounds),
        geometricError: rootError / 2,
        content: {
          uri: model.uri,
        },
        refine: 'ADD',
      };

      if (model.transform) {
        tile.transform = model.transform;
      }

      return tile;
    });

    const tileset: Tileset = {
      asset: {
        version: '1.1',
        generator: 'IFC-Lite Federation',
        tilesetVersion: '1.0.0',
      },
      geometricError: rootError,
      root: {
        boundingVolume: aabbToBoundingVolume(combinedBounds),
        geometricError: rootError,
        refine: 'ADD',
        children,
      },
    };

    if (this.options.includeModelMetadata) {
      tileset.schema = {
        id: 'ifc-lite-federation',
        classes: {
          IfcModel: {
            name: 'IFC Model',
            properties: {
              modelId: { type: 'STRING', description: 'Model discipline identifier' },
            },
          },
        },
      };
    }

    return tileset;
  }

  private buildEmptyRoot(): Tileset {
    return {
      asset: { version: '1.1', generator: 'IFC-Lite Federation' },
      geometricError: 0,
      root: {
        boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
        geometricError: 0,
      },
    };
  }
}

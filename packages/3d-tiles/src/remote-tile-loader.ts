/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RemoteTileLoader - Load 3D Tiles on-demand from remote storage
 *
 * Fetches tileset.json and individual tile GLB files from cloud storage
 * (S3, GCS, Azure Blob, or any HTTP endpoint). Supports:
 *
 * - Partial loading: Only fetch tiles visible in the current view
 * - Concurrency control: Limit parallel requests to avoid overwhelming the network
 * - Caching: Keep parsed tilesets in memory to avoid re-fetching
 * - External tilesets: Recursively resolves federated tileset references
 */

import type { Tileset, Tile, RemoteTileLoaderOptions } from './types.js';

export interface LoadedTile {
  /** The tile metadata */
  tile: Tile;
  /** GLB content bytes (null if not yet loaded or no content) */
  content: Uint8Array | null;
  /** URI this content was loaded from */
  uri: string;
  /** Whether this tile's content has been loaded */
  loaded: boolean;
}

export interface ViewFrustumParams {
  /** Camera position [x, y, z] */
  cameraPosition: [number, number, number];
  /** Screen-space error threshold (pixels). Tiles with SSE below this are sufficient. */
  screenSpaceErrorThreshold: number;
  /** Screen height in pixels (for SSE calculation) */
  screenHeight: number;
  /** Vertical field of view in radians */
  fovy: number;
}

/**
 * Load and traverse 3D Tiles from a remote HTTP endpoint.
 *
 * Typical usage with cloud storage:
 * ```ts
 * const loader = new RemoteTileLoader({
 *   baseUrl: 'https://my-bucket.s3.amazonaws.com/project/',
 * });
 * const tileset = await loader.loadTileset('tileset.json');
 * const visibleTiles = await loader.loadVisibleTiles(tileset, viewParams);
 * ```
 */
export class RemoteTileLoader {
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private maxConcurrency: number;
  private enableCache: boolean;

  private tilesetCache: Map<string, Tileset> = new Map();
  private tileContentCache: Map<string, Uint8Array> = new Map();
  private activeFetches: number = 0;
  private fetchQueue: Array<() => void> = [];

  constructor(options: RemoteTileLoaderOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : options.baseUrl + '/';
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.maxConcurrency = options.maxConcurrency ?? 6;
    this.enableCache = options.enableCache ?? true;
  }

  /**
   * Load and parse a tileset.json from the remote endpoint.
   * Handles both root tilesets and external tileset references.
   */
  async loadTileset(path: string = 'tileset.json'): Promise<Tileset> {
    const url = this.resolveUrl(path);

    if (this.enableCache && this.tilesetCache.has(url)) {
      return this.tilesetCache.get(url)!;
    }

    const response = await this.throttledFetch(url);
    if (!response.ok) {
      throw new Error(`[RemoteTileLoader] Failed to load tileset: ${url} (${response.status})`);
    }

    const tileset: Tileset = await response.json();

    if (this.enableCache) {
      this.tilesetCache.set(url, tileset);
    }

    return tileset;
  }

  /**
   * Traverse the tile tree and load content for tiles that should be
   * visible at the current view.
   *
   * Uses screen-space error (SSE) to decide which tiles to load:
   * - If a tile's SSE > threshold, recurse into its children
   * - If SSE <= threshold (or it's a leaf), load this tile's content
   */
  async loadVisibleTiles(
    tileset: Tileset,
    view: ViewFrustumParams,
  ): Promise<LoadedTile[]> {
    const results: LoadedTile[] = [];
    const loadPromises: Promise<void>[] = [];

    this.traverseForVisibility(
      tileset.root,
      view,
      this.baseUrl,
      results,
      loadPromises,
    );

    await Promise.all(loadPromises);
    return results;
  }

  /**
   * Load a single tile's GLB content.
   */
  async loadTileContent(uri: string): Promise<Uint8Array> {
    const url = this.resolveUrl(uri);

    if (this.enableCache && this.tileContentCache.has(url)) {
      return this.tileContentCache.get(url)!;
    }

    const response = await this.throttledFetch(url);
    if (!response.ok) {
      throw new Error(`[RemoteTileLoader] Failed to load tile: ${url} (${response.status})`);
    }

    const buffer = new Uint8Array(await response.arrayBuffer());

    if (this.enableCache) {
      this.tileContentCache.set(url, buffer);
    }

    return buffer;
  }

  /**
   * Clear all cached tilesets and tile content.
   */
  clearCache(): void {
    this.tilesetCache.clear();
    this.tileContentCache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { tilesets: number; tiles: number; totalBytes: number } {
    let totalBytes = 0;
    for (const buf of this.tileContentCache.values()) {
      totalBytes += buf.byteLength;
    }
    return {
      tilesets: this.tilesetCache.size,
      tiles: this.tileContentCache.size,
      totalBytes,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRAVERSAL
  // ═══════════════════════════════════════════════════════════════════════

  private traverseForVisibility(
    tile: Tile,
    view: ViewFrustumParams,
    basePath: string,
    results: LoadedTile[],
    loadPromises: Promise<void>[],
  ): void {
    const sse = this.computeScreenSpaceError(tile, view);

    // Check if this tile's content is an external tileset
    if (tile.content?.uri?.endsWith('.json')) {
      // External tileset - load it recursively
      const externalUri = tile.content.uri;
      loadPromises.push(
        this.loadTileset(externalUri).then(externalTileset => {
          const externalBase = externalUri.substring(0, externalUri.lastIndexOf('/') + 1);
          this.traverseForVisibility(
            externalTileset.root,
            view,
            basePath + externalBase,
            results,
            loadPromises,
          );
        })
      );
      return;
    }

    // If SSE is small enough or no children, this tile is sufficient
    if (sse <= view.screenSpaceErrorThreshold || !tile.children?.length) {
      if (tile.content?.uri) {
        const entry: LoadedTile = {
          tile,
          content: null,
          uri: tile.content.uri,
          loaded: false,
        };
        results.push(entry);

        // Start loading content
        loadPromises.push(
          this.loadTileContent(tile.content.uri).then(content => {
            entry.content = content;
            entry.loaded = true;
          })
        );
      }
      return;
    }

    // SSE too large - recurse into children for more detail
    if (tile.children) {
      for (const child of tile.children) {
        this.traverseForVisibility(child, view, basePath, results, loadPromises);
      }
    }
  }

  /**
   * Compute approximate screen-space error for a tile.
   * This is a simplified version of the CesiumJS SSE formula.
   */
  private computeScreenSpaceError(tile: Tile, view: ViewFrustumParams): number {
    if (tile.geometricError === 0) return 0;

    const bv = tile.boundingVolume;
    let distance: number;

    if (bv.box) {
      // Box: center is at [0,1,2], compute distance from camera to center
      const cx = bv.box[0], cy = bv.box[1], cz = bv.box[2];
      const dx = cx - view.cameraPosition[0];
      const dy = cy - view.cameraPosition[1];
      const dz = cz - view.cameraPosition[2];
      distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    } else if (bv.sphere) {
      const cx = bv.sphere[0], cy = bv.sphere[1], cz = bv.sphere[2];
      const radius = bv.sphere[3];
      const dx = cx - view.cameraPosition[0];
      const dy = cy - view.cameraPosition[1];
      const dz = cz - view.cameraPosition[2];
      distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - radius, 1e-6);
    } else {
      // Fallback: assume far away
      distance = 1000;
    }

    // SSE = (geometricError * screenHeight) / (distance * 2 * tan(fovy/2))
    const sseDenominator = distance * 2 * Math.tan(view.fovy / 2);
    if (sseDenominator === 0) return Infinity;

    return (tile.geometricError * view.screenHeight) / sseDenominator;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════════════

  private resolveUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    // Strip leading ./ for clean concatenation
    const cleanPath = path.startsWith('./') ? path.slice(2) : path;
    return this.baseUrl + cleanPath;
  }

  /**
   * Throttled fetch to limit concurrent requests.
   */
  private async throttledFetch(url: string): Promise<Response> {
    if (this.activeFetches >= this.maxConcurrency) {
      await new Promise<void>(resolve => this.fetchQueue.push(resolve));
    }

    this.activeFetches++;
    try {
      return await this.fetchFn(url);
    } finally {
      this.activeFetches--;
      if (this.fetchQueue.length > 0) {
        const next = this.fetchQueue.shift()!;
        next();
      }
    }
  }
}

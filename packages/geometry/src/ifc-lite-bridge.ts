/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite bridge - initializes and manages IFC-Lite WASM for geometry processing
 * Replaces web-ifc-bridge.ts with native IFC-Lite implementation (1.9x faster)
 */

import init, { IfcAPI, MeshCollection, MeshDataJs } from '@ifc-lite/wasm';
export type { MeshCollection, MeshDataJs };

export interface StreamingProgress {
  percent: number;
  processed: number;
  total: number;
  phase: 'simple' | 'simple_complete' | 'complex';
}

export interface StreamingStats {
  totalMeshes: number;
  totalVertices: number;
  totalTriangles: number;
}

export interface ParseMeshesAsyncOptions {
  batchSize?: number;
  onBatch?: (meshes: MeshDataJs[], progress: StreamingProgress) => void;
  onComplete?: (stats: StreamingStats) => void;
}

export class IfcLiteBridge {
  private ifcApi: IfcAPI | null = null;
  private initialized: boolean = false;

  /**
   * Initialize IFC-Lite WASM
   */
  async init(wasmPath: string = '/'): Promise<void> {
    if (this.initialized) return;

    // Initialize WASM module
    const wasmUrl = wasmPath.endsWith('/')
      ? `${wasmPath}ifc-lite_bg.wasm`
      : `${wasmPath}/ifc-lite_bg.wasm`;

    await init(wasmUrl);
    this.ifcApi = new IfcAPI();
    this.initialized = true;
  }

  /**
   * Parse IFC content and return mesh collection (blocking)
   * Returns individual meshes with express IDs and colors
   */
  parseMeshes(content: string): MeshCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi.parseMeshes(content);
  }

  /**
   * Parse IFC content with streaming (non-blocking)
   * Yields batches progressively for fast first frame
   * Simple geometry (walls, slabs, beams) processed first
   */
  async parseMeshesAsync(content: string, options: ParseMeshesAsyncOptions = {}): Promise<void> {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi.parseMeshesAsync(content, options);
  }

  /**
   * Get IFC-Lite API instance
   */
  getApi(): IfcAPI {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get version
   */
  getVersion(): string {
    return this.ifcApi?.version ?? 'unknown';
  }
}

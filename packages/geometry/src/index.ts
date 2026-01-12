/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/geometry - Geometry processing bridge
 * Now powered by IFC-Lite native Rust WASM (1.9x faster than web-ifc)
 */

// IFC-Lite components (recommended - faster)
export { IfcLiteBridge } from './ifc-lite-bridge.js';
export { IfcLiteMeshCollector } from './ifc-lite-mesh-collector.js';

// Support components
export { BufferBuilder } from './buffer-builder.js';
export { CoordinateHandler } from './coordinate-handler.js';
export { WorkerPool } from './worker-pool.js';
export { GeometryQuality } from './progressive-loader.js';
export { LODGenerator, type LODConfig, type LODMesh } from './lod.js';
export * from './types.js';
export * from './default-materials.js';

// Legacy exports for compatibility (deprecated)
export { IfcLiteBridge as WebIfcBridge } from './ifc-lite-bridge.js';

import { IfcLiteBridge } from './ifc-lite-bridge.js';
import { IfcLiteMeshCollector } from './ifc-lite-mesh-collector.js';
import { BufferBuilder } from './buffer-builder.js';
import { CoordinateHandler } from './coordinate-handler.js';
import { WorkerPool } from './worker-pool.js';
import { GeometryQuality } from './progressive-loader.js';
import type { GeometryResult, MeshData } from './types.js';

export interface GeometryProcessorOptions {
  useWorkers?: boolean; // Default: false (workers add overhead)
  quality?: GeometryQuality; // Default: Balanced
}

export type StreamingGeometryEvent =
  | { type: 'start'; totalEstimate: number }
  | { type: 'model-open'; modelID: number }
  | { type: 'batch'; meshes: MeshData[]; totalSoFar: number; coordinateInfo?: import('./types.js').CoordinateInfo }
  | { type: 'complete'; totalMeshes: number; coordinateInfo: import('./types.js').CoordinateInfo };

export class GeometryProcessor {
  private bridge: IfcLiteBridge;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;
  private workerPool: WorkerPool | null = null;
  private wasmPath: string = '/';
  private useWorkers: boolean = false;

  constructor(options: GeometryProcessorOptions = {}) {
    this.bridge = new IfcLiteBridge();
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.useWorkers = options.useWorkers ?? false;
    // Note: quality option is accepted for API compatibility but IFC-Lite always processes at full quality
    void options.quality;
  }

  /**
   * Initialize IFC-Lite WASM and worker pool
   */
  async init(wasmPath: string = '/'): Promise<void> {
    this.wasmPath = wasmPath;

    await this.bridge.init(wasmPath);

    // Initialize worker pool if available (lazy - only when needed)
    // Don't initialize workers upfront to avoid overhead
    // Workers will be initialized on first use if needed
  }

  /**
   * Process IFC file and extract geometry
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   */
  async process(buffer: Uint8Array, entityIndex?: Map<number, any>): Promise<GeometryResult> {
    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // entityIndex is used in collectMeshesMainThread for priority-based loading
    void entityIndex;

    let meshes: MeshData[];
    // const meshCollectionStart = performance.now();

    // Use workers only if explicitly enabled (they add overhead)
    if (this.useWorkers) {
      // Try to use worker pool if available (lazy init)
      if (!this.workerPool) {
        try {
          let workerUrl: URL | string;
          try {
            workerUrl = new URL('./geometry.worker.ts', import.meta.url);
          } catch (e) {
            workerUrl = './geometry.worker.ts';
          }
          this.workerPool = new WorkerPool(workerUrl, 1); // Use single worker for now
          await this.workerPool.init();
        } catch (error) {
          console.warn('[GeometryProcessor] Worker pool initialization failed, will use main thread:', error);
          this.workerPool = null;
        }
      }

      if (this.workerPool?.isAvailable()) {
        try {
          meshes = await this.workerPool.submit<MeshData[]>('mesh-collection', {
            buffer: buffer.buffer,
            wasmPath: this.wasmPath,
          });
        } catch (error) {
          console.warn('[Geometry] Worker pool failed, falling back to main thread:', error);
          meshes = await this.collectMeshesMainThread(buffer);
        }
      } else {
        // Fallback to main thread
        meshes = await this.collectMeshesMainThread(buffer);
      }
    } else {
      // Use main thread (faster for total time, but blocks UI)
      meshes = await this.collectMeshesMainThread(buffer);
    }

    // const meshCollectionTime = performance.now() - meshCollectionStart;

    // Handle large coordinates by shifting to origin
    const coordinateInfo = this.coordinateHandler.processMeshes(meshes);

    // Build GPU-ready buffers
    const bufferResult = this.bufferBuilder.processMeshes(meshes);

    // Combine results
    const result: GeometryResult = {
      meshes: bufferResult.meshes,
      totalTriangles: bufferResult.totalTriangles,
      totalVertices: bufferResult.totalVertices,
      coordinateInfo,
    };

    return result;
  }

  /**
   * Collect meshes on main thread using IFC-Lite
   */
  private async collectMeshesMainThread(buffer: Uint8Array, _entityIndex?: Map<number, any>): Promise<MeshData[]> {
    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    const meshes = collector.collectMeshes();

    return meshes;
  }

  /**
   * Process IFC file with streaming output for progressive rendering
   * Uses IFC-Lite for native Rust geometry processing (1.9x faster)
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   * @param batchSize Number of meshes per batch (default: 100)
   */
  async *processStreaming(
    buffer: Uint8Array,
    _entityIndex?: Map<number, any>,
    batchSize: number = 100
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    yield { type: 'start', totalEstimate: buffer.length / 1000 };

    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    // Use a placeholder model ID (IFC-Lite doesn't use model IDs)
    yield { type: 'model-open', modelID: 0 };

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    let totalMeshes = 0;

    for await (const batch of collector.collectMeshesStreaming(batchSize)) {
      // Process coordinate shifts incrementally (will accumulate bounds)
      this.coordinateHandler.processMeshesIncremental(batch);
      totalMeshes += batch.length;

      // Get current coordinate info for this batch (may be null if bounds not yet valid)
      const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();

      yield { type: 'batch', meshes: batch, totalSoFar: totalMeshes, coordinateInfo: coordinateInfo || undefined };
    }

    const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();

    yield { type: 'complete', totalMeshes, coordinateInfo };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = null;
    }
  }
}

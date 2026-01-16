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

// Platform bridge abstraction (auto-selects WASM or native based on environment)
export {
  createPlatformBridge,
  isTauri,
  type IPlatformBridge,
  type GeometryProcessingResult,
  type GeometryStats as PlatformGeometryStats,
  type StreamingOptions,
  type StreamingProgress,
  type GeometryBatch,
} from './platform-bridge.js';
export { WasmBridge } from './wasm-bridge.js';
export { NativeBridge } from './native-bridge.js';

// Support components
export { BufferBuilder } from './buffer-builder.js';
export { CoordinateHandler } from './coordinate-handler.js';
export { WorkerPool } from './worker-pool.js';
export { GeometryQuality } from './progressive-loader.js';
export { LODGenerator, type LODConfig, type LODMesh } from './lod.js';
export {
  deduplicateMeshes,
  getDeduplicationStats,
  type InstancedMeshData,
  type DeduplicationStats
} from './geometry-deduplicator.js';
export * from './types.js';
export * from './default-materials.js';

// Zero-copy GPU upload (new - faster, less memory)
export { WasmMemoryManager, type GpuGeometryHandle, type GpuMeshMetadataHandle, type GpuInstancedGeometryHandle, type GpuInstancedGeometryCollectionHandle, type GpuInstancedGeometryRefHandle } from './wasm-memory-manager.js';
export {
  ZeroCopyMeshCollector,
  ZeroCopyInstancedCollector,
  type ZeroCopyStreamingProgress,
  type ZeroCopyBatchResult,
  type ZeroCopyCompleteStats,
  type ZeroCopyMeshMetadata,
  type ZeroCopyBatch,
  type ZeroCopyInstancedBatch,
} from './zero-copy-collector.js';

// Legacy exports for compatibility (deprecated)
export { IfcLiteBridge as WebIfcBridge } from './ifc-lite-bridge.js';

import { IfcLiteBridge } from './ifc-lite-bridge.js';
import { IfcLiteMeshCollector } from './ifc-lite-mesh-collector.js';
import { BufferBuilder } from './buffer-builder.js';
import { CoordinateHandler } from './coordinate-handler.js';
import { WorkerPool } from './worker-pool.js';
import { GeometryQuality } from './progressive-loader.js';
import { createPlatformBridge, isTauri, type IPlatformBridge } from './platform-bridge.js';
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

export type StreamingInstancedGeometryEvent =
  | { type: 'start'; totalEstimate: number }
  | { type: 'model-open'; modelID: number }
  | { type: 'batch'; geometries: import('@ifc-lite/wasm').InstancedGeometry[]; totalSoFar: number; coordinateInfo?: import('./types.js').CoordinateInfo }
  | { type: 'complete'; totalGeometries: number; totalInstances: number; coordinateInfo: import('./types.js').CoordinateInfo };

export class GeometryProcessor {
  private bridge: IfcLiteBridge | null = null;
  private platformBridge: IPlatformBridge | null = null;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;
  private workerPool: WorkerPool | null = null;
  private useWorkers: boolean = false;
  private isNative: boolean = false;

  constructor(options: GeometryProcessorOptions = {}) {
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.useWorkers = options.useWorkers ?? false;
    this.isNative = isTauri();
    // Note: quality option is accepted for API compatibility but IFC-Lite always processes at full quality
    void options.quality;

    if (this.isNative) {
      console.log('[GeometryProcessor] Running in Tauri - using NATIVE Rust processing');
    } else {
      console.log('[GeometryProcessor] Running in browser - using WASM processing');
      this.bridge = new IfcLiteBridge();
    }
  }

  /**
   * Initialize the geometry processor
   * In Tauri: No-op (native Rust is always ready)
   * In browser: Loads WASM
   */
  async init(_wasmPath?: string): Promise<void> {
    if (this.isNative) {
      // Create platform bridge for native processing
      this.platformBridge = await createPlatformBridge();
      await this.platformBridge.init();
      console.log('[GeometryProcessor] Native bridge initialized');
    } else {
      // WASM path
      if (this.bridge) {
        await this.bridge.init();
      }
    }
  }

  /**
   * Process IFC file and extract geometry
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   */
  async process(buffer: Uint8Array, entityIndex?: Map<number, any>): Promise<GeometryResult> {
    // entityIndex is used in collectMeshesMainThread for priority-based loading
    void entityIndex;

    let meshes: MeshData[];

    if (this.isNative && this.platformBridge) {
      // NATIVE PATH - Use Tauri commands
      console.time('[GeometryProcessor] native-processing');
      const decoder = new TextDecoder();
      const content = decoder.decode(buffer);
      const result = await this.platformBridge.processGeometry(content);
      meshes = result.meshes;
      console.timeEnd('[GeometryProcessor] native-processing');
    } else {
      // WASM PATH
      if (!this.bridge?.isInitialized()) {
        await this.init();
      }

      if (this.useWorkers && !this.isNative) {
        // Worker pool path (WASM only)
        if (!this.workerPool) {
          try {
            let workerUrl: URL | string;
            try {
              workerUrl = new URL('./geometry.worker.ts', import.meta.url);
            } catch (e) {
              workerUrl = './geometry.worker.ts';
            }
            this.workerPool = new WorkerPool(workerUrl, 1);
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
            });
          } catch (error) {
            console.warn('[Geometry] Worker pool failed, falling back to main thread:', error);
            meshes = await this.collectMeshesMainThread(buffer);
          }
        } else {
          meshes = await this.collectMeshesMainThread(buffer);
        }
      } else {
        meshes = await this.collectMeshesMainThread(buffer);
      }
    }

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
   * Collect meshes on main thread using IFC-Lite WASM
   */
  private async collectMeshesMainThread(buffer: Uint8Array, _entityIndex?: Map<number, any>): Promise<MeshData[]> {
    if (!this.bridge) {
      throw new Error('WASM bridge not initialized');
    }

    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    const meshes = collector.collectMeshes();

    return meshes;
  }

  /**
   * Process IFC file with streaming output for progressive rendering
   * Uses native Rust in Tauri, WASM in browser
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   * @param batchSize Number of meshes per batch (default: 100)
   */
  async *processStreaming(
    buffer: Uint8Array,
    _entityIndex?: Map<number, any>,
    batchSize: number = 25
  ): AsyncGenerator<StreamingGeometryEvent> {
    // Initialize if needed
    if (this.isNative) {
      if (!this.platformBridge) {
        await this.init();
      }
    } else if (!this.bridge?.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    // Yield start event FIRST so UI can update before heavy processing
    yield { type: 'start', totalEstimate: buffer.length / 1000 };

    // Yield to main thread before heavy decode operation
    await new Promise(resolve => setTimeout(resolve, 0));

    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    yield { type: 'model-open', modelID: 0 };

    if (this.isNative && this.platformBridge) {
      // NATIVE PATH - Use Tauri streaming
      console.time('[GeometryProcessor] native-streaming');
      let totalMeshes = 0;

      await this.platformBridge.processGeometryStreaming(content, {
        onBatch: (batch) => {
          // This is a callback, we can't yield from here
          // So we need to handle batches differently
        },
        onComplete: (stats) => {
          console.log(`[GeometryProcessor] Native streaming complete: ${stats.totalMeshes} meshes in ${stats.geometryTimeMs}ms`);
        },
      });

      // For native, we do a single batch for now (streaming via events is complex)
      // TODO: Implement proper streaming with Tauri events
      const result = await this.platformBridge.processGeometry(content);
      totalMeshes = result.meshes.length;

      this.coordinateHandler.processMeshesIncremental(result.meshes);
      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();

      yield { type: 'batch', meshes: result.meshes, totalSoFar: totalMeshes, coordinateInfo: coordinateInfo || undefined };
      yield { type: 'complete', totalMeshes, coordinateInfo };

      console.timeEnd('[GeometryProcessor] native-streaming');
    } else {
      // WASM PATH
      if (!this.bridge) {
        throw new Error('WASM bridge not initialized');
      }

      const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
      let totalMeshes = 0;

      for await (const batch of collector.collectMeshesStreaming(batchSize)) {
        this.coordinateHandler.processMeshesIncremental(batch);
        totalMeshes += batch.length;
        const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
        yield { type: 'batch', meshes: batch, totalSoFar: totalMeshes, coordinateInfo: coordinateInfo || undefined };
      }

      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
      yield { type: 'complete', totalMeshes, coordinateInfo };
    }
  }

  /**
   * Process IFC file with streaming instanced geometry output for progressive rendering
   * Groups identical geometries by hash (before transformation) for GPU instancing
   * @param buffer IFC file buffer
   * @param batchSize Number of unique geometries per batch (default: 25)
   */
  async *processInstancedStreaming(
    buffer: Uint8Array,
    batchSize: number = 25
  ): AsyncGenerator<StreamingInstancedGeometryEvent> {
    // Initialize if needed
    if (this.isNative) {
      if (!this.platformBridge) {
        await this.init();
      }
      // Note: Native instanced streaming not yet implemented - fall through to WASM
      // For now, throw an error to make it clear
      console.warn('[GeometryProcessor] Native instanced streaming not yet implemented, using WASM');
    }

    if (!this.bridge?.isInitialized()) {
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

    const collector = new IfcLiteMeshCollector(this.bridge!.getApi(), content);
    let totalGeometries = 0;
    let totalInstances = 0;

    for await (const batch of collector.collectInstancedGeometryStreaming(batchSize)) {
      // For instanced geometry, we need to extract mesh data from instances for coordinate handling
      // Convert InstancedGeometry to MeshData[] for coordinate handler
      const meshDataBatch: MeshData[] = [];
      for (const geom of batch) {
        const positions = geom.positions;
        const normals = geom.normals;
        const indices = geom.indices;

        // Create a mesh data entry for each instance (for coordinate bounds calculation)
        // We'll use the first instance's color as representative
        if (geom.instance_count > 0) {
          const firstInstance = geom.get_instance(0);
          if (firstInstance) {
            const color = firstInstance.color;
            meshDataBatch.push({
              expressId: firstInstance.expressId,
              positions,
              normals,
              indices,
              color: [color[0], color[1], color[2], color[3]],
            });
          }
        }
      }

      // Process coordinate shifts incrementally
      if (meshDataBatch.length > 0) {
        this.coordinateHandler.processMeshesIncremental(meshDataBatch);
      }

      totalGeometries += batch.length;
      totalInstances += batch.reduce((sum, g) => sum + g.instance_count, 0);

      // Get current coordinate info for this batch
      const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();

      yield {
        type: 'batch',
        geometries: batch,
        totalSoFar: totalGeometries,
        coordinateInfo: coordinateInfo || undefined
      };
    }

    const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();

    yield { type: 'complete', totalGeometries, totalInstances, coordinateInfo };
  }

  /**
   * Adaptive processing: Choose sync or streaming based on file size
   * Small files (< threshold): Load all at once for instant display
   * Large files (>= threshold): Stream for fast first frame
   * @param buffer IFC file buffer
   * @param options Configuration options
   * @param options.sizeThreshold File size threshold in bytes (default: 2MB)
   * @param options.batchSize Number of meshes per batch for streaming (default: 25)
   * @param options.entityIndex Optional entity index for priority-based loading
   */
  async *processAdaptive(
    buffer: Uint8Array,
    options: {
      sizeThreshold?: number;
      batchSize?: number;
      entityIndex?: Map<number, any>;
    } = {}
  ): AsyncGenerator<StreamingGeometryEvent> {
    const sizeThreshold = options.sizeThreshold ?? 2 * 1024 * 1024; // Default 2MB
    const batchSize = options.batchSize ?? 25;

    // Initialize if needed
    if (this.isNative) {
      if (!this.platformBridge) {
        await this.init();
      }
    } else if (!this.bridge?.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    // Small files: Load all at once (sync)
    if (buffer.length < sizeThreshold) {
      yield { type: 'start', totalEstimate: buffer.length / 1000 };

      // Convert buffer to string (IFC files are text)
      const decoder = new TextDecoder();
      const content = decoder.decode(buffer);

      yield { type: 'model-open', modelID: 0 };

      let allMeshes: MeshData[];

      if (this.isNative && this.platformBridge) {
        // NATIVE PATH - single batch processing
        console.time('[GeometryProcessor] native-adaptive-sync');
        const result = await this.platformBridge.processGeometry(content);
        allMeshes = result.meshes;
        console.timeEnd('[GeometryProcessor] native-adaptive-sync');
      } else {
        // WASM PATH
        const collector = new IfcLiteMeshCollector(this.bridge!.getApi(), content);
        allMeshes = collector.collectMeshes();
      }

      // Process coordinate shifts
      this.coordinateHandler.processMeshesIncremental(allMeshes);
      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();

      // Emit as single batch for immediate rendering
      yield {
        type: 'batch',
        meshes: allMeshes,
        totalSoFar: allMeshes.length,
        coordinateInfo: coordinateInfo || undefined,
      };

      yield { type: 'complete', totalMeshes: allMeshes.length, coordinateInfo };
    } else {
      // Large files: Stream for fast first frame
      // processStreaming will emit its own start and model-open events
      yield* this.processStreaming(buffer, options.entityIndex, batchSize);
    }
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

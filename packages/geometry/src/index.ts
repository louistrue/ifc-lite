/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/geometry - Geometry processing bridge
 * Now powered by IFC-Lite native Rust WASM (1.9x faster than web-ifc)
 *
 * OPTIMIZATION: Time-to-first-geometry improvements:
 * - Chunked TextDecoder with event loop yields (non-blocking decode)
 * - Larger WASM batch sizes for meaningful first batch
 * - Pre-warm capability for instant file loading
 * - Higher adaptive threshold (5MB) for better medium-file performance
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
import type { GeometryResult, MeshData } from './types.js';

export interface GeometryProcessorOptions {
  useWorkers?: boolean; // Default: false (workers add overhead)
  quality?: GeometryQuality; // Default: Balanced
}

/**
 * Dynamic batch configuration for ramp-up streaming
 * Starts with small batches for fast first frame, ramps up for throughput
 */
export interface DynamicBatchConfig {
  /** Initial batch size for first 3 batches (default: 50) */
  initialBatchSize?: number;
  /** Maximum batch size for batches 11+ (default: 500) */
  maxBatchSize?: number;
  /** File size in MB for adaptive sizing (optional) */
  fileSizeMB?: number;
}

/**
 * Calculate dynamic batch size based on batch number
 */
export function calculateDynamicBatchSize(
  batchNumber: number,
  initialBatchSize: number = 50,
  maxBatchSize: number = 500
): number {
  if (batchNumber <= 3) {
    return initialBatchSize; // Fast first frame
  } else if (batchNumber <= 6) {
    return Math.floor((initialBatchSize + maxBatchSize) / 2); // Quick ramp
  } else {
    return maxBatchSize; // Full throughput earlier
  }
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

/**
 * OPTIMIZATION: Chunked text decoder that yields to event loop
 * Prevents UI blocking during large file decode
 * @param buffer Binary IFC file content
 * @param chunkSize Bytes per chunk (default: 1MB)
 * @returns Decoded string
 */
async function decodeTextChunked(buffer: Uint8Array, chunkSize: number = 1024 * 1024): Promise<string> {
  // For small files, decode all at once (faster)
  if (buffer.length < chunkSize * 2) {
    const decoder = new TextDecoder();
    return decoder.decode(buffer);
  }

  // For large files, decode in chunks with event loop yields
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, buffer.length);
    const chunk = buffer.subarray(offset, end);
    chunks.push(decoder.decode(chunk, { stream: offset + chunkSize < buffer.length }));

    // Yield to event loop every 2MB to keep UI responsive
    if (offset > 0 && offset % (chunkSize * 2) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return chunks.join('');
}

/**
 * OPTIMIZATION: Fast synchronous decode for small files
 * Avoids async overhead when not needed
 */
function decodeTextSync(buffer: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

export class GeometryProcessor {
  private bridge: IfcLiteBridge;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;
  private workerPool: WorkerPool | null = null;
  private useWorkers: boolean = false;

  // OPTIMIZATION: Static pre-warmed bridge for instant file loading
  private static preWarmedBridge: IfcLiteBridge | null = null;
  private static preWarmPromise: Promise<void> | null = null;

  constructor(options: GeometryProcessorOptions = {}) {
    // Use pre-warmed bridge if available
    if (GeometryProcessor.preWarmedBridge?.isInitialized()) {
      this.bridge = GeometryProcessor.preWarmedBridge;
    } else {
      this.bridge = new IfcLiteBridge();
    }
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.useWorkers = options.useWorkers ?? false;
    // Note: quality option is accepted for API compatibility but IFC-Lite always processes at full quality
    void options.quality;
  }

  /**
   * OPTIMIZATION: Pre-warm WASM for instant file loading
   * Call this during app initialization to eliminate WASM init latency
   */
  static async preWarm(): Promise<void> {
    if (GeometryProcessor.preWarmedBridge?.isInitialized()) {
      return;
    }

    if (GeometryProcessor.preWarmPromise) {
      return GeometryProcessor.preWarmPromise;
    }

    GeometryProcessor.preWarmedBridge = new IfcLiteBridge();
    GeometryProcessor.preWarmPromise = GeometryProcessor.preWarmedBridge.init().then(() => {
      console.log('[GeometryProcessor] WASM pre-warmed and ready');
    });

    return GeometryProcessor.preWarmPromise;
  }

  /**
   * Check if WASM is pre-warmed and ready
   */
  static isPreWarmed(): boolean {
    return GeometryProcessor.preWarmedBridge?.isInitialized() ?? false;
  }

  /**
   * Initialize IFC-Lite WASM and worker pool
   * WASM is automatically resolved from the package location - no path needed
   */
  async init(_wasmPath?: string): Promise<void> {
    // Use pre-warmed bridge if available
    if (GeometryProcessor.preWarmedBridge?.isInitialized()) {
      this.bridge = GeometryProcessor.preWarmedBridge;
      return;
    }

    await this.bridge.init();

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
    const content = decodeTextSync(buffer);

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    const meshes = collector.collectMeshes();

    return meshes;
  }

  /**
   * Process IFC file with streaming output for progressive rendering
   * Uses IFC-Lite for native Rust geometry processing (1.9x faster)
   *
   * OPTIMIZATION:
   * - Chunked TextDecoder prevents UI blocking on large files
   * - Larger WASM batch sizes for meaningful first visible geometry
   * - Yields start event BEFORE decode for immediate UI feedback
   *
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   * @param batchConfig Dynamic batch configuration or fixed batch size
   */
  async *processStreaming(
    buffer: Uint8Array,
    _entityIndex?: Map<number, any>,
    batchConfig: number | DynamicBatchConfig = 25
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    // Yield start event FIRST so UI can update before heavy processing
    yield { type: 'start', totalEstimate: buffer.length / 1000 };

    // Yield to main thread before heavy decode operation
    await new Promise(resolve => setTimeout(resolve, 0));

    // OPTIMIZATION: Use chunked decode for large files to prevent UI blocking
    const fileSizeMB = buffer.length / (1024 * 1024);
    const content = fileSizeMB > 5
      ? await decodeTextChunked(buffer)
      : decodeTextSync(buffer);

    // Use a placeholder model ID (IFC-Lite doesn't use model IDs)
    yield { type: 'model-open', modelID: 0 };

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    let totalMeshes = 0;

    // Determine optimal WASM batch size based on file size
    // OPTIMIZATION: Larger batches = fewer callbacks = faster first visible geometry
    const configSizeMB = typeof batchConfig !== 'number' && batchConfig.fileSizeMB
      ? batchConfig.fileSizeMB
      : fileSizeMB;

    // Use larger batch sizes for more meaningful first batch
    // First batch should have enough geometry to show building structure
    const wasmBatchSize = configSizeMB < 5 ? 150 :    // Small: 150 meshes
                          configSizeMB < 20 ? 250 :   // Medium: 250 meshes
                          configSizeMB < 50 ? 350 :   // Large: 350 meshes
                          configSizeMB < 100 ? 500 :  // Very large: 500 meshes
                          750;                         // Huge: 750 meshes

    // Use WASM batches directly for maximum throughput
    for await (const batch of collector.collectMeshesStreaming(wasmBatchSize)) {
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
   * Process IFC file with streaming instanced geometry output for progressive rendering
   * Groups identical geometries by hash (before transformation) for GPU instancing
   * @param buffer IFC file buffer
   * @param batchSize Number of unique geometries per batch (default: 25)
   */
  async *processInstancedStreaming(
    buffer: Uint8Array,
    batchSize: number = 25
  ): AsyncGenerator<StreamingInstancedGeometryEvent> {
    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    yield { type: 'start', totalEstimate: buffer.length / 1000 };

    // OPTIMIZATION: Use chunked decode for large files
    const fileSizeMB = buffer.length / (1024 * 1024);
    const content = fileSizeMB > 5
      ? await decodeTextChunked(buffer)
      : decodeTextSync(buffer);

    // Use a placeholder model ID (IFC-Lite doesn't use model IDs)
    yield { type: 'model-open', modelID: 0 };

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
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
   *
   * OPTIMIZATION: Higher threshold (5MB instead of 2MB)
   * - Small files (<5MB): Load all at once for instant display (no streaming overhead)
   * - Large files (≥5MB): Stream for fast first frame with progressive rendering
   *
   * @param buffer IFC file buffer
   * @param options Configuration options
   * @param options.sizeThreshold File size threshold in bytes (default: 5MB)
   * @param options.batchSize Number of meshes per batch for streaming (default: 25)
   * @param options.entityIndex Optional entity index for priority-based loading
   */
  async *processAdaptive(
    buffer: Uint8Array,
    options: {
      sizeThreshold?: number;
      batchSize?: number | DynamicBatchConfig;
      entityIndex?: Map<number, any>;
    } = {}
  ): AsyncGenerator<StreamingGeometryEvent> {
    // OPTIMIZATION: Higher threshold - streaming has overhead that hurts smaller files
    const sizeThreshold = options.sizeThreshold ?? 5 * 1024 * 1024; // Default 5MB (was 2MB)
    const batchConfig = options.batchSize ?? 25;

    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    // Small files: Load all at once (sync) - avoids streaming overhead
    if (buffer.length < sizeThreshold) {
      yield { type: 'start', totalEstimate: buffer.length / 1000 };

      // Convert buffer to string (IFC files are text)
      const content = decodeTextSync(buffer);

      yield { type: 'model-open', modelID: 0 };
      const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
      const allMeshes = collector.collectMeshes();

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
      yield* this.processStreaming(buffer, options.entityIndex, batchConfig);
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

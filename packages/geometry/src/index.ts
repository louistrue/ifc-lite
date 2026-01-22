/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/geometry - Geometry processing bridge
 * Now powered by IFC-Lite native Rust WASM (1.9x faster than web-ifc)
 */

// IFC-Lite components (recommended - faster)
export { IfcLiteBridge } from './ifc-lite-bridge.js';
export { IfcLiteMeshCollector, type StreamingColorUpdateEvent } from './ifc-lite-mesh-collector.js';
import type { StreamingColorUpdateEvent } from './ifc-lite-mesh-collector.js';

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
import { GeometryQuality } from './progressive-loader.js';
import { createPlatformBridge, isTauri, type IPlatformBridge } from './platform-bridge.js';
import type { GeometryResult, MeshData } from './types.js';

export interface GeometryProcessorOptions {
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
  | { type: 'colorUpdate'; updates: Map<number, [number, number, number, number]> }
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
  private isNative: boolean = false;

  constructor(options: GeometryProcessorOptions = {}) {
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.isNative = isTauri();
    // Note: options accepted for API compatibility
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
   * In Tauri: Creates platform bridge for native Rust processing
   * In browser: Loads WASM
   */
  async init(): Promise<void> {
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
   * Process IFC file and extract geometry (synchronous, use processStreaming for large files)
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   */
  async process(buffer: Uint8Array, entityIndex?: Map<number, any>): Promise<GeometryResult> {
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
      // WASM PATH - Synchronous processing on main thread
      // For large files, use processStreaming() instead
      if (!this.bridge?.isInitialized()) {
        await this.init();
      }
      meshes = await this.collectMeshesMainThread(buffer);
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
   * @param batchConfig Dynamic batch configuration or fixed batch size
   */
  async *processStreaming(
    buffer: Uint8Array,
    _entityIndex?: Map<number, any>,
    batchConfig: number | DynamicBatchConfig = 25
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

      // For native, we do a single batch for now (streaming via events is complex)
      // TODO: Implement proper streaming with Tauri events
      const result = await this.platformBridge.processGeometry(content);
      const totalMeshes = result.meshes.length;

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

      // Determine optimal WASM batch size based on file size
      // Larger batches = fewer callbacks = faster processing
      const fileSizeMB = typeof batchConfig !== 'number' && batchConfig.fileSizeMB
        ? batchConfig.fileSizeMB
        : buffer.length / (1024 * 1024);

      // Use WASM batches directly - no JS accumulation layer
      // WASM already prioritizes simple geometry (walls, slabs) for fast first frame
      const wasmBatchSize = fileSizeMB < 10 ? 100 : fileSizeMB < 50 ? 200 : fileSizeMB < 100 ? 300 : 500;

      // Use WASM batches directly for maximum throughput
      for await (const item of collector.collectMeshesStreaming(wasmBatchSize)) {
        // Handle color update events
        if (item && typeof item === 'object' && 'type' in item && (item as StreamingColorUpdateEvent).type === 'colorUpdate') {
          yield { type: 'colorUpdate', updates: (item as StreamingColorUpdateEvent).updates };
          continue;
        }

        // Handle mesh batches
        const batch = item as MeshData[];
        // Process coordinate shifts incrementally (will accumulate bounds)
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
      batchSize?: number | DynamicBatchConfig;
      entityIndex?: Map<number, any>;
    } = {}
  ): AsyncGenerator<StreamingGeometryEvent> {
    const sizeThreshold = options.sizeThreshold ?? 2 * 1024 * 1024; // Default 2MB
    const batchConfig = options.batchSize ?? 25;

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
      yield* this.processStreaming(buffer, options.entityIndex, batchConfig);
    }
  }

  /**
   * Get the WASM API instance for advanced operations (e.g., entity scanning)
   */
  getApi() {
    if (!this.bridge || !this.bridge.isInitialized()) {
      return null;
    }
    return this.bridge.getApi();
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // No cleanup needed
  }
}

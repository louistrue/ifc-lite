/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/geometry - Geometry processing bridge
 * Now powered by IFC-Lite native Rust WASM (1.9x faster than web-ifc)
 */

// IFC-Lite components (recommended - faster)
export { IfcLiteBridge, type SymbolicRepresentationCollection, type SymbolicPolyline, type SymbolicCircle, type ProfileCollection, type ProfileEntryJs } from './ifc-lite-bridge.js';
export { IfcLiteMeshCollector, type StreamingColorUpdateEvent, type StreamingRtcOffsetEvent } from './ifc-lite-mesh-collector.js';
import type { StreamingColorUpdateEvent, StreamingRtcOffsetEvent } from './ifc-lite-mesh-collector.js';

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
import { createPlatformBridge, isTauri, type GeometryStats as PlatformGeometryStats, type IPlatformBridge } from './platform-bridge.js';
import type { GeometryResult, MeshData, CoordinateInfo } from './types.js';

interface ByteStreamingPrePassResult {
  jobs: Uint32Array;
  totalJobs: number;
  unitScale: number;
  rtcOffset?: Float64Array;
  needsShift: boolean;
  buildingRotation?: number | null;
  voidKeys: Uint32Array;
  voidCounts: Uint32Array;
  voidValues: Uint32Array;
  styleIds: Uint32Array;
  styleColors: Uint8Array;
}

export interface GeometryProcessorOptions {
  quality?: GeometryQuality; // Default: Balanced
  preferNative?: boolean; // Default: true in Tauri
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
  | {
      type: 'batch';
      meshes: MeshData[];
      totalSoFar: number;
      coordinateInfo?: import('./types.js').CoordinateInfo;
      nativeTelemetry?: import('./platform-bridge.js').NativeBatchTelemetry;
    }
  | { type: 'colorUpdate'; updates: Map<number, [number, number, number, number]> }
  | { type: 'rtcOffset'; rtcOffset: { x: number; y: number; z: number }; hasRtc: boolean }
  | { type: 'complete'; totalMeshes: number; coordinateInfo: import('./types.js').CoordinateInfo };

export type StreamingInstancedGeometryEvent =
  | { type: 'start'; totalEstimate: number }
  | { type: 'model-open'; modelID: number }
  | { type: 'batch'; geometries: import('@ifc-lite/wasm').InstancedGeometry[]; totalSoFar: number; coordinateInfo?: import('./types.js').CoordinateInfo }
  | { type: 'complete'; totalGeometries: number; totalInstances: number; coordinateInfo: import('./types.js').CoordinateInfo };

type QueuedNativeStreamingEvent =
  | { type: 'batch'; meshes: MeshData[]; nativeTelemetry?: import('./platform-bridge.js').NativeBatchTelemetry }
  | { type: 'colorUpdate'; updates: Map<number, [number, number, number, number]> };

const MAX_NATIVE_STREAM_QUEUE_EVENTS = 8;
const MAX_NATIVE_STREAM_QUEUE_MESHES = 32768;
const MAX_NATIVE_STREAM_EVENTS_PER_TURN = 4;
const MAX_NATIVE_STREAM_MESHES_PER_TURN = 8192;
const MAX_NATIVE_STREAM_DRAIN_MS = 10;

function yieldToEventLoop(): Promise<void> {
  const maybeScheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (typeof maybeScheduler?.yield === 'function') {
    return maybeScheduler.yield();
  }
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

export class GeometryProcessor {
  private static largeFileByteStreamingThreshold = 256 * 1024 * 1024;

  private bridge: IfcLiteBridge | null = null;
  private platformBridge: IPlatformBridge | null = null;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;
  private isNative: boolean = false;
  private lastNativeStats: PlatformGeometryStats | null = null;

  constructor(options: GeometryProcessorOptions = {}) {
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.isNative = options.preferNative !== false && isTauri();
    // Note: options accepted for API compatibility
    void options.quality;

    if (!this.isNative) {
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
      const result = await this.platformBridge.processGeometry(buffer);
      meshes = result.meshes;
      console.timeEnd('[GeometryProcessor] native-processing');
    } else {
      // WASM PATH - Synchronous processing on main thread
      // For large files, use processStreaming() instead
      if (!this.bridge?.isInitialized()) {
        await this.init();
      }
      const mainThreadResult = await this.collectMeshesMainThread(buffer);
      meshes = mainThreadResult.meshes;
      // Merge building rotation from WASM into coordinate info
      const coordinateInfoFromHandler = this.coordinateHandler.processMeshes(meshes);
      const buildingRotation = mainThreadResult.buildingRotation;
      const coordinateInfo: CoordinateInfo = {
        ...coordinateInfoFromHandler,
        buildingRotation,
      };
      // Build GPU-ready buffers
      const bufferResult = this.bufferBuilder.processMeshes(meshes);

      // Combine results
      return {
        meshes: bufferResult.meshes,
        totalTriangles: bufferResult.totalTriangles,
        totalVertices: bufferResult.totalVertices,
        coordinateInfo,
      };
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
   * Process IFC geometry directly from a filesystem path in native desktop
   * hosts. This avoids copying IFC content through JS when the host already
   * has the file path.
   */
  async processPath(path: string): Promise<GeometryResult> {
    if (!this.isNative) {
      throw new Error('Path-based geometry processing is only available in native desktop builds');
    }
    if (!this.platformBridge) {
      await this.init();
    }
    if (!this.platformBridge?.processGeometryPath) {
      throw new Error('Native platform bridge does not support file-path geometry processing');
    }

    const result = await this.platformBridge.processGeometryPath(path);
    const coordinateInfo = this.coordinateHandler.processMeshes(result.meshes);

    return {
      meshes: result.meshes,
      totalTriangles: result.totalTriangles,
      totalVertices: result.totalVertices,
      coordinateInfo,
    };
  }

  /**
   * Collect meshes on main thread using IFC-Lite WASM
   */
  private async collectMeshesMainThread(buffer: Uint8Array, _entityIndex?: Map<number, any>): Promise<{ meshes: MeshData[]; buildingRotation?: number }> {
    if (!this.bridge) {
      throw new Error('WASM bridge not initialized');
    }

    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    const meshes = collector.collectMeshes();
    const buildingRotation = collector.getBuildingRotation();

    return { meshes, buildingRotation };
  }

  private getStreamingBatchSize(buffer: Uint8Array, batchConfig: number | DynamicBatchConfig): number {
    if (typeof batchConfig === 'number') {
      return batchConfig;
    }

    const fileSizeMB = batchConfig.fileSizeMB
      ? batchConfig.fileSizeMB
      : buffer.length / (1024 * 1024);

    return fileSizeMB < 10 ? 100
      : fileSizeMB < 50 ? 200
      : fileSizeMB < 100 ? 300
      : fileSizeMB < 300 ? 500
      : fileSizeMB < 500 ? 1500
      : 3000;
  }

  private convertMeshCollectionToBatch(collection: import('@ifc-lite/wasm').MeshCollection): MeshData[] {
    const batch: MeshData[] = [];

    try {
      for (let i = 0; i < collection.length; i++) {
        const mesh = collection.get(i);
        if (!mesh) continue;

        try {
          batch.push({
            expressId: mesh.expressId,
            ifcType: mesh.ifcType,
            positions: mesh.positions,
            normals: mesh.normals,
            indices: mesh.indices,
            color: [mesh.color[0], mesh.color[1], mesh.color[2], mesh.color[3]],
          });
        } finally {
          mesh.free();
        }
      }
    } finally {
      collection.free();
    }

    return batch;
  }

  private withBuildingRotation(
    coordinateInfo: CoordinateInfo,
    buildingRotation?: number
  ): CoordinateInfo {
    return buildingRotation !== undefined
      ? { ...coordinateInfo, buildingRotation }
      : coordinateInfo;
  }

  private convertInstancedCollectionToBatch(
    collection: import('@ifc-lite/wasm').InstancedMeshCollection
  ): import('@ifc-lite/wasm').InstancedGeometry[] {
    const batch: import('@ifc-lite/wasm').InstancedGeometry[] = [];

    try {
      for (let i = 0; i < collection.length; i++) {
        const geometry = collection.get(i);
        if (geometry) {
          batch.push(geometry);
        }
      }
    } finally {
      collection.free();
    }

    return batch;
  }

  private async *processStreamingBytes(
    buffer: Uint8Array,
    batchConfig: number | DynamicBatchConfig
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.bridge) {
      throw new Error('WASM bridge not initialized');
    }

    const api = this.bridge.getApi();
    const prePass = api.buildPrePassOnce(buffer) as ByteStreamingPrePassResult;

    yield { type: 'model-open', modelID: 0 };

    if (prePass.rtcOffset) {
      yield {
        type: 'rtcOffset',
        rtcOffset: {
          x: prePass.rtcOffset[0] ?? 0,
          y: prePass.rtcOffset[1] ?? 0,
          z: prePass.rtcOffset[2] ?? 0,
        },
        hasRtc: Boolean(prePass.needsShift),
      };
    }

    const buildingRotation = prePass.buildingRotation ?? undefined;
    if (!prePass.jobs || prePass.totalJobs === 0) {
      const coordinateInfo = this.withBuildingRotation(
        this.coordinateHandler.getFinalCoordinateInfo(),
        buildingRotation,
      );
      yield { type: 'complete', totalMeshes: 0, coordinateInfo };
      return;
    }

    const batchSize = this.getStreamingBatchSize(buffer, batchConfig);
    // Cap at ~30 batches max to avoid excessive per-batch overhead
    const maxBatches = 30;
    const effectiveBatchSize = Math.max(batchSize, Math.ceil(prePass.totalJobs / maxBatches));
    let totalMeshes = 0;

    for (let startJob = 0; startJob < prePass.totalJobs; startJob += effectiveBatchSize) {
      const endJob = Math.min(startJob + effectiveBatchSize, prePass.totalJobs);
      const jobSlice = prePass.jobs.slice(startJob * 3, endJob * 3);
      const collection = api.processGeometryBatch(
        buffer,
        jobSlice,
        prePass.unitScale,
        prePass.rtcOffset?.[0] ?? 0,
        prePass.rtcOffset?.[1] ?? 0,
        prePass.rtcOffset?.[2] ?? 0,
        prePass.needsShift,
        prePass.voidKeys,
        prePass.voidCounts,
        prePass.voidValues,
        prePass.styleIds,
        prePass.styleColors,
      );

      const batch = this.convertMeshCollectionToBatch(collection);
      if (batch.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }

      this.coordinateHandler.processMeshesIncremental(batch);
      totalMeshes += batch.length;
      const currentCoordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
      const coordinateInfo = currentCoordinateInfo
        ? this.withBuildingRotation(currentCoordinateInfo, buildingRotation)
        : null;

      yield {
        type: 'batch',
        meshes: batch,
        totalSoFar: totalMeshes,
        coordinateInfo: coordinateInfo || undefined,
      };

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    api.clearPrePassCache?.();

    const coordinateInfo = this.withBuildingRotation(
      this.coordinateHandler.getFinalCoordinateInfo(),
      buildingRotation,
    );
    yield { type: 'complete', totalMeshes, coordinateInfo };
  }

  private async *processInstancedStreamingBytes(
    buffer: Uint8Array,
    batchSize: number
  ): AsyncGenerator<StreamingInstancedGeometryEvent> {
    if (!this.bridge) {
      throw new Error('WASM bridge not initialized');
    }

    const api = this.bridge.getApi();
    const prePass = api.buildPrePassOnce(buffer) as ByteStreamingPrePassResult;
    const buildingRotation = prePass.buildingRotation ?? undefined;

    yield { type: 'model-open', modelID: 0 };

    if (!prePass.jobs || prePass.totalJobs === 0) {
      const coordinateInfo = this.withBuildingRotation(
        this.coordinateHandler.getFinalCoordinateInfo(),
        buildingRotation,
      );
      yield { type: 'complete', totalGeometries: 0, totalInstances: 0, coordinateInfo };
      return;
    }

    let totalGeometries = 0;
    let totalInstances = 0;

    // Cap at ~30 batches max to avoid excessive per-batch overhead
    const maxBatches = 30;
    const effectiveBatchSize = Math.max(batchSize, Math.ceil(prePass.totalJobs / maxBatches));

    for (let startJob = 0; startJob < prePass.totalJobs; startJob += effectiveBatchSize) {
      const endJob = Math.min(startJob + effectiveBatchSize, prePass.totalJobs);
      const jobSlice = prePass.jobs.slice(startJob * 3, endJob * 3);
      const collection = api.processInstancedGeometryBatch(
        buffer,
        jobSlice,
        prePass.unitScale,
        prePass.rtcOffset?.[0] ?? 0,
        prePass.rtcOffset?.[1] ?? 0,
        prePass.rtcOffset?.[2] ?? 0,
        prePass.needsShift,
        prePass.styleIds,
        prePass.styleColors,
      );

      const batch = this.convertInstancedCollectionToBatch(collection);
      if (batch.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }

      const meshDataBatch: MeshData[] = [];
      for (const geom of batch) {
        const positions = geom.positions;
        const normals = geom.normals;
        const indices = geom.indices;

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

      if (meshDataBatch.length > 0) {
        this.coordinateHandler.processMeshesIncremental(meshDataBatch);
      }

      totalGeometries += batch.length;
      totalInstances += batch.reduce((sum, geometry) => sum + geometry.instance_count, 0);
      const currentCoordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
      const coordinateInfo = currentCoordinateInfo
        ? this.withBuildingRotation(currentCoordinateInfo, buildingRotation)
        : null;

      yield {
        type: 'batch',
        geometries: batch,
        totalSoFar: totalGeometries,
        coordinateInfo: coordinateInfo || undefined,
      };

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    api.clearPrePassCache?.();

    const coordinateInfo = this.withBuildingRotation(
      this.coordinateHandler.getFinalCoordinateInfo(),
      buildingRotation,
    );
    yield { type: 'complete', totalGeometries, totalInstances, coordinateInfo };
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

    // Yield to main thread before heavy processing begins
    await new Promise(resolve => setTimeout(resolve, 0));

    if (this.isNative && this.platformBridge) {
      yield { type: 'model-open', modelID: 0 };

      // NATIVE PATH - Use Tauri streaming
      console.time('[GeometryProcessor] native-streaming');
      const queuedEvents: Array<
        | { type: 'batch'; meshes: MeshData[]; nativeTelemetry?: import('./platform-bridge.js').NativeBatchTelemetry }
        | { type: 'colorUpdate'; updates: Map<number, [number, number, number, number]> }
      > = [];
      let resolvePending: (() => void) | null = null;
      let completed = false;
      let streamError: Error | null = null;
      let completedTotalMeshes: number | undefined;
      let totalMeshes = 0;

      const wake = () => {
        if (resolvePending) {
          resolvePending();
          resolvePending = null;
        }
      };

      const streamingPromise = this.platformBridge.processGeometryStreaming(buffer, {
        onBatch: (batch) => {
          queuedEvents.push({ type: 'batch', meshes: batch.meshes, nativeTelemetry: batch.nativeTelemetry });
          wake();
        },
        onColorUpdate: (updates) => {
          queuedEvents.push({ type: 'colorUpdate', updates: new Map(updates) });
          wake();
        },
        onComplete: (stats) => {
          this.lastNativeStats = stats;
          completedTotalMeshes = stats.totalMeshes;
          completed = true;
          wake();
        },
        onError: (error) => {
          streamError = error;
          completed = true;
          wake();
        },
      });

      while (!completed || queuedEvents.length > 0) {
        while (queuedEvents.length > 0) {
          const event = queuedEvents.shift()!;
          if (event.type === 'colorUpdate') {
            yield { type: 'colorUpdate', updates: event.updates };
            continue;
          }
          this.coordinateHandler.processMeshesIncremental(event.meshes);
          totalMeshes += event.meshes.length;
          const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
          yield {
            type: 'batch',
            meshes: event.meshes,
            totalSoFar: totalMeshes,
            coordinateInfo: coordinateInfo || undefined,
            nativeTelemetry: event.nativeTelemetry,
          };
        }

        if (streamError) {
          throw streamError;
        }

        if (!completed) {
          await new Promise<void>((resolve) => {
            resolvePending = resolve;
          });
        }
      }

      await streamingPromise;

      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
      yield { type: 'complete', totalMeshes: completedTotalMeshes ?? totalMeshes, coordinateInfo };

      console.timeEnd('[GeometryProcessor] native-streaming');
    } else {
      // WASM PATH
      if (!this.bridge) {
        throw new Error('WASM bridge not initialized');
      }

      if (buffer.length >= GeometryProcessor.largeFileByteStreamingThreshold) {
        yield* this.processStreamingBytes(buffer, batchConfig);
        return;
      }

      // Convert buffer to string (IFC files are text)
      const decoder = new TextDecoder();
      const content = decoder.decode(buffer);

      yield { type: 'model-open', modelID: 0 };

      const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
      let totalMeshes = 0;
      let extractedBuildingRotation: number | undefined = undefined;

      const wasmBatchSize = this.getStreamingBatchSize(buffer, batchConfig);

      // Use WASM batches directly for maximum throughput
      for await (const item of collector.collectMeshesStreaming(wasmBatchSize)) {
        // Handle color update events
        if (item && typeof item === 'object' && 'type' in item && (item as StreamingColorUpdateEvent).type === 'colorUpdate') {
          yield { type: 'colorUpdate', updates: (item as StreamingColorUpdateEvent).updates };
          continue;
        }

        // Handle RTC offset events
        if (item && typeof item === 'object' && 'type' in item && (item as StreamingRtcOffsetEvent).type === 'rtcOffset') {
          const rtcEvent = item as StreamingRtcOffsetEvent;
          yield { type: 'rtcOffset', rtcOffset: rtcEvent.rtcOffset, hasRtc: rtcEvent.hasRtc };
          continue;
        }

        // Handle mesh batches
        const batch = item as MeshData[];
        // Process coordinate shifts incrementally (will accumulate bounds)
        this.coordinateHandler.processMeshesIncremental(batch);
        totalMeshes += batch.length;
        const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();

        // Merge buildingRotation if we have it
        const coordinateInfoWithRotation = coordinateInfo && extractedBuildingRotation !== undefined
          ? { ...coordinateInfo, buildingRotation: extractedBuildingRotation }
          : coordinateInfo;

        yield { type: 'batch', meshes: batch, totalSoFar: totalMeshes, coordinateInfo: coordinateInfoWithRotation || undefined };
      }

      // Get building rotation after streaming completes
      extractedBuildingRotation = collector.getBuildingRotation();

      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
      const finalCoordinateInfo = extractedBuildingRotation !== undefined
        ? { ...coordinateInfo, buildingRotation: extractedBuildingRotation }
        : coordinateInfo;
      yield { type: 'complete', totalMeshes, coordinateInfo: finalCoordinateInfo };
    }
  }

  /**
   * Stream geometry directly from a filesystem path in native desktop hosts.
   * This avoids copying very large IFC files through JS and Tauri IPC.
   */
  async *processStreamingPath(
    path: string,
    estimatedBytes: number = 0,
    cacheKey?: string,
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.isNative) {
      throw new Error('File-path geometry streaming is only available in native desktop builds');
    }
    if (!this.platformBridge) {
      await this.init();
    }
    if (!this.platformBridge?.processGeometryStreamingPath) {
      throw new Error('Native platform bridge does not support file-path streaming');
    }

    yield* this.streamNativeGeometry(
      (options) => this.platformBridge!.processGeometryStreamingPath!(path, options, cacheKey),
      estimatedBytes > 0 ? estimatedBytes / 1000 : 0
    );
  }

  async *processStreamingCache(
    cacheKey: string
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.isNative) {
      throw new Error('Native cached geometry streaming is only available in native desktop builds');
    }
    if (!this.platformBridge) {
      await this.init();
    }
    if (!this.platformBridge?.processGeometryStreamingCache) {
      throw new Error('Native platform bridge does not support cached geometry streaming');
    }

    yield* this.streamNativeGeometry(
      (options) => this.platformBridge!.processGeometryStreamingCache!(cacheKey, options),
      0
    );
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

    // Adapt batch size for large files to reduce callback overhead
    // Larger batches = fewer callbacks = less overhead for huge models
    const fileSizeMB = buffer.length / (1024 * 1024);
    const effectiveBatchSize = fileSizeMB < 50 ? batchSize : fileSizeMB < 200 ? Math.max(batchSize, 50) : fileSizeMB < 300 ? Math.max(batchSize, 100) : Math.max(batchSize, 200);
    const byteBatchSize = Math.max(effectiveBatchSize, this.getStreamingBatchSize(buffer, batchSize));

    if (buffer.length >= GeometryProcessor.largeFileByteStreamingThreshold) {
      yield* this.processInstancedStreamingBytes(buffer, byteBatchSize);
      return;
    }

    // Convert buffer to string (IFC files are text)
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);

    // Use a placeholder model ID (IFC-Lite doesn't use model IDs)
    yield { type: 'model-open', modelID: 0 };

    const collector = new IfcLiteMeshCollector(this.bridge!.getApi(), content);
    let totalGeometries = 0;
    let totalInstances = 0;

    for await (const batch of collector.collectInstancedGeometryStreaming(effectiveBatchSize)) {
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
   * Process IFC file in parallel using Web Workers.
   * Each worker gets its own WASM instance and processes a disjoint slice
   * of the geometry entity list. Batches are yielded as they arrive from
   * any worker, enabling progressive rendering while utilizing multiple cores.
   *
   * @param buffer IFC file buffer
   */
  async *processParallel(
    buffer: Uint8Array,
  ): AsyncGenerator<StreamingGeometryEvent> {
    // Initialize if needed
    if (!this.bridge?.isInitialized()) {
      await this.init();
    }

    this.coordinateHandler.reset();

    yield { type: 'start', totalEstimate: buffer.length / 1000 };
    yield { type: 'model-open', modelID: 0 };

    // Copy file bytes into SharedArrayBuffer for zero-copy sharing with workers
    const sharedBuffer = new SharedArrayBuffer(buffer.byteLength);
    new Uint8Array(sharedBuffer).set(buffer);

    // ── PHASE 1: Full pre-pass in worker ──
    const makeWorker = () => new Worker(
      new URL('./geometry.worker.ts', import.meta.url),
      { type: 'module' },
    );

    const prePassResult = await new Promise<any>((resolve, reject) => {
      const w = makeWorker();
      w.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'prepass-result') { w.terminate(); resolve(e.data.result); }
        else if (e.data.type === 'error') { w.terminate(); reject(new Error(e.data.message)); }
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
      w.postMessage({ type: 'prepass', sharedBuffer });
    });

    if (!prePassResult || !prePassResult.jobs || prePassResult.totalJobs === 0) {
      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
      yield { type: 'complete', totalMeshes: 0, coordinateInfo };
      return;
    }

    const { jobs: jobsFlat, totalJobs, unitScale, rtcOffset, needsShift,
            voidKeys, voidCounts, voidValues, styleIds, styleColors } = prePassResult;
    const rtcX = rtcOffset?.[0] ?? 0;
    const rtcY = rtcOffset?.[1] ?? 0;
    const rtcZ = rtcOffset?.[2] ?? 0;

    // ── PHASE 2: Dynamic worker provisioning based on device capability ──
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
    const deviceMemoryGB = typeof navigator !== 'undefined' ? ((navigator as any).deviceMemory ?? 8) : 8;
    const fileSizeGB = buffer.byteLength / (1024 * 1024 * 1024);

    // Determine optimal workers:
    // - Desktop (16+ cores, 16+ GB): up to 8 workers
    // - Laptop (8 cores, 8 GB): 2-4 workers (avoid thermal throttling on fanless)
    // - Low-end (4 cores, 4 GB): 1-2 workers
    // - Large files need more memory per worker, so fewer workers
    let maxWorkers: number;
    if (cores >= 16 && deviceMemoryGB >= 16) {
      maxWorkers = Math.min(8, Math.floor(cores / 2));
    } else if (cores >= 8 && deviceMemoryGB >= 8) {
      // MacBook Air M-series: 8 cores but fanless → throttles with too many workers
      // Use 3 workers: enough parallelism without severe throttling
      maxWorkers = fileSizeGB > 0.5 ? 2 : 3;
    } else {
      maxWorkers = Math.max(1, Math.min(2, Math.floor(cores / 2)));
    }

    const workerCount = Math.min(maxWorkers, totalJobs);
    const jobsPerWorker = Math.ceil(totalJobs / workerCount);

    const chunks: [number, number][] = [];
    for (let i = 0; i < workerCount; i++) {
      const start = i * jobsPerWorker;
      const end = Math.min(start + jobsPerWorker, totalJobs);
      if (start < end) chunks.push([start, end]);
    }

    // Queue-based async generator: workers push batches, generator yields them
    const batchQueue: MeshData[][] = [];
    let resolveWaiting: (() => void) | null = null;
    let workersCompleted = 0;
    let totalMeshes = 0;
    let workerError: Error | null = null;

    const workers: Worker[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const [jobStart, jobEnd] = chunks[i];
      if (jobStart >= jobEnd) {
        workersCompleted++;
        continue;
      }
      const workerJobs = jobsFlat.slice(jobStart * 3, jobEnd * 3);

      const worker = new Worker(
        new URL('./geometry.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workers.push(worker);

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'batch') {
          // Convert transferable data back to MeshData[]
          const meshes: MeshData[] = msg.meshes.map((m: {
            expressId: number;
            ifcType?: string;
            positions: Float32Array;
            normals: Float32Array;
            indices: Uint32Array;
            color: [number, number, number, number];
          }) => ({
            expressId: m.expressId,
            ifcType: m.ifcType,
            positions: m.positions instanceof Float32Array ? m.positions : new Float32Array(m.positions),
            normals: m.normals instanceof Float32Array ? m.normals : new Float32Array(m.normals),
            indices: m.indices instanceof Uint32Array ? m.indices : new Uint32Array(m.indices),
            color: m.color,
          }));

          if (meshes.length > 0) {
            batchQueue.push(meshes);
            if (resolveWaiting) {
              resolveWaiting();
              resolveWaiting = null;
            }
          }
        } else if (msg.type === 'complete') {
          totalMeshes += msg.totalMeshes;
          workersCompleted++;
          worker.terminate();
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        } else if (msg.type === 'error') {
          workerError = new Error(`Geometry worker error: ${msg.message}`);
          workersCompleted++;
          worker.terminate();
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        }
      };

      worker.onerror = (e) => {
        workerError = new Error(`Geometry worker failed: ${e.message}`);
        workersCompleted++;
        worker.terminate();
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      };

      // Send work — sharedBuffer is zero-copy, typed arrays are transferred
      worker.postMessage({
        type: 'process' as const,
        sharedBuffer,
        jobsFlat: workerJobs,
        unitScale,
        rtcX, rtcY, rtcZ,
        needsShift,
        voidKeys, voidCounts, voidValues,
        styleIds, styleColors,
      });
    }

    // Yield batches as they arrive from any worker
    while (true) {
      while (batchQueue.length > 0) {
        const batch = batchQueue.shift()!;
        this.coordinateHandler.processMeshesIncremental(batch);
        const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
        yield {
          type: 'batch',
          meshes: batch,
          totalSoFar: totalMeshes,
          coordinateInfo: coordinateInfo || undefined,
        };
      }

      if (workerError) {
        // Terminate remaining workers
        for (const w of workers) {
          try { w.terminate(); } catch { /* ignore */ }
        }
        throw workerError;
      }

      if (workersCompleted >= chunks.length && batchQueue.length === 0) {
        break;
      }

      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
    yield { type: 'complete', totalMeshes, coordinateInfo };
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

      yield { type: 'model-open', modelID: 0 };

      let allMeshes: MeshData[];

      if (this.isNative && this.platformBridge) {
        // NATIVE PATH - single batch processing
        console.time('[GeometryProcessor] native-adaptive-sync');
        const result = await this.platformBridge.processGeometry(buffer);
        allMeshes = result.meshes;
        console.timeEnd('[GeometryProcessor] native-adaptive-sync');
      } else {
        // WASM PATH
        const decoder = new TextDecoder();
        const content = decoder.decode(buffer);
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
      // Large files: parallel or streaming
      const useParallel = typeof SharedArrayBuffer !== 'undefined'
        && typeof Worker !== 'undefined'
        && typeof navigator !== 'undefined'
        && (navigator.hardwareConcurrency ?? 1) > 1;

      if (useParallel) {
        yield* this.processParallel(buffer);
      } else {
        yield* this.processStreaming(buffer, options.entityIndex, batchConfig);
      }
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

  getLastNativeStats(): PlatformGeometryStats | null {
    return this.lastNativeStats;
  }

  private enqueueNativeStreamingEvent(
    queuedEvents: QueuedNativeStreamingEvent[],
    event: QueuedNativeStreamingEvent,
    queueState: { queuedMeshes: number; coalescedBatchCount: number }
  ): void {
    if (event.type === 'colorUpdate') {
      const lastEvent = queuedEvents[queuedEvents.length - 1];
      if (lastEvent?.type === 'colorUpdate') {
        for (const [expressId, color] of event.updates) {
          lastEvent.updates.set(expressId, color);
        }
        return;
      }
      queuedEvents.push(event);
      return;
    }

    const lastEvent = queuedEvents[queuedEvents.length - 1];
    const shouldCoalesce =
      lastEvent?.type === 'batch' &&
      (queuedEvents.length >= MAX_NATIVE_STREAM_QUEUE_EVENTS || queueState.queuedMeshes >= MAX_NATIVE_STREAM_QUEUE_MESHES);

    if (shouldCoalesce) {
      for (let i = 0; i < event.meshes.length; i++) {
        lastEvent.meshes.push(event.meshes[i]);
      }
      lastEvent.nativeTelemetry = event.nativeTelemetry;
      queueState.coalescedBatchCount += 1;
    } else {
      queuedEvents.push(event);
    }

    queueState.queuedMeshes += event.meshes.length;
  }

  private async *streamNativeGeometry(
    startStream: (options: {
      onBatch: (batch: import('./platform-bridge.js').GeometryBatch) => void;
      onColorUpdate: (updates: Map<number, [number, number, number, number]>) => void;
      onComplete: (stats: PlatformGeometryStats) => void;
      onError: (error: Error) => void;
    }) => Promise<PlatformGeometryStats>,
    totalEstimate: number
  ): AsyncGenerator<StreamingGeometryEvent> {
    this.coordinateHandler.reset();

    yield { type: 'start', totalEstimate };
    await yieldToEventLoop();
    yield { type: 'model-open', modelID: 0 };

    const queuedEvents: QueuedNativeStreamingEvent[] = [];
    const queueState = { queuedMeshes: 0, coalescedBatchCount: 0 };
    let resolvePending: (() => void) | null = null;
    let completed = false;
    let streamError: Error | null = null;
    let completedTotalMeshes: number | undefined;
    let totalMeshes = 0;

    const wake = () => {
      if (resolvePending) {
        resolvePending();
        resolvePending = null;
      }
    };

    const streamingPromise = startStream({
      onBatch: (batch) => {
        this.enqueueNativeStreamingEvent(
          queuedEvents,
          { type: 'batch', meshes: batch.meshes, nativeTelemetry: batch.nativeTelemetry },
          queueState
        );
        wake();
      },
      onColorUpdate: (updates) => {
        this.enqueueNativeStreamingEvent(queuedEvents, { type: 'colorUpdate', updates: new Map(updates) }, queueState);
        wake();
      },
      onComplete: (stats) => {
        this.lastNativeStats = stats;
        completedTotalMeshes = stats.totalMeshes;
        completed = true;
        wake();
      },
      onError: (error) => {
        streamError = error;
        completed = true;
        wake();
      },
    });

    while (!completed || queuedEvents.length > 0) {
      let drainedEventCount = 0;
      let drainedMeshCount = 0;
      let drainStartedAt = performance.now();
      while (queuedEvents.length > 0) {
        const event = queuedEvents.shift()!;
        if (event.type === 'colorUpdate') {
          yield { type: 'colorUpdate', updates: event.updates };
          continue;
        }

        queueState.queuedMeshes = Math.max(0, queueState.queuedMeshes - event.meshes.length);
        // Native desktop streaming already produces site-local geometry, so
        // avoid the generic JS RTC/outlier scan on every streamed batch.
        this.coordinateHandler.processTrustedMeshesIncremental(event.meshes);
        totalMeshes += event.meshes.length;
        const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();
        yield {
          type: 'batch',
          meshes: event.meshes,
          totalSoFar: totalMeshes,
          coordinateInfo: coordinateInfo || undefined,
          nativeTelemetry: event.nativeTelemetry,
        };
        drainedEventCount += 1;
        drainedMeshCount += event.meshes.length;

        if (queuedEvents.length > 0) {
          const shouldYield =
            drainedEventCount >= MAX_NATIVE_STREAM_EVENTS_PER_TURN ||
            drainedMeshCount >= MAX_NATIVE_STREAM_MESHES_PER_TURN ||
            performance.now() - drainStartedAt >= MAX_NATIVE_STREAM_DRAIN_MS;
          if (shouldYield) {
            await yieldToEventLoop();
            drainedEventCount = 0;
            drainedMeshCount = 0;
            drainStartedAt = performance.now();
          }
        }
      }

      if (streamError) {
        throw streamError;
      }

      if (!completed) {
        await new Promise<void>((resolve) => {
          resolvePending = resolve;
        });
      }
    }

    await streamingPromise;

    if (queueState.coalescedBatchCount > 0) {
      console.info(
        `[GeometryProcessor] Coalesced ${queueState.coalescedBatchCount} native batches while JS drained the queue`
      );
    }

    const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
    yield { type: 'complete', totalMeshes: completedTotalMeshes ?? totalMeshes, coordinateInfo };
  }

  /**
   * Parse symbolic representations (Plan, Annotation, FootPrint) from IFC content
   * These are pre-authored 2D curves for architectural drawings (door swings, window cuts, etc.)
   * @param buffer IFC file buffer
   * @returns Collection of symbolic polylines and circles
   */
  parseSymbolicRepresentations(buffer: Uint8Array): import('@ifc-lite/wasm').SymbolicRepresentationCollection | null {
    if (!this.bridge || !this.bridge.isInitialized()) {
      return null;
    }
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);
    return this.bridge.parseSymbolicRepresentations(content);
  }

  /**
   * Extract raw profile polygons from IfcExtrudedAreaSolid building elements.
   * Returns clean per-element profile outlines + 3D placement transforms.
   * Used by Drawing2DGenerator for artifact-free 2D projection.
   * @param buffer IFC file buffer
   * @param modelIndex Federation model index (0 for single-model files)
   * @returns Collection of ProfileEntryJs items, or null if not initialized
   */
  extractProfiles(buffer: Uint8Array, modelIndex: number = 0): import('@ifc-lite/wasm').ProfileCollection | null {
    if (!this.bridge || !this.bridge.isInitialized()) {
      return null;
    }
    const decoder = new TextDecoder();
    const content = decoder.decode(buffer);
    return this.bridge.extractProfiles(content, modelIndex);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // No cleanup needed
  }
}

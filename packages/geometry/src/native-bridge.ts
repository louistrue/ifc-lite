/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native Bridge Implementation
 *
 * Uses Tauri commands for geometry processing in desktop apps.
 * Provides native Rust performance with multi-threading support.
 */

import type {
  IPlatformBridge,
  GeometryProcessingResult,
  GeometryStats,
  StreamingOptions,
  GeometryBatch,
  NativeBatchTelemetry,
} from './platform-bridge.js';
import type { MeshData, CoordinateInfo } from './types.js';

// Tauri API types - dynamically imported to avoid issues in web builds
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

// Tauri internals interface (set by Tauri runtime)
interface TauriInternals {
  invoke: InvokeFn;
}

interface NativeStreamingProgress {
  processed: number;
  total: number;
  currentType: string;
}

interface NativeBatchTelemetryPayload {
  batchSequence: number;
  payloadKind: string;
  meshCount: number;
  positionsLen: number;
  normalsLen: number;
  indicesLen: number;
  chunkReadyTimeMs: number;
  packTimeMs: number;
  emitTimeMs: number;
  emittedTimeMs: number;
}

interface NativeColorUpdatePayload {
  updates: Array<{
    expressId: number;
    color: [number, number, number, number];
  }>;
}

interface NativeGeometryCacheManifest {
  version: number;
  totalMeshes: number;
  totalVertices: number;
  totalTriangles: number;
  shardCount: number;
  metadataSnapshotSize: number;
}

interface NativeGeometryCacheStreamStatus {
  cacheKey: string;
  totalMeshes: number;
  readyShardCount: number;
  readyMeshes: number;
  done: boolean;
  failed: boolean;
  errorMessage?: string;
}

const NATIVE_CACHE_PREFETCH_WINDOW = 2;
const MAX_DEFERRED_BATCHES_PER_DRAIN = 4;
const MAX_DEFERRED_MESHES_PER_DRAIN = 8192;
const MAX_DEFERRED_DRAIN_MS = 10;

type DeferredNativeBatchPayload =
  | {
      type: 'mesh-array';
      meshes: NativeMeshData[];
      progress: NativeStreamingProgress;
      telemetry?: NativeBatchTelemetryPayload;
    }
  | {
      type: 'packed';
      payload: NativePackedGeometryBatch;
    };

function yieldToEventLoop(): Promise<void> {
  const maybeScheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (typeof maybeScheduler?.yield === 'function') {
    return maybeScheduler.yield();
  }
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/**
 * Native Tauri bridge for desktop apps
 *
 * This uses Tauri's invoke() to call native Rust commands that use
 * ifc-lite-core and ifc-lite-geometry directly (no WASM overhead).
 */
export class NativeBridge implements IPlatformBridge {
  private initialized = false;
  private invoke: InvokeFn | null = null;
  private listen: ListenFn | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;

    // Access Tauri internals directly to avoid bundler issues
    // This is set by Tauri runtime and is always available in Tauri apps
    const win = globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals };
    if (!win.__TAURI_INTERNALS__?.invoke) {
      throw new Error('Tauri API not available - this bridge should only be used in Tauri apps');
    }

    this.invoke = win.__TAURI_INTERNALS__.invoke;

    // For event listening, we still need the event module
    // Use dynamic import with try-catch for better error handling
    try {
      const event = await import('@tauri-apps/api/event');
      this.listen = event.listen;
    } catch {
      // Event listening is optional - streaming will fall back to non-streaming
      console.warn('[NativeBridge] Event API not available, streaming will be limited');
    }

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private async drainDeferredBatches(
    pendingBatches: DeferredNativeBatchPayload[],
    options: StreamingOptions,
    streamStartTime: number
  ): Promise<void> {
    let drainedBatchCount = 0;
    let drainedMeshCount = 0;
    let drainStartedAt = performance.now();
    while (pendingBatches.length > 0) {
      const next = pendingBatches.shift()!;
      const batch: GeometryBatch =
        next.type === 'mesh-array'
          ? {
              meshes: next.meshes.map(convertNativeMesh),
              progress: {
                processed: next.progress.processed,
                total: next.progress.total,
                currentType: next.progress.currentType,
              },
              nativeTelemetry: convertNativeBatchTelemetry(
                next.telemetry,
                performance.now() - streamStartTime
              ),
            }
          : {
              meshes: convertPackedNativeBatch(next.payload),
              progress: {
                processed: next.payload.progress.processed,
                total: next.payload.progress.total,
                currentType: next.payload.progress.currentType,
              },
              nativeTelemetry: convertNativeBatchTelemetry(
                next.payload.telemetry,
                performance.now() - streamStartTime
              ),
            };
      options.onBatch?.(batch);
      drainedBatchCount += 1;
      drainedMeshCount += batch.meshes.length;
      if (pendingBatches.length > 0) {
        const shouldYield =
          drainedBatchCount >= MAX_DEFERRED_BATCHES_PER_DRAIN ||
          drainedMeshCount >= MAX_DEFERRED_MESHES_PER_DRAIN ||
          performance.now() - drainStartedAt >= MAX_DEFERRED_DRAIN_MS;
        if (shouldYield) {
          await yieldToEventLoop();
          drainedBatchCount = 0;
          drainedMeshCount = 0;
          drainStartedAt = performance.now();
        }
      }
    }
  }

  private async processEventDrivenNativeStream<TArgs extends Record<string, unknown>>(
    command: string,
    args: TArgs,
    options: StreamingOptions,
    streamStartTime: number
  ): Promise<GeometryStats> {
    if (!this.listen) {
      throw new Error(`Event API unavailable, ${command} requires Tauri event support`);
    }

    const pendingBatches: DeferredNativeBatchPayload[] = [];
    let drainPromise: Promise<void> | null = null;
    let drainError: Error | null = null;
    const scheduleDrain = () => {
      if (drainPromise) return;
      drainPromise = (async () => {
        try {
          await this.drainDeferredBatches(pendingBatches, options, streamStartTime);
        } catch (error) {
          drainError = error instanceof Error ? error : new Error(String(error));
        } finally {
          drainPromise = null;
          if (pendingBatches.length > 0 && !drainError) {
            scheduleDrain();
          }
        }
      })();
    };

    const unlisten = await this.listen<{
      meshes: NativeMeshData[];
      progress: NativeStreamingProgress;
      telemetry?: NativeBatchTelemetryPayload;
    }>('geometry-batch', (event) => {
      pendingBatches.push({
        type: 'mesh-array',
        meshes: event.payload.meshes,
        progress: event.payload.progress,
        telemetry: event.payload.telemetry,
      });
      scheduleDrain();
    });
    const unlistenPacked = await this.listen<NativePackedGeometryBatch>('geometry-packed-batch', (event) => {
      pendingBatches.push({
        type: 'packed',
        payload: event.payload,
      });
      scheduleDrain();
    });
    const unlistenColorUpdate = await this.listen<NativeColorUpdatePayload>('geometry-color-update', (event) => {
      const updates = new Map<number, [number, number, number, number]>();
      for (const entry of event.payload.updates) {
        updates.set(entry.expressId, entry.color);
      }
      if (updates.size > 0) {
        options.onColorUpdate?.(updates);
      }
    });

    try {
      const stats = await this.invoke!<{
        totalMeshes: number;
        totalVertices: number;
        totalTriangles: number;
        parseTimeMs: number;
        entityScanTimeMs?: number;
        lookupTimeMs?: number;
        preprocessTimeMs?: number;
        geometryTimeMs: number;
        totalTimeMs?: number;
        firstChunkReadyTimeMs?: number;
        firstChunkPackTimeMs?: number;
        firstChunkEmittedTimeMs?: number;
        firstChunkEmitTimeMs?: number;
      }>(command, args);

      const result: GeometryStats = {
        totalMeshes: stats.totalMeshes,
        totalVertices: stats.totalVertices,
        totalTriangles: stats.totalTriangles,
        parseTimeMs: stats.parseTimeMs,
        entityScanTimeMs: stats.entityScanTimeMs,
        lookupTimeMs: stats.lookupTimeMs,
        preprocessTimeMs: stats.preprocessTimeMs,
        geometryTimeMs: stats.geometryTimeMs,
        totalTimeMs: stats.totalTimeMs,
        firstChunkReadyTimeMs: stats.firstChunkReadyTimeMs,
        firstChunkPackTimeMs: stats.firstChunkPackTimeMs,
        firstChunkEmittedTimeMs: stats.firstChunkEmittedTimeMs,
        firstChunkEmitTimeMs: stats.firstChunkEmitTimeMs,
      };

      while (drainPromise) {
        await drainPromise;
      }
      if (drainError) {
        throw drainError;
      }

      return result;
    } finally {
      unlisten();
      unlistenPacked();
      unlistenColorUpdate();
    }
  }

  async processGeometry(content: string): Promise<GeometryProcessingResult> {
    if (!this.initialized || !this.invoke) {
      await this.init();
    }

    // Convert string to buffer for Tauri command
    const encoder = new TextEncoder();
    const buffer = Array.from(encoder.encode(content));

    // Call native Rust command
    const result = await this.invoke!<{
      meshes: NativeMeshData[];
      totalVertices: number;
      totalTriangles: number;
      coordinateInfo: NativeCoordinateInfo;
    }>('get_geometry', { buffer });

    // Convert native format to TypeScript format
    const meshes: MeshData[] = result.meshes.map(convertNativeMesh);
    const coordinateInfo = convertNativeCoordinateInfo(result.coordinateInfo);

    return {
      meshes,
      totalVertices: result.totalVertices,
      totalTriangles: result.totalTriangles,
      coordinateInfo,
    };
  }

  async processGeometryPath(path: string): Promise<GeometryProcessingResult> {
    if (!this.initialized || !this.invoke) {
      await this.init();
    }

    const result = await this.invoke!<{
      meshes: NativeMeshData[];
      totalVertices: number;
      totalTriangles: number;
      coordinateInfo: NativeCoordinateInfo;
    }>('get_geometry_from_path', { path });

    return {
      meshes: result.meshes.map(convertNativeMesh),
      totalVertices: result.totalVertices,
      totalTriangles: result.totalTriangles,
      coordinateInfo: convertNativeCoordinateInfo(result.coordinateInfo),
    };
  }

  async processGeometryStreaming(
    content: string,
    options: StreamingOptions
  ): Promise<GeometryStats> {
    if (!this.initialized || !this.invoke) {
      await this.init();
    }

    // If event API not available, fall back to non-streaming processing
    if (!this.listen) {
      console.warn('[NativeBridge] Event API unavailable, falling back to non-streaming mode');
      const result = await this.processGeometry(content);
      const stats: GeometryStats = {
        totalMeshes: result.meshes.length,
        totalVertices: result.totalVertices,
        totalTriangles: result.totalTriangles,
        parseTimeMs: 0,
        entityScanTimeMs: 0,
        lookupTimeMs: 0,
        preprocessTimeMs: 0,
        geometryTimeMs: 0,
        totalTimeMs: 0,
        firstChunkReadyTimeMs: 0,
        firstChunkPackTimeMs: 0,
        firstChunkEmittedTimeMs: 0,
        firstChunkEmitTimeMs: 0,
      };
      // Emit single batch with all meshes
      options.onBatch?.({
        meshes: result.meshes,
        progress: { processed: result.meshes.length, total: result.meshes.length, currentType: 'complete' },
      });
      options.onComplete?.(stats);
      return stats;
    }

    // Convert string to buffer for Tauri command
    const encoder = new TextEncoder();
    const buffer = Array.from(encoder.encode(content));

    const streamStartTime = performance.now();
    const pendingBatches: DeferredNativeBatchPayload[] = [];
    let drainPromise: Promise<void> | null = null;
    let drainError: Error | null = null;
    const scheduleDrain = () => {
      if (drainPromise) return;
      drainPromise = (async () => {
        try {
          await this.drainDeferredBatches(pendingBatches, options, streamStartTime);
        } catch (error) {
          drainError = error instanceof Error ? error : new Error(String(error));
        } finally {
          drainPromise = null;
          if (pendingBatches.length > 0 && !drainError) {
            scheduleDrain();
          }
        }
      })();
    };
    const unlisten = await this.listen<{
      meshes: NativeMeshData[];
      progress: NativeStreamingProgress;
      telemetry?: NativeBatchTelemetryPayload;
    }>('geometry-batch', (event) => {
      pendingBatches.push({
        type: 'mesh-array',
        meshes: event.payload.meshes,
        progress: event.payload.progress,
        telemetry: event.payload.telemetry,
      });
      scheduleDrain();
    });
    const unlistenPacked = await this.listen<NativePackedGeometryBatch>('geometry-packed-batch', (event) => {
      pendingBatches.push({
        type: 'packed',
        payload: event.payload,
      });
      scheduleDrain();
    });
    const unlistenColorUpdate = await this.listen<NativeColorUpdatePayload>('geometry-color-update', (event) => {
      const updates = new Map<number, [number, number, number, number]>();
      for (const entry of event.payload.updates) {
        updates.set(entry.expressId, entry.color);
      }
      if (updates.size > 0) {
        options.onColorUpdate?.(updates);
      }
    });

    try {
      // Call native streaming command
      const stats = await this.invoke!<{
        totalMeshes: number;
        totalVertices: number;
        totalTriangles: number;
        parseTimeMs: number;
        entityScanTimeMs?: number;
        lookupTimeMs?: number;
        preprocessTimeMs?: number;
        geometryTimeMs: number;
        totalTimeMs?: number;
        firstChunkReadyTimeMs?: number;
        firstChunkPackTimeMs?: number;
        firstChunkEmittedTimeMs?: number;
        firstChunkEmitTimeMs?: number;
      }>('get_geometry_streaming', { buffer });

      const result: GeometryStats = {
        totalMeshes: stats.totalMeshes,
        totalVertices: stats.totalVertices,
        totalTriangles: stats.totalTriangles,
        parseTimeMs: stats.parseTimeMs,
        entityScanTimeMs: stats.entityScanTimeMs,
        lookupTimeMs: stats.lookupTimeMs,
        preprocessTimeMs: stats.preprocessTimeMs,
        geometryTimeMs: stats.geometryTimeMs,
        totalTimeMs: stats.totalTimeMs,
        firstChunkReadyTimeMs: stats.firstChunkReadyTimeMs,
        firstChunkPackTimeMs: stats.firstChunkPackTimeMs,
        firstChunkEmittedTimeMs: stats.firstChunkEmittedTimeMs,
        firstChunkEmitTimeMs: stats.firstChunkEmitTimeMs,
      };

      while (drainPromise) {
        await drainPromise;
      }
      if (drainError) {
        throw drainError;
      }

      options.onComplete?.(result);
      return result;
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      // Clean up event listener
      unlisten();
      unlistenPacked();
      unlistenColorUpdate();
    }
  }

  async processGeometryStreamingPath(
    path: string,
    options: StreamingOptions,
    cacheKey?: string,
  ): Promise<GeometryStats> {
    if (!this.initialized || !this.invoke) {
      await this.init();
    }

    const streamStartTime = performance.now();
    if (!cacheKey) {
      throw new Error('Packed shard path streaming requires a cache key');
    }
    return this.processPackedShardPathStream(path, cacheKey, options, streamStartTime);
  }

  async processGeometryStreamingCache(
    cacheKey: string,
    options: StreamingOptions
  ): Promise<GeometryStats> {
    if (!this.initialized || !this.invoke) {
      await this.init();
    }

    const streamStartTime = performance.now();
    try {
      const manifest = await this.invoke!<NativeGeometryCacheManifest | null>(
        'get_native_geometry_cache_manifest',
        { cacheKey }
      );
      if (!manifest) {
        throw new Error(`Native geometry cache manifest missing for ${cacheKey}`);
      }

      let processedMeshes = 0;
      for (let shardIndex = 0; shardIndex < manifest.shardCount; shardIndex += 1) {
        const shardPayload = await this.invoke!<unknown>(
          'get_native_geometry_cache_packed_shard',
          { cacheKey, shardIndex }
        );
        const batch = decodePackedGeometryCacheShard(
          shardPayload,
          performance.now() - streamStartTime,
          shardIndex + 1
        );
        processedMeshes = batch.progress.processed;
        options.onBatch?.(batch);
        if (shardIndex + 1 < manifest.shardCount) {
          await yieldToEventLoop();
        }
      }

      const result: GeometryStats = {
        totalMeshes: manifest.totalMeshes,
        totalVertices: manifest.totalVertices,
        totalTriangles: manifest.totalTriangles,
        parseTimeMs: 0,
        entityScanTimeMs: 0,
        lookupTimeMs: 0,
        preprocessTimeMs: 0,
        geometryTimeMs: Math.round(performance.now() - streamStartTime),
        totalTimeMs: Math.round(performance.now() - streamStartTime),
        firstChunkReadyTimeMs: 0,
        firstChunkPackTimeMs: 0,
        firstChunkEmittedTimeMs: 0,
        firstChunkEmitTimeMs: 0,
      };

      if (processedMeshes !== manifest.totalMeshes) {
        console.warn(
          `[NativeBridge] Cached packed shard stream mesh mismatch for ${cacheKey}: received=${processedMeshes} expected=${manifest.totalMeshes}`
        );
      }

      options.onComplete?.(result);
      return result;
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async processPackedShardPathStream(
    path: string,
    cacheKey: string,
    options: StreamingOptions,
    streamStartTime: number
  ): Promise<GeometryStats> {
    const statsPromise = this.invoke!<{
      totalMeshes: number;
      totalVertices: number;
      totalTriangles: number;
      parseTimeMs: number;
      entityScanTimeMs?: number;
      lookupTimeMs?: number;
      preprocessTimeMs?: number;
      geometryTimeMs: number;
      totalTimeMs?: number;
      firstChunkReadyTimeMs?: number;
      firstChunkPackTimeMs?: number;
      firstChunkEmittedTimeMs?: number;
      firstChunkEmitTimeMs?: number;
    }>('get_geometry_streaming_from_path', {
      path,
      cacheKey,
      preferPackedShards: true,
    });

    let nextShardIndex = 0;
    let lastProgressAt = performance.now();
    let processedMeshes = 0;

    while (true) {
      const status = await this.invoke!<NativeGeometryCacheStreamStatus | null>(
        'get_native_geometry_cache_stream_status',
        { cacheKey }
      );

      if (status?.failed) {
        throw new Error(status.errorMessage ?? `Packed shard stream failed for ${cacheKey}`);
      }

      const readyShardCount = status?.readyShardCount ?? 0;
      while (nextShardIndex < readyShardCount) {
        const shardPayload = await this.invoke!<unknown>(
          'get_native_geometry_cache_packed_shard',
          { cacheKey, shardIndex: nextShardIndex }
        );
        const batch = decodePackedGeometryCacheShard(
          shardPayload,
          performance.now() - streamStartTime,
          nextShardIndex + 1
        );
        processedMeshes = Math.max(processedMeshes, batch.progress.processed);
        lastProgressAt = performance.now();
        options.onBatch?.(batch);
        nextShardIndex += 1;
        if (nextShardIndex < readyShardCount) {
          await yieldToEventLoop();
        }
      }

      if (status?.done && nextShardIndex >= readyShardCount) {
        break;
      }

      if (performance.now() - lastProgressAt > 15_000) {
        throw new Error(
          `Packed shard path stream stalled for ${cacheKey}: shards=${nextShardIndex}/${readyShardCount} processed=${processedMeshes}`
        );
      }

      await sleep(8);
    }

    const stats = await statsPromise;
    const result: GeometryStats = {
      totalMeshes: stats.totalMeshes,
      totalVertices: stats.totalVertices,
      totalTriangles: stats.totalTriangles,
      parseTimeMs: stats.parseTimeMs,
      entityScanTimeMs: stats.entityScanTimeMs,
      lookupTimeMs: stats.lookupTimeMs,
      preprocessTimeMs: stats.preprocessTimeMs,
      geometryTimeMs: stats.geometryTimeMs,
      totalTimeMs: stats.totalTimeMs,
      firstChunkReadyTimeMs: stats.firstChunkReadyTimeMs,
      firstChunkPackTimeMs: stats.firstChunkPackTimeMs,
      firstChunkEmittedTimeMs: stats.firstChunkEmittedTimeMs,
      firstChunkEmitTimeMs: stats.firstChunkEmitTimeMs,
    };

    options.onComplete?.(result);
    return result;
  }

  getApi(): null {
    // Native bridge doesn't expose an API object
    return null;
  }
}

// Native types from Rust (camelCase due to serde rename)
interface NativeMeshData {
  expressId: number;
  ifcType?: string;
  positions: number[];
  normals: number[];
  indices: number[];
  color: [number, number, number, number];
}

interface NativePackedMeshRange {
  expressId: number;
  ifcType?: string;
  positionsOffset: number;
  positionsLen: number;
  normalsOffset: number;
  normalsLen: number;
  indicesOffset: number;
  indicesLen: number;
  color: [number, number, number, number];
}

interface NativePackedGeometryBatch {
  meshes: NativePackedMeshRange[];
  positions: number[];
  normals: number[];
  indices: number[];
  progress: NativeStreamingProgress;
  telemetry?: NativeBatchTelemetryPayload;
}

interface NativePoint3 {
  x: number;
  y: number;
  z: number;
}

interface NativeBounds {
  min: NativePoint3;
  max: NativePoint3;
}

interface NativeCoordinateInfo {
  originShift: NativePoint3;
  originalBounds: NativeBounds;
  shiftedBounds: NativeBounds;
  hasLargeCoordinates: boolean;
}

// Conversion functions
function convertNativeMesh(native: NativeMeshData): MeshData {
  return {
    expressId: native.expressId,
    ifcType: native.ifcType,
    positions: new Float32Array(native.positions),
    normals: new Float32Array(native.normals),
    indices: new Uint32Array(native.indices),
    color: native.color,
  };
}

function convertPackedNativeBatch(native: NativePackedGeometryBatch): MeshData[] {
  // Copy each packed numeric array once, then hand meshes cheap subarray views
  // instead of slicing and copying per mesh.
  const positions = Float32Array.from(native.positions);
  const normals = Float32Array.from(native.normals);
  const indices = Uint32Array.from(native.indices);

  return native.meshes.map((mesh) => ({
    expressId: mesh.expressId,
    ifcType: mesh.ifcType,
    positions: positions.subarray(mesh.positionsOffset, mesh.positionsOffset + mesh.positionsLen),
    normals: normals.subarray(mesh.normalsOffset, mesh.normalsOffset + mesh.normalsLen),
    indices: indices.subarray(mesh.indicesOffset, mesh.indicesOffset + mesh.indicesLen),
    color: mesh.color,
  }));
}

function toArrayBuffer(payload: unknown): ArrayBuffer {
  if (payload instanceof ArrayBuffer) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    if (
      payload.byteOffset === 0
      && payload.byteLength === payload.buffer.byteLength
      && payload.buffer instanceof ArrayBuffer
    ) {
      return payload.buffer;
    }
    return payload.slice().buffer;
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(payload as number[]).buffer;
  }
  throw new Error(`Unsupported packed geometry shard payload: ${typeof payload}`);
}

function decodePackedGeometryCacheShard(
  payload: unknown,
  jsReceivedTimeMs: number,
  batchSequence: number
): GeometryBatch {
  const buffer = toArrayBuffer(payload);
  const header = new Uint32Array(buffer, 0, 8);
  const [magic, version, meshCount, positionsLen, normalsLen, indicesLen, processed, total] = header;
  if (magic !== 0x49464342) {
    throw new Error('Invalid packed geometry cache shard magic');
  }
  if (version !== 1) {
    throw new Error(`Unsupported packed geometry cache shard version: ${version}`);
  }

  const meshRecordWordLength = 11;
  const meshWordOffset = 8;
  const meshTableWords = meshCount * meshRecordWordLength;
  const dataByteOffset = (meshWordOffset + meshTableWords) * Uint32Array.BYTES_PER_ELEMENT;
  const positionsByteLength = positionsLen * Float32Array.BYTES_PER_ELEMENT;
  const normalsByteLength = normalsLen * Float32Array.BYTES_PER_ELEMENT;
  const indicesByteLength = indicesLen * Uint32Array.BYTES_PER_ELEMENT;
  const positionsOffset = dataByteOffset;
  const normalsOffset = positionsOffset + positionsByteLength;
  const indicesOffset = normalsOffset + normalsByteLength;

  const positions = new Float32Array(buffer, positionsOffset, positionsLen);
  const normals = new Float32Array(buffer, normalsOffset, normalsLen);
  const indices = new Uint32Array(buffer, indicesOffset, indicesLen);
  const meshView = new DataView(
    buffer,
    meshWordOffset * Uint32Array.BYTES_PER_ELEMENT,
    meshTableWords * Uint32Array.BYTES_PER_ELEMENT
  );

  const meshes: MeshData[] = [];
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    const base = meshIndex * meshRecordWordLength * Uint32Array.BYTES_PER_ELEMENT;
    const expressId = meshView.getUint32(base, true);
    const positionsOffsetWords = meshView.getUint32(base + 4, true);
    const positionsLengthWords = meshView.getUint32(base + 8, true);
    const normalsOffsetWords = meshView.getUint32(base + 12, true);
    const normalsLengthWords = meshView.getUint32(base + 16, true);
    const indicesOffsetWords = meshView.getUint32(base + 20, true);
    const indicesLengthWords = meshView.getUint32(base + 24, true);
    const color: [number, number, number, number] = [
      meshView.getFloat32(base + 28, true),
      meshView.getFloat32(base + 32, true),
      meshView.getFloat32(base + 36, true),
      meshView.getFloat32(base + 40, true),
    ];
    meshes.push({
      expressId,
      positions: positions.subarray(positionsOffsetWords, positionsOffsetWords + positionsLengthWords),
      normals: normals.subarray(normalsOffsetWords, normalsOffsetWords + normalsLengthWords),
      indices: indices.subarray(indicesOffsetWords, indicesOffsetWords + indicesLengthWords),
      color,
    });
  }

  return {
    meshes,
    progress: {
      processed,
      total,
      currentType: 'cached',
    },
    nativeTelemetry: {
      batchSequence,
      payloadKind: 'packed-cache-shard',
      meshCount,
      positionsLen,
      normalsLen,
      indicesLen,
      chunkReadyTimeMs: 0,
      packTimeMs: 0,
      emitTimeMs: 0,
      emittedTimeMs: 0,
      jsReceivedTimeMs,
    },
  };
}

function convertNativeBatchTelemetry(
  telemetry: NativeBatchTelemetryPayload | undefined,
  jsReceivedTimeMs: number
): NativeBatchTelemetry | undefined {
  if (!telemetry) {
    return undefined;
  }

  return {
    batchSequence: telemetry.batchSequence,
    payloadKind: telemetry.payloadKind,
    meshCount: telemetry.meshCount,
    positionsLen: telemetry.positionsLen,
    normalsLen: telemetry.normalsLen,
    indicesLen: telemetry.indicesLen,
    chunkReadyTimeMs: telemetry.chunkReadyTimeMs,
    packTimeMs: telemetry.packTimeMs,
    emitTimeMs: telemetry.emitTimeMs,
    emittedTimeMs: telemetry.emittedTimeMs,
    jsReceivedTimeMs,
  };
}

function convertNativeCoordinateInfo(native: NativeCoordinateInfo): CoordinateInfo {
  return {
    originShift: native.originShift,
    originalBounds: native.originalBounds,
    shiftedBounds: native.shiftedBounds,
    hasLargeCoordinates: native.hasLargeCoordinates,
  };
}

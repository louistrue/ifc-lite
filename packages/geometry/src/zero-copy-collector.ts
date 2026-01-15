/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zero-Copy Mesh Collector - streams GPU-ready geometry with zero-copy access
 *
 * This collector uses the new GPU geometry API that:
 * - Pre-interleaves vertex data (position + normal)
 * - Pre-converts coordinates (Z-up to Y-up)
 * - Exposes pointers for direct WASM memory access
 *
 * The collector provides TypedArray views into WASM memory. The caller
 * is responsible for uploading to GPU (use @ifc-lite/renderer's ZeroCopyGpuUploader).
 *
 * IMPORTANT: Views become INVALID when WASM memory grows!
 * Use the "immediate upload" pattern - create view, upload, discard.
 */

import type { IfcAPI } from '@ifc-lite/wasm';
import { WasmMemoryManager, type GpuGeometryHandle } from './wasm-memory-manager.js';

export interface ZeroCopyStreamingProgress {
  percent: number;
  processed: number;
  total?: number;
  phase: 'simple' | 'simple_complete' | 'complex' | 'complete';
}

export interface ZeroCopyBatchResult {
  /** Number of meshes in this batch */
  meshCount: number;
  /** Total vertices in this batch */
  vertexCount: number;
  /** Total triangles in this batch */
  triangleCount: number;
}

export interface ZeroCopyCompleteStats {
  totalMeshes: number;
  totalVertices: number;
  totalTriangles: number;
}

/**
 * Mesh metadata for draw calls and selection
 */
export interface ZeroCopyMeshMetadata {
  expressId: number;
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
  color: [number, number, number, number];
}

/**
 * Batch of geometry data with zero-copy views
 */
export interface ZeroCopyBatch {
  /** View into WASM memory for vertex data (interleaved pos+normal) */
  vertexView: Float32Array;
  /** View into WASM memory for index data */
  indexView: Uint32Array;
  /** Byte length of vertex data (for GPU buffer creation) */
  vertexByteLength: number;
  /** Byte length of index data */
  indexByteLength: number;
  /** Mesh metadata for draw calls */
  meshMetadata: ZeroCopyMeshMetadata[];
  /** Batch statistics */
  stats: ZeroCopyBatchResult;
  /** Free WASM memory (call after uploading to GPU!) */
  free: () => void;
}

/**
 * Zero-copy mesh collector that streams GPU-ready geometry batches
 *
 * Usage:
 * ```typescript
 * const collector = new ZeroCopyMeshCollector(ifcApi, content);
 *
 * for await (const batch of collector.streamBatches()) {
 *   // Create GPU buffers
 *   const vertexBuffer = device.createBuffer({
 *     size: batch.vertexByteLength,
 *     usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
 *   });
 *
 *   // Upload directly from WASM memory (single copy!)
 *   device.queue.writeBuffer(vertexBuffer, 0, batch.vertexView);
 *
 *   // IMPORTANT: Free after upload!
 *   batch.free();
 * }
 * ```
 */
export class ZeroCopyMeshCollector {
  private ifcApi: IfcAPI;
  private content: string;
  private memoryManager: WasmMemoryManager;

  constructor(ifcApi: IfcAPI, content: string) {
    this.ifcApi = ifcApi;
    this.content = content;

    // Get WASM memory for zero-copy access
    const wasmMemory = ifcApi.getMemory() as { buffer: ArrayBuffer };
    this.memoryManager = new WasmMemoryManager(wasmMemory);
  }

  /**
   * Stream geometry batches with zero-copy views into WASM memory
   *
   * @param batchSize Number of meshes per batch (default: 25)
   * @yields Batches with views into WASM memory
   */
  async *streamBatches(batchSize: number = 25): AsyncGenerator<ZeroCopyBatch> {
    // Queue to hold batches from async callback
    const batchQueue: GpuGeometryHandle[] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;

    // Define parseToGpuGeometryAsync type
    type ParseOptions = {
      batchSize: number;
      onBatch: (gpuGeom: GpuGeometryHandle, progress: ZeroCopyStreamingProgress) => void;
      onComplete: (stats: ZeroCopyCompleteStats) => void;
    };

    // Start async processing
    const processingPromise = (this.ifcApi as unknown as {
      parseToGpuGeometryAsync: (content: string, options: ParseOptions) => Promise<void>;
    }).parseToGpuGeometryAsync(this.content, {
      batchSize,
      onBatch: (gpuGeom: GpuGeometryHandle, _progress: ZeroCopyStreamingProgress) => {
        batchQueue.push(gpuGeom);

        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
      onComplete: (_stats: ZeroCopyCompleteStats) => {
        isComplete = true;
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
    });

    // Process batches as they arrive
    while (true) {
      while (batchQueue.length > 0) {
        const gpuGeom = batchQueue.shift()!;

        // Create zero-copy views into WASM memory
        const vertexView = this.memoryManager.createFloat32View(
          gpuGeom.vertexDataPtr,
          gpuGeom.vertexDataLen
        );
        const indexView = this.memoryManager.createUint32View(
          gpuGeom.indicesPtr,
          gpuGeom.indicesLen
        );

        // Extract mesh metadata
        const meshMetadata: ZeroCopyMeshMetadata[] = [];
        for (let i = 0; i < gpuGeom.meshCount; i++) {
          const meta = gpuGeom.getMeshMetadata(i);
          if (meta) {
            meshMetadata.push({
              expressId: meta.expressId,
              vertexOffset: meta.vertexOffset,
              vertexCount: meta.vertexCount,
              indexOffset: meta.indexOffset,
              indexCount: meta.indexCount,
              color: meta.color as [number, number, number, number],
            });
          }
        }

        yield {
          vertexView,
          indexView,
          vertexByteLength: gpuGeom.vertexDataByteLength,
          indexByteLength: gpuGeom.indicesByteLength,
          meshMetadata,
          stats: {
            meshCount: gpuGeom.meshCount,
            vertexCount: gpuGeom.totalVertexCount,
            triangleCount: gpuGeom.totalTriangleCount,
          },
          free: () => gpuGeom.free(),
        };
      }

      if (isComplete && batchQueue.length === 0) break;

      // Wait for more batches
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    await processingPromise;
  }

  /**
   * Parse all geometry at once (for smaller files)
   *
   * @returns Batch with views into WASM memory
   */
  parseAll(): ZeroCopyBatch {
    // Get GPU-ready geometry from WASM
    const gpuGeom = (this.ifcApi as unknown as {
      parseToGpuGeometry: (content: string) => GpuGeometryHandle;
    }).parseToGpuGeometry(this.content);

    // Create zero-copy views
    const vertexView = this.memoryManager.createFloat32View(
      gpuGeom.vertexDataPtr,
      gpuGeom.vertexDataLen
    );
    const indexView = this.memoryManager.createUint32View(
      gpuGeom.indicesPtr,
      gpuGeom.indicesLen
    );

    // Extract mesh metadata
    const meshMetadata: ZeroCopyMeshMetadata[] = [];
    for (let i = 0; i < gpuGeom.meshCount; i++) {
      const meta = gpuGeom.getMeshMetadata(i);
      if (meta) {
        meshMetadata.push({
          expressId: meta.expressId,
          vertexOffset: meta.vertexOffset,
          vertexCount: meta.vertexCount,
          indexOffset: meta.indexOffset,
          indexCount: meta.indexCount,
          color: meta.color as [number, number, number, number],
        });
      }
    }

    return {
      vertexView,
      indexView,
      vertexByteLength: gpuGeom.vertexDataByteLength,
      indexByteLength: gpuGeom.indicesByteLength,
      meshMetadata,
      stats: {
        meshCount: gpuGeom.meshCount,
        vertexCount: gpuGeom.totalVertexCount,
        triangleCount: gpuGeom.totalTriangleCount,
      },
      free: () => gpuGeom.free(),
    };
  }

  /**
   * Get WASM memory manager for advanced use cases
   */
  getMemoryManager(): WasmMemoryManager {
    return this.memoryManager;
  }
}

/**
 * Instanced geometry batch with zero-copy views
 */
export interface ZeroCopyInstancedBatch {
  geometryId: bigint;
  /** View into WASM memory for vertex data */
  vertexView: Float32Array;
  /** View into WASM memory for index data */
  indexView: Uint32Array;
  /** View into WASM memory for instance data [transform(16) + color(4)] */
  instanceView: Float32Array;
  /** Express IDs for each instance */
  expressIds: number[];
  /** Byte lengths for GPU buffer creation */
  vertexByteLength: number;
  indexByteLength: number;
  instanceByteLength: number;
  /** Statistics */
  indexCount: number;
  instanceCount: number;
}

/**
 * Zero-copy instanced geometry collector
 */
export class ZeroCopyInstancedCollector {
  private ifcApi: IfcAPI;
  private content: string;
  private memoryManager: WasmMemoryManager;

  constructor(ifcApi: IfcAPI, content: string) {
    this.ifcApi = ifcApi;
    this.content = content;

    const wasmMemory = ifcApi.getMemory() as { buffer: ArrayBuffer };
    this.memoryManager = new WasmMemoryManager(wasmMemory);
  }

  /**
   * Parse instanced geometry with zero-copy views
   *
   * @returns Array of instanced geometry batches
   */
  parseAll(): {
    batches: ZeroCopyInstancedBatch[];
    stats: { geometryCount: number; totalInstances: number };
    free: () => void;
  } {
    // Get instanced geometry collection from WASM
    type CollectionHandle = {
      length: number;
      getRef: (index: number) => {
        geometryId: bigint;
        vertexDataPtr: number;
        vertexDataLen: number;
        vertexDataByteLength: number;
        indicesPtr: number;
        indicesLen: number;
        indicesByteLength: number;
        instanceDataPtr: number;
        instanceDataLen: number;
        instanceDataByteLength: number;
        instanceExpressIdsPtr: number;
        instanceCount: number;
      } | undefined;
      free?: () => void;
    };

    const collection = (this.ifcApi as unknown as {
      parseToGpuInstancedGeometry: (content: string) => CollectionHandle;
    }).parseToGpuInstancedGeometry(this.content);

    const batches: ZeroCopyInstancedBatch[] = [];
    let totalInstances = 0;

    for (let i = 0; i < collection.length; i++) {
      const geomRef = collection.getRef(i);
      if (!geomRef) continue;

      // Create zero-copy views
      const vertexView = this.memoryManager.createFloat32View(
        geomRef.vertexDataPtr,
        geomRef.vertexDataLen
      );
      const indexView = this.memoryManager.createUint32View(
        geomRef.indicesPtr,
        geomRef.indicesLen
      );
      const instanceView = this.memoryManager.createFloat32View(
        geomRef.instanceDataPtr,
        geomRef.instanceDataLen
      );
      const expressIdsView = this.memoryManager.createUint32View(
        geomRef.instanceExpressIdsPtr,
        geomRef.instanceCount
      );

      batches.push({
        geometryId: geomRef.geometryId,
        vertexView,
        indexView,
        instanceView,
        expressIds: Array.from(expressIdsView),
        vertexByteLength: geomRef.vertexDataByteLength,
        indexByteLength: geomRef.indicesByteLength,
        instanceByteLength: geomRef.instanceDataByteLength,
        indexCount: geomRef.indicesLen,
        instanceCount: geomRef.instanceCount,
      });

      totalInstances += geomRef.instanceCount;
    }

    return {
      batches,
      stats: {
        geometryCount: collection.length,
        totalInstances,
      },
      free: () => {
        if (typeof collection.free === 'function') {
          collection.free();
        }
      },
    };
  }

  /**
   * Get WASM memory manager for advanced use cases
   */
  getMemoryManager(): WasmMemoryManager {
    return this.memoryManager;
  }
}

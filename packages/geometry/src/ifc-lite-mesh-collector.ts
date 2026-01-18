/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite Mesh Collector - extracts triangle data from IFC-Lite WASM
 * Replaces mesh-collector.ts - uses native Rust geometry processing (1.9x faster)
 */

import type { IfcAPI, MeshDataJs, InstancedGeometry } from '@ifc-lite/wasm';
import type { MeshData } from './types.js';

export interface StreamingProgress {
  percent: number;
  processed: number;
  total: number;
  phase: 'simple' | 'simple_complete' | 'complex';
}

export interface StreamingBatchEvent {
  type: 'batch';
  meshes: MeshData[];
  progress: StreamingProgress;
}

export interface StreamingCompleteEvent {
  type: 'complete';
  stats: {
    totalMeshes: number;
    totalVertices: number;
    totalTriangles: number;
  };
}

export interface StreamingColorUpdateEvent {
  type: 'colorUpdate';
  updates: Map<number, [number, number, number, number]>;
}

export type StreamingEvent = StreamingBatchEvent | StreamingCompleteEvent | StreamingColorUpdateEvent;

export class IfcLiteMeshCollector {
  private ifcApi: IfcAPI;
  private content: string;

  constructor(ifcApi: IfcAPI, content: string) {
    this.ifcApi = ifcApi;
    this.content = content;
  }

  /**
   * Convert IFC Z-up coordinates to WebGL Y-up coordinates
   * IFC uses Z-up (Z points up), WebGL uses Y-up (Y points up)
   * Transformation: swap Y and Z, then negate new Z to maintain right-handedness
   */
  private convertZUpToYUp(coords: Float32Array): void {
    for (let i = 0; i < coords.length; i += 3) {
      const y = coords[i + 1];
      const z = coords[i + 2];
      // Swap Y and Z: Z-up → Y-up
      coords[i + 1] = z;      // New Y = old Z (vertical)
      coords[i + 2] = -y;     // New Z = -old Y (depth, negated for right-hand rule)
    }
  }

  /**
   * Collect all meshes from IFC-Lite
   * Much faster than web-ifc (~1.9x speedup)
   */
  collectMeshes(): MeshData[] {
    // const totalStart = performance.now();

    // const parseStart = performance.now();
    const collection = this.ifcApi.parseMeshes(this.content);
    // const parseTime = performance.now() - parseStart;

    const meshes: MeshData[] = [];
    // const conversionStart = performance.now();

    // Convert MeshCollection to MeshData[]
    for (let i = 0; i < collection.length; i++) {
      const mesh = collection.get(i);
      if (!mesh) continue;

      // Get color array [r, g, b, a]
      const colorArray = mesh.color;
      const color: [number, number, number, number] = [
        colorArray[0],
        colorArray[1],
        colorArray[2],
        colorArray[3],
      ];

      // Capture arrays once (WASM creates new copies on each access)
      const positions = mesh.positions;
      const normals = mesh.normals;
      const indices = mesh.indices;

      // Convert IFC Z-up to WebGL Y-up (modify captured arrays)
      this.convertZUpToYUp(positions);
      this.convertZUpToYUp(normals);

      meshes.push({
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        positions,
        normals,
        indices,
        color,
      });

      // Free the individual mesh to avoid memory leaks
      mesh.free();
    }

    // Store stats before freeing
    // const totalVertices = collection.totalVertices;
    // const totalTriangles = collection.totalTriangles;

    // Free the collection
    collection.free();

    // const conversionTime = performance.now() - conversionStart;
    return meshes;
  }

  /**
   * Collect meshes incrementally, yielding batches for progressive rendering
   * Uses fast-first-frame streaming: simple geometry (walls, slabs) first
   * @param batchSize Number of meshes per batch (default: 25 for faster first frame)
   */
  async *collectMeshesStreaming(batchSize: number = 25): AsyncGenerator<MeshData[] | StreamingColorUpdateEvent> {
    // Queue to hold batches produced by async callback
    const batchQueue: (MeshData[] | StreamingColorUpdateEvent)[] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;
    // Map to store color updates for pending batches
    const colorUpdates = new Map<number, [number, number, number, number]>();

    // Start async processing
    // NOTE: WASM now automatically defers style building for faster first frame
    const processingPromise = this.ifcApi.parseMeshesAsync(this.content, {
      batchSize,
      onColorUpdate: (updates: Map<number, [number, number, number, number]>) => {
        // Store color updates
        for (const [expressId, color] of updates) {
          colorUpdates.set(expressId, color);
        }
        // Emit color update event
        batchQueue.push({
          type: 'colorUpdate',
          updates: new Map(updates),
        });
        // Wake up the generator if it's waiting
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
      onBatch: (meshes: MeshDataJs[], _progress: StreamingProgress) => {
        // Convert WASM meshes to MeshData[]
        const convertedBatch: MeshData[] = [];

        for (const mesh of meshes) {
          // Use updated color if available, otherwise use mesh color
          const expressId = mesh.expressId;
          const color: [number, number, number, number] = colorUpdates.get(expressId) ?? [
            mesh.color[0],
            mesh.color[1],
            mesh.color[2],
            mesh.color[3],
          ];

          // Capture arrays once
          const positions = mesh.positions;
          const normals = mesh.normals;
          const indices = mesh.indices;

          // Convert IFC Z-up to WebGL Y-up
          this.convertZUpToYUp(positions);
          this.convertZUpToYUp(normals);

          convertedBatch.push({
            expressId,
            ifcType: mesh.ifcType,
            positions,
            normals,
            indices,
            color,
          });

          // Free the mesh to avoid memory leaks
          mesh.free();
        }

        // Add batch to queue
        batchQueue.push(convertedBatch);

        // Wake up the generator if it's waiting
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
      onComplete: (_stats: { totalMeshes: number; totalVertices: number; totalTriangles: number }) => {
        isComplete = true;
        // Wake up the generator if it's waiting
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
    });

    // Yield batches as they become available
    while (true) {
      // Yield any queued batches
      while (batchQueue.length > 0) {
        yield batchQueue.shift()!;
      }

      // Check if we're done
      if (isComplete && batchQueue.length === 0) {
        break;
      }

      // Wait for more batches
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    // Ensure processing is complete
    await processingPromise;
  }

  /**
   * Collect meshes with dynamic batch sizing (ramp-up approach)
   * Accumulates meshes from WASM and yields them in dynamically-sized batches
   * @param getBatchSize Function that returns batch size for current batch number
   */
  async *collectMeshesStreamingDynamic(
    getBatchSize: () => number
  ): AsyncGenerator<MeshData[]> {
    let batchNumber = 0;
    let accumulatedMeshes: MeshData[] = [];
    let currentBatchSize = getBatchSize();

    // Use larger WASM batches to reduce callback overhead
    // First frame responsiveness comes from WASM's internal simple/complex ordering
    // For huge files (>100MB), use 500 to minimize callbacks (20x fewer than 25)
    const wasmBatchSize = 500; // Larger batches = fewer callbacks = faster

    for await (const item of this.collectMeshesStreaming(wasmBatchSize)) {
      // Skip color update events in dynamic batching
      if (item && typeof item === 'object' && 'type' in item && (item as StreamingColorUpdateEvent).type === 'colorUpdate') {
        continue;
      }
      const wasmBatch = item as MeshData[];
      accumulatedMeshes.push(...wasmBatch);

      // Yield when we've accumulated enough for current dynamic batch size
      while (accumulatedMeshes.length >= currentBatchSize) {
        const batchToYield = accumulatedMeshes.splice(0, currentBatchSize);
        yield batchToYield;
        
        // Update batch size for next batch
        batchNumber++;
        currentBatchSize = getBatchSize();
      }
    }

    // Yield remaining meshes
    if (accumulatedMeshes.length > 0) {
      yield accumulatedMeshes;
    }
  }

  /**
   * Collect instanced geometry incrementally, yielding batches for progressive rendering
   * Groups identical geometries by hash (before transformation) for GPU instancing
   * Uses fast-first-frame streaming: simple geometry (walls, slabs) first
   * @param batchSize Number of unique geometries per batch (default: 25)
   */
  async *collectInstancedGeometryStreaming(batchSize: number = 25): AsyncGenerator<InstancedGeometry[]> {
    // Queue to hold batches produced by async callback
    const batchQueue: InstancedGeometry[][] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;

    // Start async processing
    const processingPromise = this.ifcApi.parseMeshesInstancedAsync(this.content, {
      batchSize,
      onBatch: (geometries: InstancedGeometry[], _progress: StreamingProgress) => {
        // NOTE: Do NOT convert Z-up to Y-up here for instanced geometry!
        // Instance transforms position geometry in world space.
        // If we convert local positions but not transforms, geometry breaks.
        // The viewer handles coordinate system in the camera/shader.
        // Add batch directly to queue without modification
        batchQueue.push(geometries);

        // Wake up the generator if it's waiting
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
      onComplete: (_stats: { totalGeometries: number; totalInstances: number }) => {
        isComplete = true;
        // Wake up the generator if it's waiting
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      },
    });

    // Yield batches as they become available
    while (true) {
      // Yield any queued batches
      while (batchQueue.length > 0) {
        yield batchQueue.shift()!;
      }

      // Check if we're done
      if (isComplete && batchQueue.length === 0) {
        break;
      }

      // Wait for more batches
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    // Ensure processing is complete
    await processingPromise;
  }
}

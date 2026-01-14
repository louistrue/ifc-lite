/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite Mesh Collector - extracts triangle data from IFC-Lite WASM
 * Replaces mesh-collector.ts - uses native Rust geometry processing (1.9x faster)
 */

import type { IfcAPI, MeshDataJs } from '@ifc-lite/wasm';
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

export type StreamingEvent = StreamingBatchEvent | StreamingCompleteEvent;

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
   * @param batchSize Number of meshes per batch (default: 100)
   */
  async *collectMeshesStreaming(batchSize: number = 100): AsyncGenerator<MeshData[]> {
    // Queue to hold batches produced by async callback
    const batchQueue: MeshData[][] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;

    // Start async processing
    const processingPromise = this.ifcApi.parseMeshesAsync(this.content, {
      batchSize,
      onBatch: (meshes: MeshDataJs[], _progress: StreamingProgress) => {
        // Convert WASM meshes to MeshData[]
        const convertedBatch: MeshData[] = [];

        for (const mesh of meshes) {
          const colorArray = mesh.color;
          const color: [number, number, number, number] = [
            colorArray[0],
            colorArray[1],
            colorArray[2],
            colorArray[3],
          ];

          // Capture arrays once
          const positions = mesh.positions;
          const normals = mesh.normals;
          const indices = mesh.indices;

          // Convert IFC Z-up to WebGL Y-up
          this.convertZUpToYUp(positions);
          this.convertZUpToYUp(normals);

          convertedBatch.push({
            expressId: mesh.expressId,
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
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WASM Bridge Implementation
 *
 * Uses @ifc-lite/wasm for geometry processing in web browsers.
 * This is the existing implementation wrapped in the IPlatformBridge interface.
 */

import type {
  IPlatformBridge,
  GeometryProcessingResult,
  GeometryStats,
  StreamingOptions,
} from './platform-bridge.js';
import { IfcLiteBridge } from './ifc-lite-bridge.js';
import { IfcLiteMeshCollector, type StreamingColorUpdateEvent } from './ifc-lite-mesh-collector.js';
import type { CoordinateInfo, MeshData } from './types.js';

/**
 * WASM-based platform bridge for web browsers
 */
export class WasmBridge implements IPlatformBridge {
  private bridge: IfcLiteBridge;
  private initialized = false;

  constructor() {
    this.bridge = new IfcLiteBridge();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.bridge.init();
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async processGeometry(content: string): Promise<GeometryProcessingResult> {
    if (!this.initialized) {
      await this.init();
    }

    const startTime = performance.now();
    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);
    const meshes = collector.collectMeshes();
    const endTime = performance.now();

    // Calculate totals
    let totalVertices = 0;
    let totalTriangles = 0;
    for (const mesh of meshes) {
      totalVertices += mesh.positions.length / 3;
      totalTriangles += mesh.indices.length / 3;
    }

    // Default coordinate info (coordinate handling is done by GeometryProcessor)
    const coordinateInfo: CoordinateInfo = {
      originShift: { x: 0, y: 0, z: 0 },
      originalBounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
      shiftedBounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
      hasLargeCoordinates: false,
    };

    return {
      meshes,
      totalVertices,
      totalTriangles,
      coordinateInfo,
    };
  }

  async processGeometryStreaming(
    content: string,
    options: StreamingOptions
  ): Promise<GeometryStats> {
    if (!this.initialized) {
      await this.init();
    }

    const startTime = performance.now();
    const collector = new IfcLiteMeshCollector(this.bridge.getApi(), content);

    let totalMeshes = 0;
    let totalVertices = 0;
    let totalTriangles = 0;

    try {
      for await (const item of collector.collectMeshesStreaming(50)) {
        // Handle color update events (skip them for streaming stats)
        if (item && typeof item === 'object' && 'type' in item && (item as StreamingColorUpdateEvent).type === 'colorUpdate') {
          continue;
        }

        // Handle mesh batches
        const batch = item as MeshData[];
        totalMeshes += batch.length;

        for (const mesh of batch) {
          totalVertices += mesh.positions.length / 3;
          totalTriangles += mesh.indices.length / 3;
        }

        options.onBatch?.({
          meshes: batch,
          progress: {
            processed: totalMeshes,
            total: totalMeshes, // We don't know total upfront with WASM
            currentType: 'processing',
          },
        });
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    const stats: GeometryStats = {
      totalMeshes,
      totalVertices,
      totalTriangles,
      parseTimeMs: totalTime * 0.3, // Estimate
      geometryTimeMs: totalTime * 0.7, // Estimate
    };

    options.onComplete?.(stats);
    return stats;
  }

  getApi(): unknown {
    return this.bridge.getApi();
  }
}

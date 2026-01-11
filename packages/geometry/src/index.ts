/**
 * @ifc-lite/geometry - Geometry processing bridge
 */

export { WebIfcBridge } from './web-ifc-bridge.js';
export { MeshCollector } from './mesh-collector.js';
export { BufferBuilder } from './buffer-builder.js';
export { CoordinateHandler } from './coordinate-handler.js';
export { WorkerPool } from './worker-pool.js';
export { GeometryQuality } from './progressive-loader.js';
export { LODGenerator, type LODConfig, type LODMesh } from './lod.js';
export * from './types.js';
export * from './default-materials.js';

import { WebIfcBridge } from './web-ifc-bridge.js';
import { MeshCollector } from './mesh-collector.js';
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
  private bridge: WebIfcBridge;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;
  private workerPool: WorkerPool | null = null;
  private wasmPath: string = '/';
  private useWorkers: boolean = false;
  private quality: GeometryQuality;

  constructor(options: GeometryProcessorOptions = {}) {
    this.bridge = new WebIfcBridge();
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
    this.useWorkers = options.useWorkers ?? false;
    this.quality = options.quality ?? GeometryQuality.Balanced;
  }

  /**
   * Initialize web-ifc and worker pool
   */
  async init(wasmPath: string = '/'): Promise<void> {
    this.wasmPath = wasmPath;

    const bridgeInitStart = performance.now();
    await this.bridge.init(wasmPath);
    const bridgeInitTime = performance.now() - bridgeInitStart;
    console.log(`[GeometryProcessor] Bridge init: ${bridgeInitTime.toFixed(2)}ms`);

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
    const meshCollectionStart = performance.now();

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
          const poolInitStart = performance.now();
          this.workerPool = new WorkerPool(workerUrl, 1); // Use single worker for now
          await this.workerPool.init();
          const poolInitTime = performance.now() - poolInitStart;
          console.log(`[GeometryProcessor] Worker pool init: ${poolInitTime.toFixed(2)}ms`);
        } catch (error) {
          console.warn('[GeometryProcessor] Worker pool initialization failed, will use main thread:', error);
          this.workerPool = null;
        }
      }

      if (this.workerPool?.isAvailable()) {
        console.log('[Geometry] Using worker pool for mesh collection');
        try {
          const workerStart = performance.now();
          meshes = await this.workerPool.submit<MeshData[]>('mesh-collection', {
            buffer: buffer.buffer,
            wasmPath: this.wasmPath,
          });
          const workerTime = performance.now() - workerStart;
          console.log(`[Geometry] Worker mesh collection: ${workerTime.toFixed(2)}ms, meshes: ${meshes.length}`);
        } catch (error) {
          console.warn('[Geometry] Worker pool failed, falling back to main thread:', error);
          meshes = await this.collectMeshesMainThread(buffer);
        }
      } else {
        // Fallback to main thread
        console.log('[Geometry] Worker pool not available, using main thread');
        meshes = await this.collectMeshesMainThread(buffer);
      }
    } else {
      // Use main thread (faster for total time, but blocks UI)
      console.log('[Geometry] Using main thread for mesh collection (workers disabled)');
      meshes = await this.collectMeshesMainThread(buffer);
    }

    const meshCollectionTime = performance.now() - meshCollectionStart;
    console.log(`[Geometry] Total mesh collection: ${meshCollectionTime.toFixed(2)}ms`);
    console.log(`[Geometry] Performance Summary:`, {
      method: this.useWorkers ? 'worker' : 'main-thread',
      meshCollectionTime: `${meshCollectionTime.toFixed(2)}ms`,
      meshCount: meshes.length,
    });

    if (meshes.length > 0) {
      console.log('[Geometry] First mesh:', {
        expressId: meshes[0].expressId,
        positions: meshes[0].positions.length,
        normals: meshes[0].normals.length,
        indices: meshes[0].indices.length,
      });
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

    console.log('[Geometry] Result:', {
      meshCount: result.meshes.length,
      totalTriangles: result.totalTriangles,
      totalVertices: result.totalVertices,
      isGeoReferenced: coordinateInfo.isGeoReferenced,
      originShift: coordinateInfo.originShift,
    });

    return result;
  }

  /**
   * Collect meshes on main thread (fallback)
   */
  private async collectMeshesMainThread(buffer: Uint8Array, entityIndex?: Map<number, any>): Promise<MeshData[]> {
    const mainThreadStart = performance.now();
    console.log('[Geometry] Opening model, buffer size:', buffer.length);
    const openStart = performance.now();
    const modelID = this.bridge.openModel(buffer);
    const openTime = performance.now() - openStart;
    console.log(`[Geometry] Model opened in ${openTime.toFixed(2)}ms, ID:`, modelID);

    try {
      const collectStart = performance.now();
      const collector = new MeshCollector(this.bridge.getApi(), modelID, this.quality, entityIndex);
      const meshes = collector.collectMeshes();
      const collectTime = performance.now() - collectStart;
      const totalTime = performance.now() - mainThreadStart;
      console.log(`[Geometry] Main thread - collect: ${collectTime.toFixed(2)}ms, total: ${totalTime.toFixed(2)}ms, meshes: ${meshes.length}`);
      return meshes;
    } finally {
      this.bridge.closeModel(modelID);
    }
  }

  /**
   * Process IFC file with streaming output for progressive rendering
   * @param buffer IFC file buffer
   * @param entityIndex Optional entity index for priority-based loading
   * @param batchSize Number of meshes per batch (default: 100)
   */
  async *processStreaming(
    buffer: Uint8Array,
    entityIndex?: Map<number, any>,
    batchSize: number = 100
  ): AsyncGenerator<StreamingGeometryEvent> {
    if (!this.bridge.isInitialized()) {
      await this.init();
    }

    // Reset coordinate handler for new file
    this.coordinateHandler.reset();

    yield { type: 'start', totalEstimate: buffer.length / 1000 };

    const mainThreadStart = performance.now();
    console.log('[Geometry] Opening model for streaming, buffer size:', buffer.length);
    const openStart = performance.now();
    const modelID = this.bridge.openModel(buffer);
    const openTime = performance.now() - openStart;
    console.log(`[Geometry] Model opened in ${openTime.toFixed(2)}ms, ID:`, modelID);

    yield { type: 'model-open', modelID };

    try {
      const collector = new MeshCollector(this.bridge.getApi(), modelID, this.quality, entityIndex);
      let totalMeshes = 0;

      for await (const batch of collector.collectMeshesStreaming(batchSize)) {
        // Process coordinate shifts incrementally (will accumulate bounds)
        this.coordinateHandler.processMeshesIncremental(batch);
        totalMeshes += batch.length;

        // Get current coordinate info for this batch (may be null if bounds not yet valid)
        const coordinateInfo = this.coordinateHandler.getCurrentCoordinateInfo();

        yield { type: 'batch', meshes: batch, totalSoFar: totalMeshes, coordinateInfo: coordinateInfo || undefined };
      }

      const totalTime = performance.now() - mainThreadStart;
      const coordinateInfo = this.coordinateHandler.getFinalCoordinateInfo();
      console.log(`[Geometry] Streaming complete: ${totalTime.toFixed(2)}ms, total meshes: ${totalMeshes}`);

      yield { type: 'complete', totalMeshes, coordinateInfo };
    } finally {
      this.bridge.closeModel(modelID);
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

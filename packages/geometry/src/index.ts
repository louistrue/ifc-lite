/**
 * @ifc-lite/geometry - Geometry processing bridge
 */

export { WebIfcBridge } from './web-ifc-bridge.js';
export { MeshCollector } from './mesh-collector.js';
export { BufferBuilder } from './buffer-builder.js';
export { CoordinateHandler } from './coordinate-handler.js';
export * from './types.js';
export * from './default-materials.js';

import { WebIfcBridge } from './web-ifc-bridge.js';
import { MeshCollector } from './mesh-collector.js';
import { BufferBuilder } from './buffer-builder.js';
import { CoordinateHandler } from './coordinate-handler.js';
import type { GeometryResult } from './types.js';

/**
 * Main geometry processor
 */
export class GeometryProcessor {
  private bridge: WebIfcBridge;
  private bufferBuilder: BufferBuilder;
  private coordinateHandler: CoordinateHandler;

  constructor() {
    this.bridge = new WebIfcBridge();
    this.bufferBuilder = new BufferBuilder();
    this.coordinateHandler = new CoordinateHandler();
  }

  /**
   * Initialize web-ifc
   */
  async init(wasmPath: string = '/'): Promise<void> {
    await this.bridge.init(wasmPath);
  }

  /**
   * Process IFC file and extract geometry
   */
  async process(buffer: Uint8Array): Promise<GeometryResult> {
    if (!this.bridge.isInitialized()) {
      await this.bridge.init();
    }

    console.log('[Geometry] Opening model, buffer size:', buffer.length);
    const modelID = this.bridge.openModel(buffer);
    console.log('[Geometry] Model opened, ID:', modelID);

    try {
      const collector = new MeshCollector(this.bridge.getApi(), modelID);
      const meshes = collector.collectMeshes();
      console.log('[Geometry] Collected meshes:', meshes.length);

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
    } finally {
      this.bridge.closeModel(modelID);
    }
  }
}

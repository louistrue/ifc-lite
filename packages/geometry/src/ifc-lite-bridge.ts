/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite bridge - initializes and manages IFC-Lite WASM for geometry processing
 * Replaces web-ifc-bridge.ts with native IFC-Lite implementation (1.9x faster)
 */

import { createLogger } from '@ifc-lite/data';
import init, { IfcAPI, MeshCollection, MeshDataJs, InstancedMeshCollection, InstancedGeometry, InstanceData } from '@ifc-lite/wasm';
export type { MeshCollection, MeshDataJs, InstancedMeshCollection, InstancedGeometry, InstanceData };

const log = createLogger('Geometry');

export interface StreamingProgress {
  percent: number;
  processed: number;
  total: number;
  phase: 'simple' | 'simple_complete' | 'complex';
}

export interface StreamingStats {
  totalMeshes: number;
  totalVertices: number;
  totalTriangles: number;
}

export interface InstancedStreamingStats {
  totalGeometries: number;
  totalInstances: number;
}

export interface ParseMeshesAsyncOptions {
  batchSize?: number;
  // NOTE: WASM automatically defers style building for faster first frame
  onBatch?: (meshes: MeshDataJs[], progress: StreamingProgress) => void;
  onComplete?: (stats: StreamingStats) => void;
  onColorUpdate?: (updates: Map<number, [number, number, number, number]>) => void;
}

/**
 * Progress info for front-to-back loading
 */
export interface FrontToBackProgress {
  processed: number;
  total: number;
  percent: number;
}

/**
 * RTC (Relative-to-Center) offset for large coordinates
 */
export interface RtcOffset {
  x: number;
  y: number;
  z: number;
}

/**
 * Deferred element info - position and byte range for later processing
 */
export interface DeferredElement {
  id: number;
  byteStart: number;
  byteEnd: number;
  position: [number, number, number]; // Already converted to Y-up
  distance: number;
}

/**
 * Batch result from front-to-back loading
 */
export interface FrontToBackBatch {
  meshes: MeshDataJs[];
  progress: FrontToBackProgress;
  rtcOffset?: RtcOffset;
  /** Deferred elements (only in final batch when deferral is enabled) */
  deferred?: DeferredElement[];
}

/**
 * Options for front-to-back mesh parsing
 * Camera position determines the order - elements nearest to camera are processed first
 */
export interface ParseMeshesFrontToBackOptions {
  /** Camera position in world coordinates */
  cameraPosition: [number, number, number];
  /** Number of meshes per batch (default: 100) */
  batchSize?: number;
  /**
   * Distance beyond which elements are deferred (not processed immediately).
   * When set, elements farther than this distance from camera will be returned
   * in the final batch's `deferred` array for background processing.
   * Default: undefined (no deferral - process all elements)
   */
  deferDistance?: number;
  /**
   * Minimum number of meshes to process before deferral kicks in.
   * Ensures we have enough geometry to fill the viewport before deferring.
   * Default: 500
   */
  minMeshesBeforeDefer?: number;
  /** Called with each batch of meshes as they are processed */
  onBatch?: (batch: FrontToBackBatch) => void;
}

export interface ParseMeshesInstancedAsyncOptions {
  batchSize?: number;
  onBatch?: (geometries: InstancedGeometry[], progress: StreamingProgress) => void;
  onComplete?: (stats: InstancedStreamingStats) => void;
}

export class IfcLiteBridge {
  private ifcApi: IfcAPI | null = null;
  private initialized: boolean = false;

  /**
   * Initialize IFC-Lite WASM
   * The WASM binary is automatically resolved from the same location as the JS module
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize WASM module - wasm-bindgen automatically resolves the WASM URL
      // from import.meta.url, no need to manually construct paths
      await init();

      this.ifcApi = new IfcAPI();
      this.initialized = true;
      log.info('WASM geometry engine initialized');
    } catch (error) {
      log.error('Failed to initialize WASM geometry engine', error, {
        operation: 'init',
      });
      throw error;
    }
  }

  /**
   * Parse IFC content and return mesh collection (blocking)
   * Returns individual meshes with express IDs and colors
   */
  parseMeshes(content: string): MeshCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    try {
      const collection = this.ifcApi.parseMeshes(content);
      log.debug(`Parsed ${collection.length} meshes`, { operation: 'parseMeshes' });
      return collection;
    } catch (error) {
      log.error('Failed to parse IFC geometry', error, {
        operation: 'parseMeshes',
        data: { contentLength: content.length },
      });
      throw error;
    }
  }

  /**
   * Parse IFC content and return instanced geometry collection (blocking)
   * Groups identical geometries by hash and returns instances with transforms
   * Reduces draw calls significantly for buildings with repeated elements
   */
  parseMeshesInstanced(content: string): InstancedMeshCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    try {
      const collection = this.ifcApi.parseMeshesInstanced(content);
      log.debug(`Parsed ${collection.length} instanced geometries`, { operation: 'parseMeshesInstanced' });
      return collection;
    } catch (error) {
      log.error('Failed to parse instanced IFC geometry', error, {
        operation: 'parseMeshesInstanced',
        data: { contentLength: content.length },
      });
      throw error;
    }
  }

  /**
   * Parse IFC content with streaming (non-blocking)
   * Yields batches progressively for fast first frame
   * Simple geometry (walls, slabs, beams) processed first
   */
  async parseMeshesAsync(content: string, options: ParseMeshesAsyncOptions = {}): Promise<void> {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    try {
      return await this.ifcApi.parseMeshesAsync(content, options);
    } catch (error) {
      log.error('Failed to parse IFC geometry (streaming)', error, {
        operation: 'parseMeshesAsync',
        data: { contentLength: content.length },
      });
      throw error;
    }
  }

  /**
   * Parse IFC content with streaming instanced geometry (non-blocking)
   * Groups identical geometries and yields batches progressively
   * Simple geometry (walls, slabs, beams) processed first
   * Reduces draw calls significantly for buildings with repeated elements
   */
  async parseMeshesInstancedAsync(content: string, options: ParseMeshesInstancedAsyncOptions = {}): Promise<void> {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    try {
      return await this.ifcApi.parseMeshesInstancedAsync(content, options);
    } catch (error) {
      log.error('Failed to parse instanced IFC geometry (streaming)', error, {
        operation: 'parseMeshesInstancedAsync',
        data: { contentLength: content.length },
      });
      throw error;
    }
  }

  /**
   * Parse IFC content with front-to-back ordering based on camera position
   * Elements nearest to camera are processed first, enabling progressive rendering
   * where front geometry appears first and occludes what's behind.
   *
   * This is a GAMECHANGER for perceived load times:
   * - First geometry: <100ms (nearest to camera)
   * - "Looks complete": <300ms (visible geometry)
   * - Full model: background processing
   *
   * With deferral enabled (deferDistance option):
   * - Elements beyond deferDistance are NOT processed during initial load
   * - They are returned in the final batch's `deferred` array
   * - Use processDeferred() to process them on camera movement or in background
   *
   * @param content IFC file content as string
   * @param options Camera position, batch configuration, and deferral settings
   */
  async parseMeshesFrontToBack(content: string, options: ParseMeshesFrontToBackOptions): Promise<void> {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }

    const { cameraPosition, batchSize = 100, deferDistance, minMeshesBeforeDefer, onBatch } = options;

    try {
      // The WASM function takes camera position, callback, batch size, and deferral params
      await this.ifcApi.parseMeshesFrontToBack(
        content,
        cameraPosition[0],
        cameraPosition[1],
        cameraPosition[2],
        (batchResult: FrontToBackBatch) => {
          if (onBatch) {
            onBatch(batchResult);
          }
        },
        batchSize,
        deferDistance, // undefined = no deferral
        minMeshesBeforeDefer
      );

      log.debug('Front-to-back parsing complete', { operation: 'parseMeshesFrontToBack' });
    } catch (error) {
      log.error('Failed to parse IFC geometry (front-to-back)', error, {
        operation: 'parseMeshesFrontToBack',
        data: { contentLength: content.length, cameraPosition },
      });
      throw error;
    }
  }

  /**
   * Process deferred elements that were skipped during front-to-back loading.
   * Call this on camera movement or during idle time for background processing.
   *
   * @param content IFC file content as string (MUST be the same file)
   * @param deferredElements Array of deferred elements from parseMeshesFrontToBack
   * @returns MeshCollection with processed meshes
   */
  processDeferred(content: string, deferredElements: DeferredElement[]): MeshCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }

    try {
      const collection = this.ifcApi.processDeferred(content, deferredElements);
      log.debug(`Processed ${collection.length} deferred meshes`, { operation: 'processDeferred' });
      return collection;
    } catch (error) {
      log.error('Failed to process deferred elements', error, {
        operation: 'processDeferred',
        data: { deferredCount: deferredElements.length },
      });
      throw error;
    }
  }

  /**
   * Get IFC-Lite API instance
   */
  getApi(): IfcAPI {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get version
   */
  getVersion(): string {
    return this.ifcApi?.version ?? 'unknown';
  }
}

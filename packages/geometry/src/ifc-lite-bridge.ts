/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite bridge - initializes and manages IFC-Lite WASM for geometry processing
 * Replaces web-ifc-bridge.ts with native IFC-Lite implementation (1.9x faster)
 */

import { createLogger } from '@ifc-lite/data';
import init, { IfcAPI, initThreadPool, MeshCollection, MeshDataJs, InstancedMeshCollection, InstancedGeometry, InstanceData, SymbolicRepresentationCollection, SymbolicPolyline, SymbolicCircle } from '@ifc-lite/wasm';
export type { MeshCollection, MeshDataJs, InstancedMeshCollection, InstancedGeometry, InstanceData, SymbolicRepresentationCollection, SymbolicPolyline, SymbolicCircle };

const log = createLogger('Geometry');
const FATAL_WASM_RELOAD_REQUIRED_MESSAGE = 'IFC-Lite WASM cannot recover from a fatal runtime error within the same document lifetime. Reload the page or recreate the worker process before calling init() again.';
let fatalWasmRuntimeError: Error | null = null;

/** Module-level flag: tracks whether the WASM module + thread pool have been initialized.
 *  wasm-bindgen's init() is idempotent, but initThreadPool() is NOT — calling it twice
 *  crashes because the rayon global pool is already set up. Since IfcLiteBridge instances
 *  are created per file load, we must guard thread pool init at the module level. */
let wasmModuleInitialized = false;

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

export interface ParseMeshesInstancedAsyncOptions {
  batchSize?: number;
  onBatch?: (geometries: InstancedGeometry[], progress: StreamingProgress) => void;
  onComplete?: (stats: InstancedStreamingStats) => void;
}

export class IfcLiteBridge {
  private ifcApi: IfcAPI | null = null;
  private initialized: boolean = false;

  private isWasmRuntimeError(error: unknown): boolean {
    return error instanceof WebAssembly.RuntimeError;
  }

  private markFatalWasmRuntimeError(): void {
    fatalWasmRuntimeError = new Error(FATAL_WASM_RELOAD_REQUIRED_MESSAGE);
    this.reset();
  }

  /**
   * Initialize IFC-Lite WASM
   * The WASM binary is automatically resolved from the same location as the JS module
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (fatalWasmRuntimeError) {
      throw fatalWasmRuntimeError;
    }

    try {
      console.warn('[Geometry] [init] Starting WASM initialization...');
      await init();
      console.warn('[Geometry] [init] WASM module loaded');

      if (!wasmModuleInitialized) {
        if (typeof SharedArrayBuffer !== 'undefined') {
          console.warn('[Geometry] [init] SharedArrayBuffer available, probing module worker support...');
          const canUseThreads = await this.probeModuleWorkerSupport();
          console.warn(`[Geometry] [init] Module worker probe result: ${canUseThreads}`);
          if (canUseThreads) {
            try {
              const threads = navigator.hardwareConcurrency || 4;
              console.warn(`[Geometry] [init] Calling initThreadPool with ${threads} threads...`);
              await initThreadPool(threads);
              console.warn(`[Geometry] Thread pool initialized with ${threads} threads`);
            } catch (e) {
              console.warn('[Geometry] Thread pool init failed, falling back to single-threaded', e);
            }
          } else {
            console.warn('[Geometry] Module workers unavailable — single-threaded mode');
          }
        } else {
          console.warn('[Geometry] SharedArrayBuffer unavailable — single-threaded mode');
        }
        wasmModuleInitialized = true;
        console.warn('[Geometry] [init] wasmModuleInitialized = true');
      } else {
        console.warn('[Geometry] [init] WASM already initialized (skipping thread pool)');
      }

      this.ifcApi = new IfcAPI();
      this.initialized = true;
      console.warn('[Geometry] WASM geometry engine initialized');
    } catch (error) {
      log.error('Failed to initialize WASM geometry engine', error, {
        operation: 'init',
      });
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      } else {
        this.reset();
      }
      throw error;
    }
  }

  /**
   * Test whether the browser can create module workers with SharedArrayBuffer.
   * wasm-bindgen-rayon's initThreadPool creates module workers internally;
   * if that fails the WASM module is left in an unrecoverable state.
   * This probe creates a minimal module worker to verify support before
   * committing to initThreadPool.
   */
  private async probeModuleWorkerSupport(): Promise<boolean> {
    try {
      console.warn('[Geometry] [probe] Creating test blob worker...');
      const blob = new Blob(
        ['self.postMessage("ok")'],
        { type: 'application/javascript' },
      );
      const url = URL.createObjectURL(blob);
      const result = await new Promise<boolean>((resolve) => {
        try {
          const w = new Worker(url, { type: 'module' });
          const timer = setTimeout(() => {
            console.warn('[Geometry] [probe] Worker timed out after 2s');
            w.terminate();
            resolve(false);
          }, 2000);
          w.onmessage = () => {
            console.warn('[Geometry] [probe] Worker responded OK');
            clearTimeout(timer);
            w.terminate();
            resolve(true);
          };
          w.onerror = (e) => {
            console.warn('[Geometry] [probe] Worker error', e);
            clearTimeout(timer);
            w.terminate();
            resolve(false);
          };
        } catch (e) {
          console.warn('[Geometry] [probe] Worker creation failed', e);
          resolve(false);
        }
      });
      URL.revokeObjectURL(url);
      console.warn(`[Geometry] [probe] Result: ${result}`);
      return result;
    } catch (e) {
      console.warn('[Geometry] [probe] Outer catch', e);
      return false;
    }
  }

  /**
   * Reset the JS wrapper state.
   * This does not reload wasm-bindgen's module singleton after a fatal WASM panic.
   */
  reset(): void {
    this.initialized = false;
    this.ifcApi = null;
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
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      }
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
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      }
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
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      }
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
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      }
      throw error;
    }
  }

  /**
   * Parse IFC content and return symbolic representations (Plan, Annotation, FootPrint)
   * These are pre-authored 2D curves for architectural drawings
   */
  parseSymbolicRepresentations(content: string): SymbolicRepresentationCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    try {
      const collection = this.ifcApi.parseSymbolicRepresentations(content);
      log.debug(`Parsed ${collection.totalCount} symbolic items (${collection.polylineCount} polylines, ${collection.circleCount} circles)`, { operation: 'parseSymbolicRepresentations' });
      return collection;
    } catch (error) {
      log.error('Failed to parse symbolic representations', error, {
        operation: 'parseSymbolicRepresentations',
        data: { contentLength: content.length },
      });
      if (this.isWasmRuntimeError(error)) {
        this.markFatalWasmRuntimeError();
      }
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

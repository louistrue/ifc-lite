/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Platform Bridge Abstraction
 *
 * Provides a unified interface for geometry processing that works in both:
 * - Web browsers (using WASM via @ifc-lite/wasm)
 * - Tauri desktop apps (using native Rust via Tauri commands)
 *
 * The appropriate implementation is selected at runtime based on environment detection.
 */

import type { MeshData, CoordinateInfo } from './types.js';

/**
 * Progress information during streaming geometry processing
 */
export interface StreamingProgress {
  processed: number;
  total: number;
  currentType: string;
}

/**
 * Batch of meshes emitted during streaming
 */
export interface GeometryBatch {
  meshes: MeshData[];
  progress: StreamingProgress;
}

/**
 * Statistics returned after geometry processing completes
 */
export interface GeometryStats {
  totalMeshes: number;
  totalVertices: number;
  totalTriangles: number;
  parseTimeMs: number;
  geometryTimeMs: number;
}

/**
 * Complete geometry result from processing
 */
export interface GeometryProcessingResult {
  meshes: MeshData[];
  totalVertices: number;
  totalTriangles: number;
  coordinateInfo: CoordinateInfo;
}

/**
 * Options for streaming geometry processing
 */
export interface StreamingOptions {
  /** Callback for each batch of meshes */
  onBatch?: (batch: GeometryBatch) => void;
  /** Callback when processing is complete */
  onComplete?: (stats: GeometryStats) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
}

/**
 * Platform bridge interface - abstracts WASM vs native processing
 */
export interface IPlatformBridge {
  /**
   * Initialize the bridge (WASM loading for web, no-op for native)
   */
  init(): Promise<void>;

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean;

  /**
   * Process IFC content and return all geometry at once
   * @param content IFC file content as string
   */
  processGeometry(content: string): Promise<GeometryProcessingResult>;

  /**
   * Process IFC content with streaming output
   * @param content IFC file content as string
   * @param options Streaming options with callbacks
   */
  processGeometryStreaming(content: string, options: StreamingOptions): Promise<GeometryStats>;

  /**
   * Get the underlying API object (for advanced usage)
   * Returns the WASM IfcAPI in web, or null in Tauri
   */
  getApi(): unknown | null;
}

/**
 * Detect if running in Tauri desktop environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Create the appropriate platform bridge based on runtime environment
 *
 * In Tauri: Returns NativeBridge (native Rust processing)
 * In Browser: Returns WasmBridge (WASM processing)
 */
export async function createPlatformBridge(): Promise<IPlatformBridge> {
  if (isTauri()) {
    const { NativeBridge } = await import('./native-bridge.js');
    return new NativeBridge();
  } else {
    const { WasmBridge } = await import('./wasm-bridge.js');
    return new WasmBridge();
  }
}

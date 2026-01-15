/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WASM Memory Manager - manages zero-copy views into WASM linear memory
 *
 * This module provides safe access to WASM memory for zero-copy GPU uploads.
 * Views are created directly into WASM linear memory, avoiding data copies.
 *
 * IMPORTANT: Views become INVALID when WASM memory grows (any allocation).
 * Use the "immediate upload" pattern:
 *   1. Create view
 *   2. Upload to GPU immediately
 *   3. Discard view reference
 *
 * @example
 * ```typescript
 * const manager = new WasmMemoryManager(api.getMemory());
 *
 * // SAFE: View created and used immediately
 * const vertexView = manager.createFloat32View(ptr, len);
 * device.queue.writeBuffer(gpuBuffer, 0, vertexView);
 * // View may be invalid now, but we're done with it
 *
 * // UNSAFE: Don't store views across async boundaries!
 * const view = manager.createFloat32View(ptr, len);
 * await someAsyncOp(); // WASM could allocate here!
 * // view might be INVALID now - use would crash!
 * ```
 */

export interface WasmMemory {
  buffer: ArrayBuffer;
}

/**
 * Manages zero-copy TypedArray views into WASM linear memory
 */
export class WasmMemoryManager {
  private memory: WasmMemory;
  private cachedBuffer: ArrayBuffer | null = null;

  constructor(memory: WasmMemory) {
    this.memory = memory;
  }

  /**
   * Get current memory buffer, detecting if it has changed (grown)
   */
  private getBuffer(): ArrayBuffer {
    const currentBuffer = this.memory.buffer;
    if (this.cachedBuffer !== currentBuffer) {
      // Memory has grown - all existing views are invalid!
      this.cachedBuffer = currentBuffer;
    }
    return currentBuffer;
  }

  /**
   * Create a Float32Array view directly into WASM memory (NO COPY!)
   *
   * WARNING: View becomes invalid if WASM memory grows!
   * Use immediately and discard.
   *
   * @param byteOffset Byte offset into WASM memory (ptr value from Rust)
   * @param length Number of f32 elements (not bytes)
   */
  createFloat32View(byteOffset: number, length: number): Float32Array {
    const buffer = this.getBuffer();
    return new Float32Array(buffer, byteOffset, length);
  }

  /**
   * Create a Uint32Array view directly into WASM memory (NO COPY!)
   *
   * @param byteOffset Byte offset into WASM memory
   * @param length Number of u32 elements (not bytes)
   */
  createUint32View(byteOffset: number, length: number): Uint32Array {
    const buffer = this.getBuffer();
    return new Uint32Array(buffer, byteOffset, length);
  }

  /**
   * Create a Float64Array view directly into WASM memory (NO COPY!)
   *
   * @param byteOffset Byte offset into WASM memory
   * @param length Number of f64 elements (not bytes)
   */
  createFloat64View(byteOffset: number, length: number): Float64Array {
    const buffer = this.getBuffer();
    return new Float64Array(buffer, byteOffset, length);
  }

  /**
   * Create a Uint8Array view directly into WASM memory (NO COPY!)
   *
   * @param byteOffset Byte offset into WASM memory
   * @param length Number of bytes
   */
  createUint8View(byteOffset: number, length: number): Uint8Array {
    const buffer = this.getBuffer();
    return new Uint8Array(buffer, byteOffset, length);
  }

  /**
   * Check if a view is still valid (memory hasn't grown)
   */
  isViewValid(view: ArrayBufferView): boolean {
    return view.buffer === this.memory.buffer;
  }

  /**
   * Get raw ArrayBuffer (for advanced use cases)
   */
  getRawBuffer(): ArrayBuffer {
    return this.getBuffer();
  }

  /**
   * Check if memory has grown since last access
   */
  hasMemoryGrown(): boolean {
    return this.cachedBuffer !== null && this.cachedBuffer !== this.memory.buffer;
  }
}

/**
 * GPU-ready geometry data with pointer access
 * Wraps the WASM GpuGeometry struct for TypeScript use
 */
export interface GpuGeometryHandle {
  /** Pointer to interleaved vertex data [px,py,pz,nx,ny,nz,...] */
  vertexDataPtr: number;
  /** Length of vertex data in f32 elements */
  vertexDataLen: number;
  /** Byte length of vertex data (for GPU buffer creation) */
  vertexDataByteLength: number;

  /** Pointer to index data */
  indicesPtr: number;
  /** Length of indices in u32 elements */
  indicesLen: number;
  /** Byte length of indices */
  indicesByteLength: number;

  /** Number of meshes in this geometry batch */
  meshCount: number;
  /** Total vertex count */
  totalVertexCount: number;
  /** Total triangle count */
  totalTriangleCount: number;

  /** Check if geometry is empty */
  isEmpty: boolean;

  /** Get metadata for a specific mesh */
  getMeshMetadata(index: number): GpuMeshMetadataHandle | undefined;

  /** Free the geometry (allows WASM to reuse memory) */
  free(): void;
}

/**
 * Mesh metadata for draw calls and selection
 */
export interface GpuMeshMetadataHandle {
  expressId: number;
  ifcTypeIdx: number;
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
  color: number[];
}

/**
 * GPU-ready instanced geometry with pointer access
 */
export interface GpuInstancedGeometryHandle {
  /** Geometry ID (hash for deduplication) */
  geometryId: bigint;

  /** Pointer to interleaved vertex data */
  vertexDataPtr: number;
  vertexDataLen: number;
  vertexDataByteLength: number;

  /** Pointer to index data */
  indicesPtr: number;
  indicesLen: number;
  indicesByteLength: number;

  /** Pointer to instance data [transform(16) + color(4)] per instance */
  instanceDataPtr: number;
  instanceDataLen: number;
  instanceDataByteLength: number;

  /** Pointer to express IDs for each instance */
  instanceExpressIdsPtr: number;
  instanceCount: number;

  /** Vertex and triangle counts */
  vertexCount: number;
  triangleCount: number;
}

/**
 * Collection of instanced geometries with pointer access
 */
export interface GpuInstancedGeometryCollectionHandle {
  length: number;
  get(index: number): GpuInstancedGeometryHandle | undefined;
  getRef(index: number): GpuInstancedGeometryRefHandle | undefined;
}

/**
 * Reference to instanced geometry (avoids cloning)
 */
export interface GpuInstancedGeometryRefHandle {
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
}

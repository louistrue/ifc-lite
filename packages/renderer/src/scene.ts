/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Scene graph and mesh management
 */

import type { Mesh, InstancedMesh, BatchedMesh, Vec3 } from './types.js';
import type { MeshData } from '@ifc-lite/geometry';
import { MathUtils } from './math.js';
import type { RenderPipeline } from './pipeline.js';
import { BATCH_CONSTANTS } from './constants.js';

const MAX_ENCODED_ENTITY_ID = 0xFFFFFF;
let warnedEntityIdRange = false;

interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export class Scene {
  private meshes: Mesh[] = [];
  private instancedMeshes: InstancedMesh[] = [];
  private batchedMeshes: BatchedMesh[] = [];
  private batchedMeshMap: Map<string, BatchedMesh> = new Map(); // Map bucketKey -> BatchedMesh
  private batchedMeshData: Map<string, MeshData[]> = new Map(); // Map bucketKey -> accumulated MeshData[]
  private batchedMeshIndex: Map<string, number> = new Map(); // Map bucketKey -> index in batchedMeshes array (O(1) lookup)
  private meshDataMap: Map<number, MeshData[]> = new Map(); // Map expressId -> MeshData[] (for lazy buffer creation, accumulates multiple pieces)
  private meshDataBatchKey: Map<MeshData, string> = new Map(); // Reverse lookup: MeshData -> bucketKey (O(1) removal in updateMeshColors)
  private boundingBoxes: Map<number, BoundingBox> = new Map(); // Map expressId -> bounding box (computed lazily)

  // Buffer-size-aware bucket splitting: when a single color group's geometry
  // would exceed the GPU maxBufferSize, overflow is directed to a new
  // sub-bucket with a suffixed key (e.g. "500|500|500|1000#1"). This keeps
  // all downstream maps single-valued and the rendering code unchanged.
  private activeBucketKey: Map<string, string> = new Map(); // base colorKey -> current active bucket key
  private bucketVertexBytes: Map<string, number> = new Map(); // bucket key -> accumulated vertex buffer bytes
  private nextSplitId: number = 0; // Monotonic counter for sub-bucket keys
  private cachedMaxBufferSize: number = 0; // device.limits.maxBufferSize * safety factor (set on first use)

  // Sub-batch cache for partially visible batches (PERFORMANCE FIX)
  // Key = colorKey + ":" + sorted visible expressIds hash
  // This allows rendering partially visible batches as single draw calls instead of 10,000+ individual draws
  private partialBatchCache: Map<string, BatchedMesh> = new Map();
  private partialBatchCacheKeys: Map<string, string> = new Map(); // colorKey -> current cache key (for invalidation)

  // Color overlay system for lens coloring — NEVER modifies original batches.
  // Overlay batches render on top using depthCompare 'equal', so they only
  // paint where original geometry already wrote depth. Clearing is instant.
  private overrideBatches: BatchedMesh[] = [];
  private colorOverrides: Map<number, [number, number, number, number]> | null = null;

  // Streaming optimization: track pending batch rebuilds
  private pendingBatchKeys: Set<string> = new Set();
  // Temporary fragment batches created during streaming for immediate rendering.
  // Destroyed and replaced by proper merged batches in finalizeStreaming().
  private streamingFragments: BatchedMesh[] = [];

  /**
   * Add mesh to scene
   */
  addMesh(mesh: Mesh): void {
    this.meshes.push(mesh);
  }

  /**
   * Add instanced mesh to scene
   */
  addInstancedMesh(mesh: InstancedMesh): void {
    this.instancedMeshes.push(mesh);
  }

  /**
   * Get all meshes
   */
  getMeshes(): Mesh[] {
    return this.meshes;
  }

  /**
   * Get all instanced meshes
   */
  getInstancedMeshes(): InstancedMesh[] {
    return this.instancedMeshes;
  }

  /**
   * Get all batched meshes
   */
  getBatchedMeshes(): BatchedMesh[] {
    return this.batchedMeshes;
  }

  /**
   * Store MeshData for lazy GPU buffer creation (used for selection highlighting)
   * This avoids creating 2x GPU buffers during streaming
   * Accumulates multiple mesh pieces per expressId (elements can have multiple geometry pieces)
   */
  addMeshData(meshData: MeshData): void {
    const existing = this.meshDataMap.get(meshData.expressId);
    if (existing) {
      existing.push(meshData);
    } else {
      this.meshDataMap.set(meshData.expressId, [meshData]);
    }
  }

  /**
   * Get MeshData by expressId (for lazy buffer creation)
   * Returns merged MeshData if element has multiple pieces with same color,
   * or first piece if colors differ (to preserve correct per-piece colors)
   * @param expressId - The expressId to look up
   * @param modelIndex - Optional modelIndex to filter by (for multi-model support)
   */
  getMeshData(expressId: number, modelIndex?: number): MeshData | undefined {
    let pieces = this.meshDataMap.get(expressId);
    if (!pieces || pieces.length === 0) return undefined;

    // Filter by modelIndex if provided (for multi-model support)
    if (modelIndex !== undefined) {
      pieces = pieces.filter(p => p.modelIndex === modelIndex);
      if (pieces.length === 0) return undefined;
    }

    if (pieces.length === 1) return pieces[0];

    // Check if all pieces have the same color (within tolerance)
    // This handles multi-material elements like windows (frame vs glass)
    const firstColor = pieces[0].color;
    const colorTolerance = 0.01; // Allow small floating point differences
    const allSameColor = pieces.every(piece => {
      const c = piece.color;
      return Math.abs(c[0] - firstColor[0]) < colorTolerance &&
             Math.abs(c[1] - firstColor[1]) < colorTolerance &&
             Math.abs(c[2] - firstColor[2]) < colorTolerance &&
             Math.abs(c[3] - firstColor[3]) < colorTolerance;
    });

    // If colors differ, return first piece without merging
    // This preserves correct per-piece colors for multi-material elements
    // Callers can use getMeshDataPieces() if they need all pieces
    if (!allSameColor) {
      return pieces[0];
    }

    // All pieces have same color - safe to merge
    // Calculate total sizes
    let totalPositions = 0;
    let totalIndices = 0;
    for (const piece of pieces) {
      totalPositions += piece.positions.length;
      totalIndices += piece.indices.length;
    }

    // Create merged arrays
    const mergedPositions = new Float32Array(totalPositions);
    const mergedNormals = new Float32Array(totalPositions);
    const mergedIndices = new Uint32Array(totalIndices);

    let posOffset = 0;
    let idxOffset = 0;
    let vertexOffset = 0;

    for (const piece of pieces) {
      // Copy positions and normals
      mergedPositions.set(piece.positions, posOffset);
      mergedNormals.set(piece.normals, posOffset);

      // Copy indices with offset
      for (let i = 0; i < piece.indices.length; i++) {
        mergedIndices[idxOffset + i] = piece.indices[i] + vertexOffset;
      }

      posOffset += piece.positions.length;
      idxOffset += piece.indices.length;
      vertexOffset += piece.positions.length / 3;
    }

    // Return merged MeshData (all pieces have same color)
    return {
      expressId,
      modelIndex: pieces[0].modelIndex,  // Preserve modelIndex for multi-model support
      positions: mergedPositions,
      normals: mergedNormals,
      indices: mergedIndices,
      color: firstColor,
      ifcType: pieces[0].ifcType,
    };
  }

  /**
   * Check if MeshData exists for an expressId
   * @param expressId - The expressId to look up
   * @param modelIndex - Optional modelIndex to filter by (for multi-model support)
   */
  hasMeshData(expressId: number, modelIndex?: number): boolean {
    const pieces = this.meshDataMap.get(expressId);
    if (!pieces || pieces.length === 0) return false;
    if (modelIndex === undefined) return true;
    // Check if any piece matches the modelIndex
    return pieces.some(p => p.modelIndex === modelIndex);
  }

  /**
   * Get all MeshData pieces for an expressId (without merging).
   * Optionally filter by modelIndex for multi-model safety.
   */
  getMeshDataPieces(expressId: number, modelIndex?: number): MeshData[] | undefined {
    const pieces = this.meshDataMap.get(expressId);
    if (!pieces || pieces.length === 0) return undefined;
    if (modelIndex === undefined) return pieces;
    const filtered = pieces.filter((p) => p.modelIndex === modelIndex);
    return filtered.length > 0 ? filtered : undefined;
  }

  /**
   * Generate color key for grouping meshes.
   * Quantizes RGBA to 10-bit per channel and packs into a compact string.
   * Avoids floating-point template literal overhead of the old approach.
   */
  private colorKey(color: [number, number, number, number]): string {
    // Quantize to 1000 levels (same precision as before, but integer math only)
    const r = Math.round(color[0] * 1000);
    const g = Math.round(color[1] * 1000);
    const b = Math.round(color[2] * 1000);
    const a = Math.round(color[3] * 1000);
    // Pack into single string with fixed-width separator for uniqueness
    return `${r}|${g}|${b}|${a}`;
  }

  /**
   * Append meshes to color batches incrementally
   * Merges new meshes into existing color groups or creates new ones
   *
   * STREAMING OPTIMIZATION: During streaming, creates lightweight "fragment"
   * batches from ONLY the new meshes instead of re-merging all accumulated
   * data. This reduces streaming from O(N²) to O(N). Call finalizeStreaming()
   * when streaming completes to do one O(N) full merge.
   */
  appendToBatches(meshDataArray: MeshData[], device: GPUDevice, pipeline: RenderPipeline, isStreaming: boolean = false): void {
    // Cache max buffer size on first call
    if (this.cachedMaxBufferSize === 0) {
      this.cachedMaxBufferSize = this.getMaxBufferSize(device);
    }

    // Route each mesh into a size-aware bucket for its color
    for (const meshData of meshDataArray) {
      const baseKey = this.colorKey(meshData.color);
      const bucketKey = this.resolveActiveBucket(baseKey, meshData);

      // Accumulate mesh data in the bucket (always — needed for final merge)
      let bucket = this.batchedMeshData.get(bucketKey);
      if (!bucket) {
        bucket = [];
        this.batchedMeshData.set(bucketKey, bucket);
      }
      bucket.push(meshData);

      // Track reverse mapping for O(1) batch removal in updateMeshColors
      this.meshDataBatchKey.set(meshData, bucketKey);

      // Also store individual mesh data for visibility filtering
      this.addMeshData(meshData);

      // Track pending keys for non-streaming rebuild only
      if (!isStreaming) {
        this.pendingBatchKeys.add(bucketKey);
      }
    }

    if (isStreaming) {
      // STREAMING: Create small fragment batches from ONLY the new meshes.
      // Avoids the O(N²) cost of re-merging all accumulated data every batch.
      // finalizeStreaming() destroys fragments and does one O(N) full merge.
      this.createStreamingFragments(meshDataArray, device, pipeline);
      return;
    }

    // NON-STREAMING: Rebuild full batches immediately
    this.rebuildPendingBatches(device, pipeline);
  }

  /**
   * Rebuild all pending batches (call this after streaming completes)
   *
   * Each bucket key already maps to data that fits within the GPU buffer
   * limit (enforced at accumulation time by resolveActiveBucket), so no
   * splitting is needed here — just create one batch per key.
   */
  rebuildPendingBatches(device: GPUDevice, pipeline: RenderPipeline): void {
    if (this.pendingBatchKeys.size === 0) return;

    for (const key of this.pendingBatchKeys) {
      const meshDataForKey = this.batchedMeshData.get(key);

      const existingBatch = this.batchedMeshMap.get(key);

      if (existingBatch) {
        // Destroy old batch buffers
        existingBatch.vertexBuffer.destroy();
        existingBatch.indexBuffer.destroy();
        if (existingBatch.uniformBuffer) {
          existingBatch.uniformBuffer.destroy();
        }
      }

      if (!meshDataForKey || meshDataForKey.length === 0) {
        // Bucket is empty — clean up
        this.batchedMeshMap.delete(key);
        this.batchedMeshData.delete(key);
        this.bucketVertexBytes.delete(key);
        // Swap-remove from flat array using O(1) index lookup
        const arrayIdx = this.batchedMeshIndex.get(key);
        if (arrayIdx !== undefined) {
          const lastIdx = this.batchedMeshes.length - 1;
          if (arrayIdx !== lastIdx) {
            const lastBatch = this.batchedMeshes[lastIdx];
            this.batchedMeshes[arrayIdx] = lastBatch;
            this.batchedMeshIndex.set(lastBatch.colorKey, arrayIdx);
          }
          this.batchedMeshes.pop();
          this.batchedMeshIndex.delete(key);
        }
        continue;
      }

      // Create new batch with all accumulated meshes for this bucket
      const color = meshDataForKey[0].color;
      const batchedMesh = this.createBatchedMesh(meshDataForKey, color, device, pipeline, key);
      this.batchedMeshMap.set(key, batchedMesh);

      // Update array using O(1) index lookup instead of O(N) findIndex
      const existingIndex = this.batchedMeshIndex.get(key);
      if (existingIndex !== undefined) {
        this.batchedMeshes[existingIndex] = batchedMesh;
      } else {
        const newIndex = this.batchedMeshes.length;
        this.batchedMeshes.push(batchedMesh);
        this.batchedMeshIndex.set(key, newIndex);
      }
    }

    this.pendingBatchKeys.clear();
  }

  /**
   * Check if there are pending batch rebuilds
   */
  hasPendingBatches(): boolean {
    return this.pendingBatchKeys.size > 0;
  }

  /**
   * Create lightweight fragment batches from a single streaming batch.
   * Fragments are grouped by color and added to batchedMeshes for immediate
   * rendering, but tracked separately for cleanup in finalizeStreaming().
   */
  private createStreamingFragments(meshDataArray: MeshData[], device: GPUDevice, pipeline: RenderPipeline): void {
    if (meshDataArray.length === 0) return;

    // Group new meshes by color for efficient fragment batches
    const colorGroups = new Map<string, MeshData[]>();
    for (const meshData of meshDataArray) {
      const key = this.colorKey(meshData.color);
      let group = colorGroups.get(key);
      if (!group) {
        group = [];
        colorGroups.set(key, group);
      }
      group.push(meshData);
    }

    // Create one fragment batch per color group (with buffer limit splitting)
    for (const [, group] of colorGroups) {
      const chunks = this.splitMeshDataForBufferLimit(group, this.cachedMaxBufferSize);
      for (const chunk of chunks) {
        const color = chunk[0].color;
        const fragment = this.createBatchedMesh(chunk, color, device, pipeline);
        this.batchedMeshes.push(fragment);
        this.streamingFragments.push(fragment);
      }
    }
  }

  /**
   * Finalize streaming: destroy temporary fragment batches and do one full
   * O(N) merge of all accumulated mesh data into proper batches.
   * Call this when streaming completes instead of rebuildPendingBatches().
   */
  finalizeStreaming(device: GPUDevice, pipeline: RenderPipeline): void {
    if (this.streamingFragments.length === 0) return;

    // 1. Destroy all fragment GPU resources
    const fragmentSet = new Set(this.streamingFragments);
    for (const fragment of this.streamingFragments) {
      fragment.vertexBuffer.destroy();
      fragment.indexBuffer.destroy();
      if (fragment.uniformBuffer) {
        fragment.uniformBuffer.destroy();
      }
    }
    this.streamingFragments = [];

    // 2. Remove fragments from batchedMeshes, keep any pre-existing proper batches
    this.batchedMeshes = this.batchedMeshes.filter(b => !fragmentSet.has(b));

    // 3. Rebuild index map to match filtered array
    this.batchedMeshIndex.clear();
    for (let i = 0; i < this.batchedMeshes.length; i++) {
      this.batchedMeshIndex.set(this.batchedMeshes[i].colorKey, i);
    }

    // 4. Mark all non-empty accumulated buckets as pending for one full merge
    for (const [key, data] of this.batchedMeshData) {
      if (data.length > 0) {
        this.pendingBatchKeys.add(key);
      }
    }

    // 5. One O(N) full rebuild
    this.rebuildPendingBatches(device, pipeline);
  }

  /**
   * Update colors for existing meshes and rebuild affected batches
   * Call this when deferred color parsing completes
   *
   * OPTIMIZATION: Uses meshDataBatchKey reverse-map for O(1) batch removal
   * instead of O(N) indexOf scan per mesh. Critical for bulk IDS validation updates.
   */
  updateMeshColors(
    updates: Map<number, [number, number, number, number]>,
    device: GPUDevice,
    pipeline: RenderPipeline
  ): void {
    if (updates.size === 0) return;

    // Cache max buffer size if not yet set
    if (this.cachedMaxBufferSize === 0) {
      this.cachedMaxBufferSize = this.getMaxBufferSize(device);
    }

    const affectedOldKeys = new Set<string>();
    const affectedNewKeys = new Set<string>();

    // Update colors in meshDataMap and track affected batches
    for (const [expressId, newColor] of updates) {
      const meshDataList = this.meshDataMap.get(expressId);
      if (!meshDataList) continue;

      const newBaseKey = this.colorKey(newColor);

      for (const meshData of meshDataList) {
        // Use reverse-map for O(1) old bucket key lookup
        const oldBucketKey = this.meshDataBatchKey.get(meshData) ?? this.colorKey(meshData.color);
        // Compare base color keys (ignore bucket suffix) to detect actual color changes
        const oldBaseKey = this.colorKey(meshData.color);

        if (oldBaseKey !== newBaseKey) {
          // Route into the correct (possibly new) bucket for the target color
          const newBucketKey = this.resolveActiveBucket(newBaseKey, meshData);

          affectedOldKeys.add(oldBucketKey);
          affectedNewKeys.add(newBucketKey);

          // Remove from old bucket data using swap-remove for O(1)
          const oldBatchData = this.batchedMeshData.get(oldBucketKey);
          if (oldBatchData) {
            const idx = oldBatchData.indexOf(meshData);
            if (idx >= 0) {
              // Swap with last element and pop — O(1) instead of O(N) splice
              const last = oldBatchData.length - 1;
              if (idx !== last) {
                oldBatchData[idx] = oldBatchData[last];
              }
              oldBatchData.pop();
            }
            if (oldBatchData.length === 0) {
              this.batchedMeshData.delete(oldBucketKey);
            }
          }

          // Decrease old bucket size tracking
          const meshBytes = (meshData.positions.length / 3) * BATCH_CONSTANTS.BYTES_PER_VERTEX;
          const oldSize = this.bucketVertexBytes.get(oldBucketKey) ?? 0;
          this.bucketVertexBytes.set(oldBucketKey, Math.max(0, oldSize - meshBytes));

          // Update mesh color
          meshData.color = newColor;

          // Add to new bucket data (resolveActiveBucket already updated size tracking)
          let newBucket = this.batchedMeshData.get(newBucketKey);
          if (!newBucket) {
            newBucket = [];
            this.batchedMeshData.set(newBucketKey, newBucket);
          }
          newBucket.push(meshData);

          // Update reverse mapping
          this.meshDataBatchKey.set(meshData, newBucketKey);
        }
      }
    }

    // Mark affected batches for rebuild
    for (const key of affectedOldKeys) {
      this.pendingBatchKeys.add(key);
    }
    for (const key of affectedNewKeys) {
      this.pendingBatchKeys.add(key);
    }

    // Rebuild affected batches (rebuildPendingBatches handles empty-bucket
    // cleanup and O(1) flat-array updates internally)
    if (this.pendingBatchKeys.size > 0) {
      this.rebuildPendingBatches(device, pipeline);
    }
  }

  /**
   * Create a new batched mesh from mesh data array.
   * @param bucketKey - Optional unique key for this batch. When omitted the
   *   base color key is used (fine for overlay / partial batches that don't
   *   participate in the main batchedMeshMap).
   */
  private createBatchedMesh(
    meshDataArray: MeshData[],
    color: [number, number, number, number],
    device: GPUDevice,
    pipeline: RenderPipeline,
    bucketKey?: string
  ): BatchedMesh {
    const merged = this.mergeGeometry(meshDataArray);
    const expressIds = meshDataArray.map(m => m.expressId);

    // Create vertex buffer (interleaved positions + normals)
    const vertexBuffer = device.createBuffer({
      size: merged.vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, merged.vertexData);

    // Create index buffer
    const indexBuffer = device.createBuffer({
      size: merged.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, merged.indices);

    // Create uniform buffer for this batch
    const uniformBuffer = device.createBuffer({
      size: pipeline.getUniformBufferSize(),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(),
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer },
        },
      ],
    });

    return {
      colorKey: bucketKey ?? this.colorKey(color),
      vertexBuffer,
      indexBuffer,
      indexCount: merged.indices.length,
      color,
      expressIds,
      bindGroup,
      uniformBuffer,
    };
  }


  /**
   * Merge multiple mesh geometries into single vertex/index buffers
   *
   * OPTIMIZATION: Uses efficient loops and bulk index adjustment
   */
  private mergeGeometry(meshDataArray: MeshData[]): {
    vertexData: Float32Array;
    indices: Uint32Array;
  } {
    let totalVertices = 0;
    let totalIndices = 0;

    // Calculate total sizes
    for (const mesh of meshDataArray) {
      totalVertices += mesh.positions.length / 3;
      totalIndices += mesh.indices.length;
    }

    // Create merged buffers
    const vertexBufferRaw = new ArrayBuffer(totalVertices * 7 * 4);
    const vertexData = new Float32Array(vertexBufferRaw); // position + normal
    const vertexDataU32 = new Uint32Array(vertexBufferRaw); // entityId lane
    const indices = new Uint32Array(totalIndices);

    let indexOffset = 0;
    let vertexBase = 0;

    for (const mesh of meshDataArray) {
      const positions = mesh.positions;
      const normals = mesh.normals;
      const vertexCount = positions.length / 3;

      // Interleave vertex data (position + normal)
      // This loop is O(n) per mesh and unavoidable for interleaving
      let outIdx = vertexBase * 7;
      let entityId = mesh.expressId >>> 0;
      if (entityId > MAX_ENCODED_ENTITY_ID) {
        if (!warnedEntityIdRange) {
          warnedEntityIdRange = true;
          console.warn('[Renderer] expressId exceeds 24-bit seam-ID encoding range; seam lines may collide.');
        }
        entityId = entityId & MAX_ENCODED_ENTITY_ID;
      }
      for (let i = 0; i < vertexCount; i++) {
        const srcIdx = i * 3;
        vertexData[outIdx++] = positions[srcIdx];
        vertexData[outIdx++] = positions[srcIdx + 1];
        vertexData[outIdx++] = positions[srcIdx + 2];
        vertexData[outIdx++] = normals[srcIdx];
        vertexData[outIdx++] = normals[srcIdx + 1];
        vertexData[outIdx++] = normals[srcIdx + 2];
        vertexDataU32[outIdx++] = entityId;
      }

      // Copy indices with vertex base offset
      // Use subarray for slightly better cache locality
      const meshIndices = mesh.indices;
      const indexCount = meshIndices.length;
      for (let i = 0; i < indexCount; i++) {
        indices[indexOffset + i] = meshIndices[i] + vertexBase;
      }

      vertexBase += vertexCount;
      indexOffset += indexCount;
    }

    return { vertexData, indices };
  }

  /**
   * Get the effective max buffer size for this GPU device, with a safety margin.
   */
  private getMaxBufferSize(device: GPUDevice): number {
    const deviceMax = device.limits?.maxBufferSize ?? BATCH_CONSTANTS.FALLBACK_MAX_BUFFER_SIZE;
    return Math.floor(deviceMax * BATCH_CONSTANTS.BUFFER_SIZE_SAFETY_FACTOR);
  }

  /**
   * Split a meshDataArray into chunks where each chunk's largest buffer
   * (vertex or index) stays within maxBufferSize.
   *
   * Each mesh is kept intact — we never split a single element's geometry.
   * If a single mesh exceeds the limit on its own it is placed in a solo chunk
   * (WebGPU will clamp or error, but we don't silently drop geometry).
   */
  private splitMeshDataForBufferLimit(meshDataArray: MeshData[], maxBufferSize: number): MeshData[][] {
    // Fast path: estimate total size — if it fits, no splitting needed
    let totalVertexBytes = 0;
    let totalIndexBytes = 0;
    for (const mesh of meshDataArray) {
      totalVertexBytes += (mesh.positions.length / 3) * BATCH_CONSTANTS.BYTES_PER_VERTEX;
      totalIndexBytes += mesh.indices.length * BATCH_CONSTANTS.BYTES_PER_INDEX;
    }
    if (totalVertexBytes <= maxBufferSize && totalIndexBytes <= maxBufferSize) {
      return [meshDataArray];
    }

    // Slow path: partition into chunks
    const chunks: MeshData[][] = [];
    let currentChunk: MeshData[] = [];
    let currentVertexBytes = 0;
    let currentIndexBytes = 0;

    for (const mesh of meshDataArray) {
      const meshVertexBytes = (mesh.positions.length / 3) * BATCH_CONSTANTS.BYTES_PER_VERTEX;
      const meshIndexBytes = mesh.indices.length * BATCH_CONSTANTS.BYTES_PER_INDEX;

      // Would adding this mesh exceed the limit? Start a new chunk.
      // (Skip check when chunk is empty — a single mesh must always be included.)
      if (
        currentChunk.length > 0 &&
        (currentVertexBytes + meshVertexBytes > maxBufferSize ||
         currentIndexBytes + meshIndexBytes > maxBufferSize)
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentVertexBytes = 0;
        currentIndexBytes = 0;
      }

      currentChunk.push(mesh);
      currentVertexBytes += meshVertexBytes;
      currentIndexBytes += meshIndexBytes;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Resolve which bucket a mesh should be added to.
   * If the active bucket for this color would overflow the GPU buffer limit,
   * a new sub-bucket is created with a suffixed key (e.g. "500|500|500|1000#1").
   * Returns the bucket key to use (may be the base key or a suffixed key).
   */
  private resolveActiveBucket(baseColorKey: string, meshData: MeshData): string {
    let bucketKey = this.activeBucketKey.get(baseColorKey) ?? baseColorKey;
    const currentBytes = this.bucketVertexBytes.get(bucketKey) ?? 0;
    const meshBytes = (meshData.positions.length / 3) * BATCH_CONSTANTS.BYTES_PER_VERTEX;

    if (currentBytes > 0 && currentBytes + meshBytes > this.cachedMaxBufferSize) {
      // Overflow — create a new sub-bucket
      bucketKey = `${baseColorKey}#${this.nextSplitId++}`;
      this.activeBucketKey.set(baseColorKey, bucketKey);
    }

    // Update size tracking
    this.bucketVertexBytes.set(bucketKey, (this.bucketVertexBytes.get(bucketKey) ?? 0) + meshBytes);
    return bucketKey;
  }

  /**
   * Extract the base color key from a bucket key (strips "#N" suffix if present).
   */
  private baseColorKey(bucketKey: string): string {
    const hashIdx = bucketKey.lastIndexOf('#');
    return hashIdx >= 0 ? bucketKey.substring(0, hashIdx) : bucketKey;
  }

  /**
   * Get or create a partial batch for a subset of visible elements from a batch
   *
   * PERFORMANCE FIX: Instead of creating 10,000+ individual meshes for partially visible batches,
   * this creates a single sub-batch containing only the visible elements.
   * The sub-batch is cached and reused until visibility changes.
   *
   * @param colorKey - The color key of the original batch (unique per bucket, used as cache key)
   * @param visibleIds - Set of visible expressIds from this batch
   * @param device - GPU device for buffer creation
   * @param pipeline - Rendering pipeline
   * @returns BatchedMesh containing only visible elements, or undefined if no visible elements
   */
  getOrCreatePartialBatch(
    colorKey: string,
    visibleIds: Set<number>,
    device: GPUDevice,
    pipeline: RenderPipeline
  ): BatchedMesh | undefined {
    // Create cache key from colorKey + deterministic hash of all visible IDs
    // Using a proper hash over all IDs to avoid collisions when middle IDs differ
    const sortedIds = Array.from(visibleIds).sort((a, b) => a - b);

    // Compute a stable hash over all IDs using FNV-1a algorithm
    let hash = 2166136261; // FNV offset basis
    for (const id of sortedIds) {
      hash ^= id;
      hash = Math.imul(hash, 16777619); // FNV prime
      hash = hash >>> 0; // Convert to unsigned 32-bit
    }
    const idsHash = `${sortedIds.length}:${hash.toString(16)}`;
    const cacheKey = `${colorKey}:${idsHash}`;

    // Check if we already have this exact partial batch cached
    const currentCacheKey = this.partialBatchCacheKeys.get(colorKey);
    if (currentCacheKey === cacheKey) {
      const cached = this.partialBatchCache.get(cacheKey);
      if (cached) return cached;
    }

    // Invalidate old cache for this colorKey if visibility changed
    if (currentCacheKey && currentCacheKey !== cacheKey) {
      const oldBatch = this.partialBatchCache.get(currentCacheKey);
      if (oldBatch) {
        oldBatch.vertexBuffer.destroy();
        oldBatch.indexBuffer.destroy();
        if (oldBatch.uniformBuffer) {
          oldBatch.uniformBuffer.destroy();
        }
        this.partialBatchCache.delete(currentCacheKey);
      }
    }

    // Collect MeshData for visible elements
    // Use base color key (strip bucket suffix) for piece filtering, since
    // meshData stores the original color, not the bucket key.
    const baseKey = this.baseColorKey(colorKey);
    const visibleMeshData: MeshData[] = [];
    for (const expressId of visibleIds) {
      const pieces = this.meshDataMap.get(expressId);
      if (pieces) {
        // Add all pieces for this element
        for (const piece of pieces) {
          // Only include pieces that match this batch's color
          if (this.colorKey(piece.color) === baseKey) {
            visibleMeshData.push(piece);
          }
        }
      }
    }

    if (visibleMeshData.length === 0) {
      return undefined;
    }

    // Create the partial batch
    const color = visibleMeshData[0].color;
    const partialBatch = this.createBatchedMesh(visibleMeshData, color, device, pipeline);

    // Cache it
    this.partialBatchCache.set(cacheKey, partialBatch);
    this.partialBatchCacheKeys.set(colorKey, cacheKey);

    return partialBatch;
  }

  // ─── Color overlay system ────────────────────────────────────────────
  // Builds overlay batches for lens coloring without modifying original batches.
  // Overlay batches reuse the same geometry (re-merged from MeshData) but with
  // override colors.  They are rendered on top of existing depth via the overlay
  // pipeline (depthCompare 'equal'), so hidden entities never leak through.

  /**
   * Set color overrides for lens coloring.
   * Builds overlay batches grouped by override color.
   * Original batches are NEVER modified — clearing is instant.
   *
   * Applies the same buffer-size splitting as regular batches to prevent
   * GPU buffer overflow on large models.
   */
  setColorOverrides(
    overrides: Map<number, [number, number, number, number]>,
    device: GPUDevice,
    pipeline: RenderPipeline
  ): void {
    // Destroy previous overlay batches
    this.destroyOverrideBatches();

    if (overrides.size === 0) {
      this.colorOverrides = null;
      return;
    }

    this.colorOverrides = overrides;

    // Group expressIds by override color
    const colorGroups = new Map<string, { color: [number, number, number, number]; meshData: MeshData[] }>();

    for (const [expressId, color] of overrides) {
      const key = this.colorKey(color);
      let group = colorGroups.get(key);
      if (!group) {
        group = { color, meshData: [] };
        colorGroups.set(key, group);
      }
      const pieces = this.meshDataMap.get(expressId);
      if (pieces) {
        for (const piece of pieces) {
          group.meshData.push(piece);
        }
      }
    }

    // Build overlay batches per override color, splitting if buffers would exceed GPU limit
    const maxBufferSize = this.getMaxBufferSize(device);
    for (const [, { color, meshData }] of colorGroups) {
      if (meshData.length === 0) continue;
      const chunks = this.splitMeshDataForBufferLimit(meshData, maxBufferSize);
      for (const chunk of chunks) {
        const batch = this.createBatchedMesh(chunk, color, device, pipeline);
        this.overrideBatches.push(batch);
      }
    }
  }

  /**
   * Clear all color overrides — instant, no batch rebuild needed.
   */
  clearColorOverrides(): void {
    this.destroyOverrideBatches();
    this.colorOverrides = null;
  }

  /** Get overlay batches for rendering */
  getOverrideBatches(): BatchedMesh[] {
    return this.overrideBatches;
  }

  /** Check if color overrides are active */
  hasColorOverrides(): boolean {
    return this.overrideBatches.length > 0;
  }

  /** Destroy GPU resources for overlay batches */
  private destroyOverrideBatches(): void {
    for (const batch of this.overrideBatches) {
      batch.vertexBuffer.destroy();
      batch.indexBuffer.destroy();
      if (batch.uniformBuffer) {
        batch.uniformBuffer.destroy();
      }
    }
    this.overrideBatches = [];
  }

  /**
   * Clear regular meshes only (used when converting to instanced rendering)
   */
  clearRegularMeshes(): void {
    for (const mesh of this.meshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      // Destroy per-mesh uniform buffer if it exists
      if (mesh.uniformBuffer) {
        mesh.uniformBuffer.destroy();
      }
    }
    this.meshes = [];
  }

  /**
   * Clear scene
   */
  clear(): void {
    for (const mesh of this.meshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      // Destroy per-mesh uniform buffer if it exists
      if (mesh.uniformBuffer) {
        mesh.uniformBuffer.destroy();
      }
    }
    for (const mesh of this.instancedMeshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      mesh.instanceBuffer.destroy();
    }
    for (const batch of this.batchedMeshes) {
      batch.vertexBuffer.destroy();
      batch.indexBuffer.destroy();
      if (batch.uniformBuffer) {
        batch.uniformBuffer.destroy();
      }
    }
    // Clear partial batch cache
    for (const batch of this.partialBatchCache.values()) {
      batch.vertexBuffer.destroy();
      batch.indexBuffer.destroy();
      if (batch.uniformBuffer) {
        batch.uniformBuffer.destroy();
      }
    }
    // Destroy streaming fragments (already included in batchedMeshes, but tracked separately)
    this.streamingFragments = [];
    this.destroyOverrideBatches();
    this.colorOverrides = null;
    this.meshes = [];
    this.instancedMeshes = [];
    this.batchedMeshes = [];
    this.batchedMeshMap.clear();
    this.batchedMeshData.clear();
    this.batchedMeshIndex.clear();
    this.meshDataMap.clear();
    this.meshDataBatchKey.clear();
    this.boundingBoxes.clear();
    this.activeBucketKey.clear();
    this.bucketVertexBytes.clear();
    this.cachedMaxBufferSize = 0;
    this.pendingBatchKeys.clear();
    this.partialBatchCache.clear();
    this.partialBatchCacheKeys.clear();
  }

  /**
   * Calculate bounding box from actual mesh vertex data
   */
  getBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
    if (this.meshDataMap.size === 0) return null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasValidData = false;

    // Compute bounds from all mesh data
    for (const pieces of this.meshDataMap.values()) {
      for (const piece of pieces) {
        const positions = piece.positions;
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i];
          const y = positions[i + 1];
          const z = positions[i + 2];
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            hasValidData = true;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
        }
      }
    }

    if (!hasValidData) return null;

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }

  /**
   * Get all expressIds that have mesh data (for CPU raycasting)
   */
  getAllMeshDataExpressIds(): number[] {
    return Array.from(this.meshDataMap.keys());
  }

  /**
   * Get or compute bounding box for an entity from its mesh vertex data.
   * Results are cached per expressId for subsequent calls.
   * @param expressId - The expressId (globalId) to look up
   * @returns Bounding box with min/max corners, or null if no mesh data exists
   */
  getEntityBoundingBox(expressId: number): BoundingBox | null {
    // Check cache first
    const cached = this.boundingBoxes.get(expressId);
    if (cached) return cached;

    // Compute from mesh data
    const pieces = this.meshDataMap.get(expressId);
    if (!pieces || pieces.length === 0) return null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const piece of pieces) {
      const positions = piece.positions;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }

    const bbox: BoundingBox = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
    this.boundingBoxes.set(expressId, bbox);
    return bbox;
  }

  /**
   * Ray-box intersection test (slab method)
   */
  private rayIntersectsBox(
    rayOrigin: Vec3,
    rayDirInv: Vec3,  // 1/rayDir for efficiency
    rayDirSign: [number, number, number],
    box: BoundingBox
  ): boolean {
    const bounds = [box.min, box.max];

    let tmin = (bounds[rayDirSign[0]].x - rayOrigin.x) * rayDirInv.x;
    let tmax = (bounds[1 - rayDirSign[0]].x - rayOrigin.x) * rayDirInv.x;
    const tymin = (bounds[rayDirSign[1]].y - rayOrigin.y) * rayDirInv.y;
    const tymax = (bounds[1 - rayDirSign[1]].y - rayOrigin.y) * rayDirInv.y;

    if (tmin > tymax || tymin > tmax) return false;
    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;

    const tzmin = (bounds[rayDirSign[2]].z - rayOrigin.z) * rayDirInv.z;
    const tzmax = (bounds[1 - rayDirSign[2]].z - rayOrigin.z) * rayDirInv.z;

    if (tmin > tzmax || tzmin > tmax) return false;
    if (tzmin > tmin) tmin = tzmin;
    if (tzmax < tmax) tmax = tzmax;

    return tmax >= 0;
  }

  /**
   * Möller–Trumbore ray-triangle intersection
   * Returns distance to intersection or null if no hit
   */
  private rayTriangleIntersect(
    rayOrigin: Vec3,
    rayDir: Vec3,
    v0: Vec3,
    v1: Vec3,
    v2: Vec3
  ): number | null {
    const EPSILON = 1e-7;

    const edge1 = MathUtils.subtract(v1, v0);
    const edge2 = MathUtils.subtract(v2, v0);
    const h = MathUtils.cross(rayDir, edge2);
    const a = MathUtils.dot(edge1, h);

    if (a > -EPSILON && a < EPSILON) return null; // Ray parallel to triangle

    const f = 1.0 / a;
    const s = MathUtils.subtract(rayOrigin, v0);
    const u = f * MathUtils.dot(s, h);

    if (u < 0.0 || u > 1.0) return null;

    const q = MathUtils.cross(s, edge1);
    const v = f * MathUtils.dot(rayDir, q);

    if (v < 0.0 || u + v > 1.0) return null;

    const t = f * MathUtils.dot(edge2, q);

    if (t > EPSILON) return t; // Ray intersection
    return null;
  }

  /**
   * CPU raycast against all mesh data
   * Returns expressId and modelIndex of closest hit, or null
   * For multi-model support: tracks which model's geometry was hit
   */
  raycast(
    rayOrigin: Vec3,
    rayDir: Vec3,
    hiddenIds?: Set<number>,
    isolatedIds?: Set<number> | null
  ): { expressId: number; distance: number; modelIndex?: number } | null {
    // Precompute ray direction inverse and signs for box tests
    const rayDirInv: Vec3 = {
      x: rayDir.x !== 0 ? 1.0 / rayDir.x : Infinity,
      y: rayDir.y !== 0 ? 1.0 / rayDir.y : Infinity,
      z: rayDir.z !== 0 ? 1.0 / rayDir.z : Infinity,
    };
    const rayDirSign: [number, number, number] = [
      rayDirInv.x < 0 ? 1 : 0,
      rayDirInv.y < 0 ? 1 : 0,
      rayDirInv.z < 0 ? 1 : 0,
    ];

    let closestHit: { expressId: number; distance: number; modelIndex?: number } | null = null;
    let closestDistance = Infinity;

    // First pass: filter by bounding box (fast)
    const candidates: number[] = [];

    for (const expressId of this.meshDataMap.keys()) {
      // Skip hidden elements
      if (hiddenIds?.has(expressId)) continue;
      // Skip non-isolated elements if isolation is active
      if (isolatedIds !== null && isolatedIds !== undefined && !isolatedIds.has(expressId)) continue;

      const bbox = this.getEntityBoundingBox(expressId);
      if (!bbox) continue;

      if (this.rayIntersectsBox(rayOrigin, rayDirInv, rayDirSign, bbox)) {
        candidates.push(expressId);
      }
    }

    // Second pass: test triangles for candidates (accurate)
    for (const expressId of candidates) {
      const pieces = this.meshDataMap.get(expressId);
      if (!pieces) continue;

      for (const piece of pieces) {
        const positions = piece.positions;
        const indices = piece.indices;

        // Test each triangle
        for (let i = 0; i < indices.length; i += 3) {
          const i0 = indices[i] * 3;
          const i1 = indices[i + 1] * 3;
          const i2 = indices[i + 2] * 3;

          const v0: Vec3 = { x: positions[i0], y: positions[i0 + 1], z: positions[i0 + 2] };
          const v1: Vec3 = { x: positions[i1], y: positions[i1 + 1], z: positions[i1 + 2] };
          const v2: Vec3 = { x: positions[i2], y: positions[i2 + 1], z: positions[i2 + 2] };

          const t = this.rayTriangleIntersect(rayOrigin, rayDir, v0, v1, v2);
          if (t !== null && t < closestDistance) {
            closestDistance = t;
            // Track modelIndex from the piece that was actually hit
            closestHit = { expressId, distance: t, modelIndex: piece.modelIndex };
          }
        }
      }
    }

    return closestHit;
  }
}

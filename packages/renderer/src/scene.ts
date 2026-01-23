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

interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export class Scene {
  private meshes: Mesh[] = [];
  private instancedMeshes: InstancedMesh[] = [];
  private batchedMeshes: BatchedMesh[] = [];
  private batchedMeshMap: Map<string, BatchedMesh> = new Map(); // Map colorKey -> BatchedMesh
  private batchedMeshData: Map<string, MeshData[]> = new Map(); // Map colorKey -> accumulated MeshData[]
  private meshDataMap: Map<number, MeshData[]> = new Map(); // Map expressId -> MeshData[] (for lazy buffer creation, accumulates multiple pieces)
  private boundingBoxes: Map<number, BoundingBox> = new Map(); // Map expressId -> bounding box (computed lazily)

  // Sub-batch cache for partially visible batches (PERFORMANCE FIX)
  // Key = colorKey + ":" + sorted visible expressIds hash
  // This allows rendering partially visible batches as single draw calls instead of 10,000+ individual draws
  private partialBatchCache: Map<string, BatchedMesh> = new Map();
  private partialBatchCacheKeys: Map<string, string> = new Map(); // colorKey -> current cache key (for invalidation)

  // Streaming optimization: track pending batch rebuilds
  private pendingBatchKeys: Set<string> = new Set();
  private lastBatchRebuildTime: number = 0;
  private batchRebuildThrottleMs: number = 100; // Rebuild batches at most every 100ms during streaming

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
   * Get all MeshData pieces for an expressId (without merging)
   */
  getMeshDataPieces(expressId: number): MeshData[] | undefined {
    return this.meshDataMap.get(expressId);
  }

  /**
   * Generate color key for grouping meshes
   */
  private colorKey(color: [number, number, number, number]): string {
    // Round to 3 decimal places to group similar colors
    const r = Math.round(color[0] * 1000) / 1000;
    const g = Math.round(color[1] * 1000) / 1000;
    const b = Math.round(color[2] * 1000) / 1000;
    const a = Math.round(color[3] * 1000) / 1000;
    return `${r},${g},${b},${a}`;
  }

  /**
   * Append meshes to color batches incrementally
   * Merges new meshes into existing color groups or creates new ones
   *
   * OPTIMIZATION: Throttles batch rebuilding during streaming to avoid O(N²) cost
   * - Mesh data is accumulated immediately (fast)
   * - GPU buffers are rebuilt at most every batchRebuildThrottleMs (expensive)
   */
  appendToBatches(meshDataArray: MeshData[], device: GPUDevice, pipeline: RenderPipeline, isStreaming: boolean = false): void {
    // Track which color keys received new data in THIS call
    for (const meshData of meshDataArray) {
      const key = this.colorKey(meshData.color);

      // Accumulate mesh data for this color
      if (!this.batchedMeshData.has(key)) {
        this.batchedMeshData.set(key, []);
      }
      this.batchedMeshData.get(key)!.push(meshData);
      this.pendingBatchKeys.add(key);

      // Also store individual mesh data for visibility filtering
      // This allows individual meshes to be created lazily when needed
      this.addMeshData(meshData);
    }

    // During streaming, throttle batch rebuilding to reduce O(N²) cost
    // This allows mesh data to accumulate before expensive buffer recreation
    const now = performance.now();
    const timeSinceLastRebuild = now - this.lastBatchRebuildTime;

    if (isStreaming && timeSinceLastRebuild < this.batchRebuildThrottleMs) {
      // Skip rebuild - data is accumulated, will be rebuilt later
      return;
    }

    // Rebuild pending batches
    this.rebuildPendingBatches(device, pipeline);
  }

  /**
   * Rebuild all pending batches (call this after streaming completes)
   */
  rebuildPendingBatches(device: GPUDevice, pipeline: RenderPipeline): void {
    if (this.pendingBatchKeys.size === 0) return;

    for (const key of this.pendingBatchKeys) {
      const meshDataForKey = this.batchedMeshData.get(key);
      if (!meshDataForKey || meshDataForKey.length === 0) continue;

      const existingBatch = this.batchedMeshMap.get(key);

      if (existingBatch) {
        // Destroy old batch buffers
        existingBatch.vertexBuffer.destroy();
        existingBatch.indexBuffer.destroy();
        if (existingBatch.uniformBuffer) {
          existingBatch.uniformBuffer.destroy();
        }
      }

      // Create new batch with all accumulated meshes for this color
      const color = meshDataForKey[0].color;
      const batchedMesh = this.createBatchedMesh(meshDataForKey, color, device, pipeline);
      this.batchedMeshMap.set(key, batchedMesh);

      // Update array if batch already exists, otherwise add new
      const index = this.batchedMeshes.findIndex(b => b.colorKey === key);
      if (index >= 0) {
        this.batchedMeshes[index] = batchedMesh;
      } else {
        this.batchedMeshes.push(batchedMesh);
      }
    }

    this.pendingBatchKeys.clear();
    this.lastBatchRebuildTime = performance.now();
  }

  /**
   * Check if there are pending batch rebuilds
   */
  hasPendingBatches(): boolean {
    return this.pendingBatchKeys.size > 0;
  }

  /**
   * Update colors for existing meshes and rebuild affected batches
   * Call this when deferred color parsing completes
   */
  updateMeshColors(
    updates: Map<number, [number, number, number, number]>,
    device: GPUDevice,
    pipeline: RenderPipeline
  ): void {
    if (updates.size === 0) return;

    const affectedOldKeys = new Set<string>();
    const affectedNewKeys = new Set<string>();

    // Update colors in meshDataMap and track affected batches
    for (const [expressId, newColor] of updates) {
      const meshDataList = this.meshDataMap.get(expressId);
      if (!meshDataList) continue;

      for (const meshData of meshDataList) {
        const oldKey = this.colorKey(meshData.color);
        const newKey = this.colorKey(newColor);

        if (oldKey !== newKey) {
          affectedOldKeys.add(oldKey);
          affectedNewKeys.add(newKey);

          // Remove from old color batch data
          const oldBatchData = this.batchedMeshData.get(oldKey);
          if (oldBatchData) {
            const idx = oldBatchData.indexOf(meshData);
            if (idx >= 0) {
              oldBatchData.splice(idx, 1);
            }
            // Clean up empty batch data
            if (oldBatchData.length === 0) {
              this.batchedMeshData.delete(oldKey);
            }
          }

          // Update mesh color
          meshData.color = newColor;

          // Add to new color batch data
          if (!this.batchedMeshData.has(newKey)) {
            this.batchedMeshData.set(newKey, []);
          }
          this.batchedMeshData.get(newKey)!.push(meshData);
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

    // Rebuild affected batches
    if (this.pendingBatchKeys.size > 0) {
      this.rebuildPendingBatches(device, pipeline);
      
      // Remove empty batches
      for (const key of affectedOldKeys) {
        const batchData = this.batchedMeshData.get(key);
        if (!batchData || batchData.length === 0) {
          const batch = this.batchedMeshMap.get(key);
          if (batch) {
            batch.vertexBuffer.destroy();
            batch.indexBuffer.destroy();
            if (batch.uniformBuffer) {
              batch.uniformBuffer.destroy();
            }
            this.batchedMeshMap.delete(key);
            const idx = this.batchedMeshes.findIndex(b => b.colorKey === key);
            if (idx >= 0) {
              this.batchedMeshes.splice(idx, 1);
            }
          }
        }
      }
    }
  }

  /**
   * Create a new batched mesh from mesh data array
   */
  private createBatchedMesh(
    meshDataArray: MeshData[],
    color: [number, number, number, number],
    device: GPUDevice,
    pipeline: RenderPipeline
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
      colorKey: this.colorKey(color),
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
    const vertexData = new Float32Array(totalVertices * 6); // 6 floats per vertex (pos + normal)
    const indices = new Uint32Array(totalIndices);

    let indexOffset = 0;
    let vertexBase = 0;

    for (const mesh of meshDataArray) {
      const positions = mesh.positions;
      const normals = mesh.normals;
      const vertexCount = positions.length / 3;

      // Interleave vertex data (position + normal)
      // This loop is O(n) per mesh and unavoidable for interleaving
      let outIdx = vertexBase * 6;
      for (let i = 0; i < vertexCount; i++) {
        const srcIdx = i * 3;
        vertexData[outIdx++] = positions[srcIdx];
        vertexData[outIdx++] = positions[srcIdx + 1];
        vertexData[outIdx++] = positions[srcIdx + 2];
        vertexData[outIdx++] = normals[srcIdx];
        vertexData[outIdx++] = normals[srcIdx + 1];
        vertexData[outIdx++] = normals[srcIdx + 2];
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
   * Get or create a partial batch for a subset of visible elements from a batch
   *
   * PERFORMANCE FIX: Instead of creating 10,000+ individual meshes for partially visible batches,
   * this creates a single sub-batch containing only the visible elements.
   * The sub-batch is cached and reused until visibility changes.
   *
   * @param colorKey - The color key of the original batch
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
    const visibleMeshData: MeshData[] = [];
    for (const expressId of visibleIds) {
      const pieces = this.meshDataMap.get(expressId);
      if (pieces) {
        // Add all pieces for this element
        for (const piece of pieces) {
          // Only include pieces that match this batch's color
          if (this.colorKey(piece.color) === colorKey) {
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
    this.meshes = [];
    this.instancedMeshes = [];
    this.batchedMeshes = [];
    this.batchedMeshMap.clear();
    this.batchedMeshData.clear();
    this.meshDataMap.clear();
    this.boundingBoxes.clear();
    this.pendingBatchKeys.clear();
    this.partialBatchCache.clear();
    this.partialBatchCacheKeys.clear();
    this.lastBatchRebuildTime = 0;
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
   * Get or compute bounding box for a mesh
   */
  private getBoundingBox(expressId: number): BoundingBox | null {
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

      const bbox = this.getBoundingBox(expressId);
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

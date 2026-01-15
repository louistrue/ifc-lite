/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Scene graph and mesh management
 */

import type { Mesh, InstancedMesh, BatchedMesh } from './types.js';
import type { MeshData } from '@ifc-lite/geometry';

export class Scene {
  private meshes: Mesh[] = [];
  private instancedMeshes: InstancedMesh[] = [];
  private batchedMeshes: BatchedMesh[] = [];
  private batchedMeshMap: Map<string, BatchedMesh> = new Map(); // Map colorKey -> BatchedMesh
  private batchedMeshData: Map<string, MeshData[]> = new Map(); // Map colorKey -> accumulated MeshData[]
  private meshDataMap: Map<number, MeshData[]> = new Map(); // Map expressId -> MeshData[] (for lazy buffer creation, accumulates multiple pieces)

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
   * Returns merged MeshData if element has multiple pieces
   */
  getMeshData(expressId: number): MeshData | undefined {
    const pieces = this.meshDataMap.get(expressId);
    if (!pieces || pieces.length === 0) return undefined;
    if (pieces.length === 1) return pieces[0];

    // Merge multiple pieces into one MeshData
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

    // Return merged MeshData (use first piece's metadata)
    return {
      expressId,
      positions: mergedPositions,
      normals: mergedNormals,
      indices: mergedIndices,
      color: pieces[0].color,
      ifcType: pieces[0].ifcType,
    };
  }

  /**
   * Check if MeshData exists for an expressId
   */
  hasMeshData(expressId: number): boolean {
    return this.meshDataMap.has(expressId);
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
   * OPTIMIZATION: Only recreates batches that received new data (O(n) not O(n²))
   */
  appendToBatches(meshDataArray: MeshData[], device: GPUDevice, pipeline: any): void {
    // Track which color keys received new data in THIS call
    const changedKeys = new Set<string>();

    for (const meshData of meshDataArray) {
      const key = this.colorKey(meshData.color);

      // Accumulate mesh data for this color
      if (!this.batchedMeshData.has(key)) {
        this.batchedMeshData.set(key, []);
      }
      this.batchedMeshData.get(key)!.push(meshData);
      changedKeys.add(key);

      // Also store individual mesh data for visibility filtering
      // This allows individual meshes to be created lazily when needed
      this.addMeshData(meshData);
    }

    // Only recreate batches for colors that received new data
    // This is O(changedKeys) instead of O(allBatches) - critical for streaming!
    for (const key of changedKeys) {
      const meshDataForKey = this.batchedMeshData.get(key)!;
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
  }

  /**
   * Create a new batched mesh from mesh data array
   */
  private createBatchedMesh(
    meshDataArray: MeshData[],
    color: [number, number, number, number],
    device: GPUDevice,
    pipeline: any
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
    this.meshes = [];
    this.instancedMeshes = [];
    this.batchedMeshes = [];
    this.batchedMeshMap.clear();
    this.batchedMeshData.clear();
    this.meshDataMap.clear();
  }

  /**
   * Calculate bounding box
   */
  getBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
    if (this.meshes.length === 0) return null;

    // For MVP, return a simple bounding box
    // In production, this would compute from actual vertex data
    return {
      min: { x: -10, y: -10, z: -10 },
      max: { x: 10, y: 10, z: 10 },
    };
  }
}

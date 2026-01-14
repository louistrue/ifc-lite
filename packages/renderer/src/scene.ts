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
  private meshDataMap: Map<number, MeshData> = new Map(); // Map expressId -> MeshData (for lazy buffer creation)

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
   */
  addMeshData(meshData: MeshData): void {
    this.meshDataMap.set(meshData.expressId, meshData);
  }

  /**
   * Get MeshData by expressId (for lazy buffer creation)
   */
  getMeshData(expressId: number): MeshData | undefined {
    return this.meshDataMap.get(expressId);
  }

  /**
   * Check if MeshData exists for an expressId
   */
  hasMeshData(expressId: number): boolean {
    return this.meshDataMap.has(expressId);
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
   */
  appendToBatches(meshDataArray: MeshData[], device: GPUDevice, pipeline: any): void {
    for (const meshData of meshDataArray) {
      const key = this.colorKey(meshData.color);

      // Accumulate mesh data for this color
      if (!this.batchedMeshData.has(key)) {
        this.batchedMeshData.set(key, []);
      }
      this.batchedMeshData.get(key)!.push(meshData);
    }

    // Recreate batches for all colors that have new data
    // This ensures geometry is properly merged
    for (const [key, meshDataArray] of this.batchedMeshData) {
      const existingBatch = this.batchedMeshMap.get(key);

      if (existingBatch) {
        // Destroy old batch buffers
        existingBatch.vertexBuffer.destroy();
        existingBatch.indexBuffer.destroy();
        if (existingBatch.uniformBuffer) {
          existingBatch.uniformBuffer.destroy();
        }
      }

      // Create new batch with all accumulated meshes
      const color = meshDataArray[0].color;
      const batchedMesh = this.createBatchedMesh(meshDataArray, color, device, pipeline);
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

    let vertexOffset = 0;
    let indexOffset = 0;
    let vertexBase = 0;

    for (const mesh of meshDataArray) {
      const vertexCount = mesh.positions.length / 3;

      // Copy interleaved vertex data (position + normal)
      for (let i = 0; i < vertexCount; i++) {
        const base = (vertexBase + i) * 6;
        const posBase = i * 3;
        const normBase = i * 3;

        vertexData[base + 0] = mesh.positions[posBase + 0];
        vertexData[base + 1] = mesh.positions[posBase + 1];
        vertexData[base + 2] = mesh.positions[posBase + 2];
        vertexData[base + 3] = mesh.normals[normBase + 0];
        vertexData[base + 4] = mesh.normals[normBase + 1];
        vertexData[base + 5] = mesh.normals[normBase + 2];
      }

      // Copy indices with offset
      for (let i = 0; i < mesh.indices.length; i++) {
        indices[indexOffset + i] = mesh.indices[i] + vertexBase;
      }

      vertexBase += vertexCount;
      indexOffset += mesh.indices.length;
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

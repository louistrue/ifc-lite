/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Blob-backed storage for mesh normal data.
 *
 * After GPU upload, mesh normals can be moved to a Blob which lives in the
 * Blink heap (NOT counted by performance.memory.usedJSHeapSize). This frees
 * ~600-700MB of V8 heap for large models (208K meshes).
 *
 * Positions and indices are kept in memory (needed for sync raycasting and
 * snap detection). Only normals are offloaded since they're exclusively
 * needed for batch rebuilds on color change.
 *
 * Normals are read back from the Blob asynchronously when batch rebuilds
 * require them. Reads use Blob.slice() for efficient range access.
 */

import type { MeshData } from '@ifc-lite/geometry';

/** Batch size for incremental offloading — avoids 2× peak memory */
const OFFLOAD_BATCH_SIZE = 2000;

export class MeshBlobStore {
  private blob: Blob | null = null;
  private totalBytes = 0;

  /**
   * Offload mesh normals to Blob storage.
   * Processes meshes in batches to avoid 2× peak memory.
   *
   * After this call, each MeshData has:
   * - normals replaced with empty Float32Array
   * - _vertexCount, _indexCount, _bounds, _blobOffset, _blobSize set
   * - _offloaded = true
   *
   * Positions and indices are preserved for sync operations.
   */
  offload(allMeshData: MeshData[]): void {
    if (allMeshData.length === 0) return;

    const blobParts: BlobPart[] = [];
    let offset = 0;

    for (let batchStart = 0; batchStart < allMeshData.length; batchStart += OFFLOAD_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + OFFLOAD_BATCH_SIZE, allMeshData.length);

      for (let i = batchStart; i < batchEnd; i++) {
        const mesh = allMeshData[i];
        if (mesh._offloaded) continue;

        const positions = mesh.positions;
        const normals = mesh.normals;
        const indices = mesh.indices;
        const vertexCount = positions.length / 3;
        const indexCount = indices.length;

        // Compute bounds
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let v = 0; v < positions.length; v += 3) {
          const x = positions[v], y = positions[v + 1], z = positions[v + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        // Store metadata
        mesh._vertexCount = vertexCount;
        mesh._indexCount = indexCount;
        mesh._bounds = {
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
        };

        // Store normals in Blob — copy to a plain ArrayBuffer for Blob compatibility
        const norBytes = new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength).slice().buffer;

        mesh._blobOffset = offset;
        mesh._blobSize = normals.byteLength;

        blobParts.push(norBytes);
        offset += normals.byteLength;

        // Free only normals from V8 heap — keep positions/indices for raycasting
        mesh.normals = new Float32Array(0);
        mesh._offloaded = true;
      }
    }

    this.blob = new Blob(blobParts);
    this.totalBytes = offset;
  }

  /**
   * Read back normals for a single mesh from the Blob.
   * Positions and indices are returned from the MeshData (still in memory).
   */
  async readMesh(mesh: MeshData): Promise<{ positions: Float32Array; normals: Float32Array; indices: Uint32Array }> {
    if (!mesh._offloaded || !this.blob || mesh._blobOffset === undefined || mesh._blobSize === undefined) {
      return { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices };
    }

    const vertexCount = mesh._vertexCount!;
    const slice = this.blob.slice(mesh._blobOffset, mesh._blobOffset + mesh._blobSize);
    const buf = await slice.arrayBuffer();
    const normals = new Float32Array(buf, 0, vertexCount * 3);

    return {
      positions: mesh.positions,
      normals,
      indices: mesh.indices,
    };
  }

  /**
   * Read back normals for multiple meshes in one batch read.
   * More efficient than individual reads when many meshes are needed.
   */
  async readMeshBatch(meshes: MeshData[]): Promise<Map<MeshData, { positions: Float32Array; normals: Float32Array; indices: Uint32Array }>> {
    const result = new Map<MeshData, { positions: Float32Array; normals: Float32Array; indices: Uint32Array }>();

    if (!this.blob) {
      for (const mesh of meshes) {
        result.set(mesh, { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices });
      }
      return result;
    }

    // Find contiguous range that covers all offloaded meshes
    let minOffset = Infinity;
    let maxEnd = 0;
    const offloadedMeshes: MeshData[] = [];

    for (const mesh of meshes) {
      if (!mesh._offloaded || mesh._blobOffset === undefined || mesh._blobSize === undefined) {
        result.set(mesh, { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices });
        continue;
      }
      offloadedMeshes.push(mesh);
      if (mesh._blobOffset < minOffset) minOffset = mesh._blobOffset;
      const end = mesh._blobOffset + mesh._blobSize;
      if (end > maxEnd) maxEnd = end;
    }

    if (offloadedMeshes.length === 0) return result;

    // Read the covering range
    const slice = this.blob.slice(minOffset, maxEnd);
    const buf = await slice.arrayBuffer();

    for (const mesh of offloadedMeshes) {
      const localOffset = mesh._blobOffset! - minOffset;
      const vertexCount = mesh._vertexCount!;

      result.set(mesh, {
        positions: mesh.positions,
        normals: new Float32Array(buf, localOffset, vertexCount * 3),
        indices: mesh.indices,
      });
    }

    return result;
  }

  get size(): number {
    return this.totalBytes;
  }

  dispose(): void {
    this.blob = null;
    this.totalBytes = 0;
  }
}

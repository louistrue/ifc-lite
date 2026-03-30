/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { HugeGeometryChunk, HugeGeometryElementRow, MeshData } from './types.js';

const DEFAULT_TARGET_CHUNK_BYTES = 24 * 1024 * 1024;
const FLOATS_PER_VERTEX = 7;
const MAX_ENCODED_ENTITY_ID = 0xFFFFFF;

type ChunkMeshGroup = {
  color: [number, number, number, number];
  meshes: MeshData[];
  estimatedBytes: number;
};

function colorKey(color: [number, number, number, number]): string {
  return `${color[0]},${color[1]},${color[2]},${color[3]}`;
}

function estimateMeshBytes(mesh: MeshData): number {
  const vertexCount = mesh.positions.length / 3;
  return (vertexCount * FLOATS_PER_VERTEX * 4) + (mesh.indices.length * 4);
}

function computeMeshBounds(mesh: MeshData): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }

  return { min, max };
}

function buildChunk(
  batchId: number,
  color: [number, number, number, number],
  meshes: MeshData[],
): HugeGeometryChunk {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const mesh of meshes) {
    totalVertices += mesh.positions.length / 3;
    totalIndices += mesh.indices.length;
  }

  const vertexBufferRaw = new ArrayBuffer(totalVertices * FLOATS_PER_VERTEX * 4);
  const vertexData = new Float32Array(vertexBufferRaw);
  const vertexDataU32 = new Uint32Array(vertexBufferRaw);
  const indexData = new Uint32Array(totalIndices);
  const elements: HugeGeometryElementRow[] = [];

  const chunkBoundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const chunkBoundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  let vertexBase = 0;
  let indexBase = 0;
  let warnedAboutEntityRange = false;

  for (const mesh of meshes) {
    const vertexCount = mesh.positions.length / 3;
    const indexCount = mesh.indices.length;
    const entityIdRaw = mesh.expressId >>> 0;
    let entityId = entityIdRaw;
    if (entityId > MAX_ENCODED_ENTITY_ID) {
      if (!warnedAboutEntityRange) {
        console.warn('[Geometry] expressId exceeds 24-bit seam-ID encoding range; seam lines may collide.');
        warnedAboutEntityRange = true;
      }
      entityId = entityId & MAX_ENCODED_ENTITY_ID;
    }

    const { min, max } = computeMeshBounds(mesh);
    if (min[0] < chunkBoundsMin[0]) chunkBoundsMin[0] = min[0];
    if (min[1] < chunkBoundsMin[1]) chunkBoundsMin[1] = min[1];
    if (min[2] < chunkBoundsMin[2]) chunkBoundsMin[2] = min[2];
    if (max[0] > chunkBoundsMax[0]) chunkBoundsMax[0] = max[0];
    if (max[1] > chunkBoundsMax[1]) chunkBoundsMax[1] = max[1];
    if (max[2] > chunkBoundsMax[2]) chunkBoundsMax[2] = max[2];

    let outIdx = vertexBase * FLOATS_PER_VERTEX;
    for (let i = 0; i < vertexCount; i++) {
      const srcIdx = i * 3;
      vertexData[outIdx++] = mesh.positions[srcIdx];
      vertexData[outIdx++] = mesh.positions[srcIdx + 1];
      vertexData[outIdx++] = mesh.positions[srcIdx + 2];
      vertexData[outIdx++] = mesh.normals[srcIdx];
      vertexData[outIdx++] = mesh.normals[srcIdx + 1];
      vertexData[outIdx++] = mesh.normals[srcIdx + 2];
      vertexDataU32[outIdx++] = entityId;
    }

    for (let i = 0; i < indexCount; i++) {
      indexData[indexBase + i] = mesh.indices[i] + vertexBase;
    }

    elements.push({
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      color: mesh.color,
      boundsMin: min,
      boundsMax: max,
      vertexOffset: vertexBase,
      vertexCount,
      indexOffset: indexBase,
      indexCount,
    });

    vertexBase += vertexCount;
    indexBase += indexCount;
  }

  return {
    batchId,
    color,
    modelIndex: meshes[0]?.modelIndex,
    vertexData,
    indexData,
    vertexStrideFloats: FLOATS_PER_VERTEX,
    indexCount: totalIndices,
    boundsMin: chunkBoundsMin,
    boundsMax: chunkBoundsMax,
    elements,
  };
}

export function buildHugeGeometryChunks(
  meshes: MeshData[],
  startingBatchId: number,
  targetChunkBytes: number = DEFAULT_TARGET_CHUNK_BYTES,
): { chunks: HugeGeometryChunk[]; nextBatchId: number } {
  const groups = new Map<string, ChunkMeshGroup>();

  for (const mesh of meshes) {
    const key = colorKey(mesh.color);
    const meshBytes = estimateMeshBytes(mesh);
    const existing = groups.get(key);

    if (!existing || (existing.estimatedBytes + meshBytes > targetChunkBytes && existing.meshes.length > 0)) {
      const uniqueKey = `${key}:${startingBatchId + groups.size}`;
      groups.set(uniqueKey, {
        color: mesh.color,
        meshes: [mesh],
        estimatedBytes: meshBytes,
      });
      continue;
    }

    existing.meshes.push(mesh);
    existing.estimatedBytes += meshBytes;
  }

  const chunks: HugeGeometryChunk[] = [];
  let batchId = startingBatchId;
  for (const group of groups.values()) {
    chunks.push(buildChunk(batchId++, group.color, group.meshes));
  }

  return { chunks, nextBatchId: batchId };
}

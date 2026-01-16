// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Parquet decoder for server geometry responses.
 *
 * Decodes the binary Parquet format from the server into MeshData[].
 * Uses parquet-wasm for efficient Parquet parsing in the browser.
 */

import type { MeshData } from './types';

/**
 * Decoded mesh metadata from Parquet.
 */
interface MeshMetadata {
  express_id: number;
  ifc_type: string;
  vertex_start: number;
  vertex_count: number;
  index_start: number;
  index_count: number;
  color_r: number;
  color_g: number;
  color_b: number;
  color_a: number;
}

/**
 * Decode a Parquet geometry response from the server.
 *
 * Binary format:
 * - [mesh_parquet_len:u32][mesh_parquet_data]
 * - [vertex_parquet_len:u32][vertex_parquet_data]
 * - [index_parquet_len:u32][index_parquet_data]
 *
 * @param data - Binary Parquet response from server
 * @returns Decoded MeshData array
 */
export async function decodeParquetGeometry(data: ArrayBuffer): Promise<MeshData[]> {
  // Dynamically import parquet-wasm
  // @ts-ignore - parquet-wasm types may not be available
  const parquet = await import('parquet-wasm');

  const view = new DataView(data);
  let offset = 0;

  // Read mesh Parquet section
  const meshParquetLen = view.getUint32(offset, true);
  offset += 4;
  const meshParquetData = new Uint8Array(data, offset, meshParquetLen);
  offset += meshParquetLen;

  // Read vertex Parquet section
  const vertexParquetLen = view.getUint32(offset, true);
  offset += 4;
  const vertexParquetData = new Uint8Array(data, offset, vertexParquetLen);
  offset += vertexParquetLen;

  // Read index Parquet section
  const indexParquetLen = view.getUint32(offset, true);
  offset += 4;
  const indexParquetData = new Uint8Array(data, offset, indexParquetLen);

  // Parse Parquet tables
  // @ts-ignore - parquet-wasm API
  const meshTable = parquet.readParquet(meshParquetData);
  // @ts-ignore - parquet-wasm API
  const vertexTable = parquet.readParquet(vertexParquetData);
  // @ts-ignore - parquet-wasm API
  const indexTable = parquet.readParquet(indexParquetData);

  // Convert to Arrow tables for easier access
  // @ts-ignore - Apache Arrow types
  const arrow = await import('apache-arrow');

  // @ts-ignore - parquet-wasm returns Arrow IPC stream
  const meshArrow = arrow.tableFromIPC(meshTable.intoIPCStream());
  // @ts-ignore
  const vertexArrow = arrow.tableFromIPC(vertexTable.intoIPCStream());
  // @ts-ignore
  const indexArrow = arrow.tableFromIPC(indexTable.intoIPCStream());

  // Extract columns from mesh table
  const expressIds = meshArrow.getChild('express_id')?.toArray() as Uint32Array;
  const ifcTypes = meshArrow.getChild('ifc_type');
  const vertexStarts = meshArrow.getChild('vertex_start')?.toArray() as Uint32Array;
  const vertexCounts = meshArrow.getChild('vertex_count')?.toArray() as Uint32Array;
  const indexStarts = meshArrow.getChild('index_start')?.toArray() as Uint32Array;
  const indexCounts = meshArrow.getChild('index_count')?.toArray() as Uint32Array;
  const colorR = meshArrow.getChild('color_r')?.toArray() as Float32Array;
  const colorG = meshArrow.getChild('color_g')?.toArray() as Float32Array;
  const colorB = meshArrow.getChild('color_b')?.toArray() as Float32Array;
  const colorA = meshArrow.getChild('color_a')?.toArray() as Float32Array;

  // Extract columns from vertex table
  const posX = vertexArrow.getChild('x')?.toArray() as Float32Array;
  const posY = vertexArrow.getChild('y')?.toArray() as Float32Array;
  const posZ = vertexArrow.getChild('z')?.toArray() as Float32Array;
  const normX = vertexArrow.getChild('nx')?.toArray() as Float32Array;
  const normY = vertexArrow.getChild('ny')?.toArray() as Float32Array;
  const normZ = vertexArrow.getChild('nz')?.toArray() as Float32Array;

  // Extract columns from index table
  const idx0 = indexArrow.getChild('i0')?.toArray() as Uint32Array;
  const idx1 = indexArrow.getChild('i1')?.toArray() as Uint32Array;
  const idx2 = indexArrow.getChild('i2')?.toArray() as Uint32Array;

  // Reconstruct MeshData array
  const meshCount = expressIds.length;
  const meshes: MeshData[] = new Array(meshCount);

  for (let i = 0; i < meshCount; i++) {
    const vertexStart = vertexStarts[i];
    const vertexCount = vertexCounts[i];
    const indexStart = indexStarts[i];
    const indexCount = indexCounts[i];

    // Reconstruct interleaved positions from columnar format
    const positions = new Array<number>(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      const srcIdx = vertexStart + v;
      positions[v * 3] = posX[srcIdx];
      positions[v * 3 + 1] = posY[srcIdx];
      positions[v * 3 + 2] = posZ[srcIdx];
    }

    // Reconstruct interleaved normals from columnar format
    const normals = new Array<number>(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      const srcIdx = vertexStart + v;
      normals[v * 3] = normX[srcIdx];
      normals[v * 3 + 1] = normY[srcIdx];
      normals[v * 3 + 2] = normZ[srcIdx];
    }

    // Reconstruct triangle indices from columnar format
    const triangleCount = indexCount / 3;
    const triangleStart = indexStart / 3;
    const indices = new Array<number>(indexCount);
    for (let t = 0; t < triangleCount; t++) {
      const srcIdx = triangleStart + t;
      indices[t * 3] = idx0[srcIdx];
      indices[t * 3 + 1] = idx1[srcIdx];
      indices[t * 3 + 2] = idx2[srcIdx];
    }

    meshes[i] = {
      express_id: expressIds[i],
      ifc_type: ifcTypes?.get(i) ?? 'Unknown',
      positions,
      normals,
      indices,
      color: [colorR[i], colorG[i], colorB[i], colorA[i]],
    };
  }

  return meshes;
}

/**
 * Check if parquet-wasm is available for import.
 *
 * @returns true if parquet-wasm can be imported
 */
export async function isParquetAvailable(): Promise<boolean> {
  try {
    // @ts-ignore - parquet-wasm types may not be available
    await import('parquet-wasm');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// OPTIMIZED FORMAT (ara3d BOS-compatible)
// ============================================================================

/**
 * Decode an optimized Parquet geometry response (ara3d BOS format).
 *
 * Binary format:
 * - [version:u8][flags:u8]
 * - [instance_len:u32][mesh_len:u32][material_len:u32][vertex_len:u32][index_len:u32]
 * - [instance_parquet][mesh_parquet][material_parquet][vertex_parquet][index_parquet]
 *
 * Key features:
 * - Integer quantized vertices (multiply by vertex_multiplier to get meters)
 * - Mesh instancing (deduplicated geometry)
 * - Byte colors (0-255)
 * - Optional normals (compute on client if not present)
 *
 * @param data - Binary optimized Parquet response from server
 * @param vertexMultiplier - Multiplier for vertex dequantization (default: 10000)
 * @returns Decoded MeshData array
 */
export async function decodeOptimizedParquetGeometry(
  data: ArrayBuffer,
  vertexMultiplier: number = 10000
): Promise<MeshData[]> {
  // @ts-ignore - parquet-wasm types may not be available
  const parquet = await import('parquet-wasm');
  // @ts-ignore - Apache Arrow types
  const arrow = await import('apache-arrow');

  const view = new DataView(data);
  let offset = 0;

  // Read header
  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 2) {
    throw new Error(`Unsupported optimized Parquet version: ${version}`);
  }

  const flags = view.getUint8(offset);
  offset += 1;
  const hasNormals = (flags & 1) !== 0;

  // Read table lengths
  const instanceLen = view.getUint32(offset, true);
  offset += 4;
  const meshLen = view.getUint32(offset, true);
  offset += 4;
  const materialLen = view.getUint32(offset, true);
  offset += 4;
  const vertexLen = view.getUint32(offset, true);
  offset += 4;
  const indexLen = view.getUint32(offset, true);
  offset += 4;

  // Read Parquet tables
  const instanceData = new Uint8Array(data, offset, instanceLen);
  offset += instanceLen;
  const meshData = new Uint8Array(data, offset, meshLen);
  offset += meshLen;
  const materialData = new Uint8Array(data, offset, materialLen);
  offset += materialLen;
  const vertexData = new Uint8Array(data, offset, vertexLen);
  offset += vertexLen;
  const indexData = new Uint8Array(data, offset, indexLen);

  // Parse Parquet tables
  // @ts-ignore
  const instanceTable = parquet.readParquet(instanceData);
  // @ts-ignore
  const meshTable = parquet.readParquet(meshData);
  // @ts-ignore
  const materialTable = parquet.readParquet(materialData);
  // @ts-ignore
  const vertexTable = parquet.readParquet(vertexData);
  // @ts-ignore
  const indexTable = parquet.readParquet(indexData);

  // Convert to Arrow
  // @ts-ignore
  const instanceArrow = arrow.tableFromIPC(instanceTable.intoIPCStream());
  // @ts-ignore
  const meshArrow = arrow.tableFromIPC(meshTable.intoIPCStream());
  // @ts-ignore
  const materialArrow = arrow.tableFromIPC(materialTable.intoIPCStream());
  // @ts-ignore
  const vertexArrow = arrow.tableFromIPC(vertexTable.intoIPCStream());
  // @ts-ignore
  const indexArrow = arrow.tableFromIPC(indexTable.intoIPCStream());

  // Extract instance columns
  const entityIds = instanceArrow.getChild('entity_id')?.toArray() as Uint32Array;
  const ifcTypes = instanceArrow.getChild('ifc_type');
  const meshIndices = instanceArrow.getChild('mesh_index')?.toArray() as Uint32Array;
  const materialIndices = instanceArrow.getChild('material_index')?.toArray() as Uint32Array;

  // Extract mesh columns
  const meshVertexOffsets = meshArrow.getChild('vertex_offset')?.toArray() as Uint32Array;
  const meshVertexCounts = meshArrow.getChild('vertex_count')?.toArray() as Uint32Array;
  const meshIndexOffsets = meshArrow.getChild('index_offset')?.toArray() as Uint32Array;
  const meshIndexCounts = meshArrow.getChild('index_count')?.toArray() as Uint32Array;

  // Extract material columns (bytes 0-255)
  const matR = materialArrow.getChild('r')?.toArray() as Uint8Array;
  const matG = materialArrow.getChild('g')?.toArray() as Uint8Array;
  const matB = materialArrow.getChild('b')?.toArray() as Uint8Array;
  const matA = materialArrow.getChild('a')?.toArray() as Uint8Array;

  // Extract vertex columns (quantized integers)
  const vertexX = vertexArrow.getChild('x')?.toArray() as Int32Array;
  const vertexY = vertexArrow.getChild('y')?.toArray() as Int32Array;
  const vertexZ = vertexArrow.getChild('z')?.toArray() as Int32Array;
  const normalX = hasNormals ? (vertexArrow.getChild('nx')?.toArray() as Float32Array) : null;
  const normalY = hasNormals ? (vertexArrow.getChild('ny')?.toArray() as Float32Array) : null;
  const normalZ = hasNormals ? (vertexArrow.getChild('nz')?.toArray() as Float32Array) : null;

  // Extract index column
  const indices = indexArrow.getChild('i')?.toArray() as Uint32Array;

  // Reconstruct MeshData array from instances
  const instanceCount = entityIds.length;
  const meshes: MeshData[] = new Array(instanceCount);
  const dequantMultiplier = 1.0 / vertexMultiplier;

  for (let i = 0; i < instanceCount; i++) {
    const meshIdx = meshIndices[i];
    const materialIdx = materialIndices[i];

    const vertexOffset = meshVertexOffsets[meshIdx];
    const vertexCount = meshVertexCounts[meshIdx];
    const indexOffset = meshIndexOffsets[meshIdx];
    const indexCount = meshIndexCounts[meshIdx];

    // Dequantize and reconstruct positions
    const positions = new Array<number>(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      const srcIdx = vertexOffset + v;
      positions[v * 3] = vertexX[srcIdx] * dequantMultiplier;
      positions[v * 3 + 1] = vertexY[srcIdx] * dequantMultiplier;
      positions[v * 3 + 2] = vertexZ[srcIdx] * dequantMultiplier;
    }

    // Reconstruct normals (or compute if not present)
    let normals: number[];
    if (hasNormals && normalX && normalY && normalZ) {
      normals = new Array<number>(vertexCount * 3);
      for (let v = 0; v < vertexCount; v++) {
        const srcIdx = vertexOffset + v;
        normals[v * 3] = normalX[srcIdx];
        normals[v * 3 + 1] = normalY[srcIdx];
        normals[v * 3 + 2] = normalZ[srcIdx];
      }
    } else {
      // Compute flat normals from triangle faces
      normals = computeFlatNormals(positions, indices.slice(indexOffset, indexOffset + indexCount));
    }

    // Reconstruct indices (relative to this mesh's vertices)
    const meshIndicesArray = new Array<number>(indexCount);
    for (let j = 0; j < indexCount; j++) {
      meshIndicesArray[j] = indices[indexOffset + j];
    }

    // Convert byte colors to float [0-1]
    meshes[i] = {
      express_id: entityIds[i],
      ifc_type: ifcTypes?.get(i) ?? 'Unknown',
      positions,
      normals,
      indices: meshIndicesArray,
      color: [matR[materialIdx] / 255, matG[materialIdx] / 255, matB[materialIdx] / 255, matA[materialIdx] / 255],
    };
  }

  return meshes;
}

/**
 * Compute flat normals for a mesh from positions and indices.
 * Each triangle face gets a uniform normal.
 */
function computeFlatNormals(positions: number[], indices: number[] | Uint32Array): number[] {
  const vertexCount = positions.length / 3;
  const normals = new Array<number>(vertexCount * 3).fill(0);
  const triangleCount = indices.length / 3;

  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    // Get triangle vertices
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    // Compute edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // Cross product
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate normals (will normalize later)
    normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
    normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
    normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
  }

  // Normalize
  for (let v = 0; v < vertexCount; v++) {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      normals[v * 3] /= len;
      normals[v * 3 + 1] /= len;
      normals[v * 3 + 2] /= len;
    }
  }

  return normals;
}

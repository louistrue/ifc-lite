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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import init, { initSync, IfcAPI } from '@ifc-lite/wasm';
import { buildHugeGeometryChunks } from './huge-chunk-builder.js';
import type { HugeGeometryChunk, MeshData } from './types.js';

export interface GeometryWorkerInitMessage {
  type: 'init';
  wasmModule?: WebAssembly.Module;
}

export interface GeometryWorkerProcessMessage {
  type: 'process';
  sharedBuffer: SharedArrayBuffer;
  jobsFlat: Uint32Array;      // [id, start, end, id, start, end, ...]
  unitScale: number;
  rtcX: number; rtcY: number; rtcZ: number;
  needsShift: boolean;
  voidKeys: Uint32Array;
  voidCounts: Uint32Array;
  voidValues: Uint32Array;
  styleIds: Uint32Array;
  styleColors: Uint8Array;
}

export interface GeometryWorkerProcessHugeMessage {
  type: 'process-huge';
  sharedBuffer: SharedArrayBuffer;
  jobsFlat: Uint32Array;
  unitScale: number;
  rtcX: number;
  rtcY: number;
  rtcZ: number;
  needsShift: boolean;
  voidKeys: Uint32Array;
  voidCounts: Uint32Array;
  voidValues: Uint32Array;
  styleIds: Uint32Array;
  styleColors: Uint8Array;
  batchStartId: number;
  targetChunkBytes?: number;
}

export interface GeometryWorkerPrePassMessage {
  type: 'prepass' | 'prepass-fast';
  sharedBuffer: SharedArrayBuffer;
}

export type GeometryWorkerRequest =
  | GeometryWorkerInitMessage
  | GeometryWorkerProcessMessage
  | GeometryWorkerProcessHugeMessage
  | GeometryWorkerPrePassMessage;

export interface GeometryWorkerBatchMessage {
  type: 'batch';
  meshes: {
    expressId: number;
    ifcType?: string;
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    color: [number, number, number, number];
  }[];
}

export interface GeometryWorkerCompleteMessage {
  type: 'complete';
  totalMeshes: number;
}

export interface GeometryWorkerHugeBatchMessage {
  type: 'huge-batch';
  chunks: HugeGeometryChunk[];
}

export interface GeometryWorkerErrorMessage {
  type: 'error';
  message: string;
}

export type GeometryWorkerResponse =
  | GeometryWorkerBatchMessage
  | GeometryWorkerHugeBatchMessage
  | GeometryWorkerCompleteMessage
  | GeometryWorkerErrorMessage;

let api: IfcAPI | null = null;
let sharedViewSupported: boolean | null = null;

function cloneSharedBytes(sharedBuffer: SharedArrayBuffer): Uint8Array {
  const localBytes = new Uint8Array(sharedBuffer.byteLength);
  localBytes.set(new Uint8Array(sharedBuffer));
  return localBytes;
}

function collectionToMeshes(collection: ReturnType<IfcAPI['processGeometryBatch']>): MeshData[] {
  const meshes: MeshData[] = [];
  for (let i = 0; i < collection.length; i++) {
    const mesh = collection.get(i);
    if (!mesh) continue;

    meshes.push({
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      positions: new Float32Array(mesh.positions),
      normals: new Float32Array(mesh.normals),
      indices: new Uint32Array(mesh.indices),
      color: [mesh.color[0], mesh.color[1], mesh.color[2], mesh.color[3]],
    });

    mesh.free();
  }
  collection.free();
  return meshes;
}

function withSharedBytes<T>(
  sharedBuffer: SharedArrayBuffer,
  run: (bytes: Uint8Array) => T
): T {
  if (sharedViewSupported === false) {
    return run(cloneSharedBytes(sharedBuffer));
  }

  try {
    const result = run(new Uint8Array(sharedBuffer));
    sharedViewSupported = true;
    return result;
  } catch (err) {
    if (sharedViewSupported === true) throw err;
    sharedViewSupported = false;
    return run(cloneSharedBytes(sharedBuffer));
  }
}

self.onmessage = async (e: MessageEvent<GeometryWorkerRequest>) => {
  try {
    if (e.data.type === 'prepass' || e.data.type === 'prepass-fast') {
      if (!api) { await init(); api = new IfcAPI(); }
      // Fast pre-pass: only scan for entity locations (~1-2s)
      // Full pre-pass: also resolves styles + voids (~6s)
      const result = withSharedBytes(e.data.sharedBuffer, (bytes) => (
        e.data.type === 'prepass-fast'
          ? api!.buildPrePassFast(bytes)
          : api!.buildPrePassOnce(bytes)
      ));
      (self as unknown as Worker).postMessage({ type: 'prepass-result', result });
      return;
    }

    if (e.data.type === 'init') {
      if (e.data.wasmModule) {
        initSync({ module_or_path: e.data.wasmModule });
      } else {
        await init();
      }
      api = new IfcAPI();
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }

    if (e.data.type === 'process' || e.data.type === 'process-huge') {
      if (!api) {
        await init();
        api = new IfcAPI();
      }

      const { sharedBuffer, jobsFlat, unitScale, rtcX, rtcY, rtcZ, needsShift,
              voidKeys, voidCounts, voidValues, styleIds, styleColors } = e.data;

      // Call processGeometryBatch with pre-pass data
      const collection = withSharedBytes(sharedBuffer, (bytes) => api!.processGeometryBatch(
        bytes, jobsFlat, unitScale,
        rtcX, rtcY, rtcZ, needsShift,
        voidKeys, voidCounts, voidValues,
        styleIds, styleColors,
      ));

      const meshes = collectionToMeshes(collection);

      if (e.data.type === 'process-huge') {
        const { chunks } = buildHugeGeometryChunks(
          meshes,
          e.data.batchStartId,
          e.data.targetChunkBytes,
        );
        const transferBuffers: ArrayBuffer[] = [];
        for (const chunk of chunks) {
          transferBuffers.push(chunk.vertexData.buffer as ArrayBuffer, chunk.indexData.buffer as ArrayBuffer);
        }

        (self as unknown as Worker).postMessage(
          { type: 'huge-batch', chunks } as GeometryWorkerHugeBatchMessage,
          transferBuffers,
        );
      } else {
        const transferBuffers: ArrayBuffer[] = [];
        const batchMeshes: GeometryWorkerBatchMessage['meshes'] = [];

        for (const mesh of meshes) {
          batchMeshes.push({
            expressId: mesh.expressId,
            ifcType: mesh.ifcType,
            positions: mesh.positions,
            normals: mesh.normals,
            indices: mesh.indices,
            color: mesh.color,
          });
          transferBuffers.push(
            mesh.positions.buffer as ArrayBuffer,
            mesh.normals.buffer as ArrayBuffer,
            mesh.indices.buffer as ArrayBuffer,
          );
        }

        (self as unknown as Worker).postMessage(
          { type: 'batch', meshes: batchMeshes } as GeometryWorkerBatchMessage,
          transferBuffers,
        );
      }
      (self as unknown as Worker).postMessage(
        { type: 'complete', totalMeshes: meshes.length } as GeometryWorkerCompleteMessage,
      );
    }
  } catch (err) {
    (self as unknown as Worker).postMessage(
      { type: 'error', message: err instanceof Error ? err.message : String(err) } as GeometryWorkerErrorMessage,
    );
  }
};

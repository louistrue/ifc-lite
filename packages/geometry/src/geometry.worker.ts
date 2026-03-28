/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Web Worker for parallel IFC geometry processing.
 *
 * Each worker loads its own WASM instance and processes a disjoint slice
 * of the geometry entity list via `parseMeshesSubset`. Results are posted
 * back as transferable ArrayBuffers to avoid copying.
 */

import init, { IfcAPI } from '@ifc-lite/wasm';

export interface GeometryWorkerRequest {
  type: 'process';
  content: string;
  startIdx: number;
  endIdx: number;
  totalEntities: number;
}

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
  /** Transfer list buffers (positions, normals, indices) for zero-copy */
  _transferBuffers?: ArrayBuffer[];
}

export interface GeometryWorkerCompleteMessage {
  type: 'complete';
  totalMeshes: number;
}

export interface GeometryWorkerErrorMessage {
  type: 'error';
  message: string;
}

export type GeometryWorkerResponse =
  | GeometryWorkerBatchMessage
  | GeometryWorkerCompleteMessage
  | GeometryWorkerErrorMessage;

let api: IfcAPI | null = null;
let wasmInitialized = false;

async function ensureWasmInitialized(): Promise<void> {
  if (wasmInitialized) return;
  await init();
  api = new IfcAPI();
  wasmInitialized = true;
}

self.onmessage = async (e: MessageEvent<GeometryWorkerRequest>) => {
  const { type, content, startIdx, endIdx } = e.data;

  if (type !== 'process') return;

  try {
    await ensureWasmInitialized();

    const collection = api!.parseMeshesSubset(content, startIdx, endIdx, true);

    // Convert MeshCollection to transferable mesh data
    const meshes: GeometryWorkerBatchMessage['meshes'] = [];
    const transferBuffers: ArrayBuffer[] = [];

    for (let i = 0; i < collection.length; i++) {
      const mesh = collection.get(i);
      if (!mesh) continue;

      const colorArray = mesh.color;
      const color: [number, number, number, number] = [
        colorArray[0],
        colorArray[1],
        colorArray[2],
        colorArray[3],
      ];

      // Copy typed arrays so they are detachable (WASM memory cannot be transferred)
      const positions = new Float32Array(mesh.positions);
      const normals = new Float32Array(mesh.normals);
      const indices = new Uint32Array(mesh.indices);

      meshes.push({
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        positions,
        normals,
        indices,
        color,
      });

      transferBuffers.push(positions.buffer);
      transferBuffers.push(normals.buffer);
      transferBuffers.push(indices.buffer);

      mesh.free();
    }

    collection.free();

    // Post batch with transferable buffers (zero-copy to main thread)
    const batchMsg: GeometryWorkerBatchMessage = { type: 'batch', meshes };
    (self as unknown as Worker).postMessage(batchMsg, transferBuffers);

    // Signal completion
    const completeMsg: GeometryWorkerCompleteMessage = {
      type: 'complete',
      totalMeshes: meshes.length,
    };
    (self as unknown as Worker).postMessage(completeMsg);
  } catch (err) {
    const errorMsg: GeometryWorkerErrorMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(errorMsg);
  }
};

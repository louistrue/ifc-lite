/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import init, { IfcAPI } from '@ifc-lite/wasm';

export interface GeometryWorkerRequest {
  type: 'process';
  /** SharedArrayBuffer containing the raw IFC file bytes — zero-copy across workers */
  sharedBuffer: SharedArrayBuffer;
  startIdx: number;
  endIdx: number;
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
let wasmReady = false;

async function ensureInit(): Promise<void> {
  if (wasmReady) return;
  await init();
  api = new IfcAPI();
  wasmReady = true;
}

self.onmessage = async (e: MessageEvent<GeometryWorkerRequest>) => {
  const { type, sharedBuffer, startIdx, endIdx } = e.data;
  if (type !== 'process') return;

  try {
    await ensureInit();

    // Decode shared buffer to string (each worker does this independently,
    // but the underlying SharedArrayBuffer is NOT copied via postMessage)
    const content = new TextDecoder().decode(new Uint8Array(sharedBuffer));

    const collection = api!.parseMeshesSubset(content, startIdx, endIdx, true);

    const meshes: GeometryWorkerBatchMessage['meshes'] = [];
    const transferBuffers: ArrayBuffer[] = [];

    for (let i = 0; i < collection.length; i++) {
      const mesh = collection.get(i);
      if (!mesh) continue;

      const positions = new Float32Array(mesh.positions);
      const normals = new Float32Array(mesh.normals);
      const indices = new Uint32Array(mesh.indices);

      meshes.push({
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        positions,
        normals,
        indices,
        color: [mesh.color[0], mesh.color[1], mesh.color[2], mesh.color[3]],
      });

      transferBuffers.push(positions.buffer, normals.buffer, indices.buffer);
      mesh.free();
    }
    collection.free();

    (self as unknown as Worker).postMessage(
      { type: 'batch', meshes } as GeometryWorkerBatchMessage,
      transferBuffers,
    );
    (self as unknown as Worker).postMessage(
      { type: 'complete', totalMeshes: meshes.length } as GeometryWorkerCompleteMessage,
    );
  } catch (err) {
    (self as unknown as Worker).postMessage(
      { type: 'error', message: err instanceof Error ? err.message : String(err) } as GeometryWorkerErrorMessage,
    );
  }
};

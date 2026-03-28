/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import init, { initSync, IfcAPI } from '@ifc-lite/wasm';

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

export interface GeometryWorkerPrePassMessage {
  type: 'prepass' | 'prepass-fast';
  sharedBuffer: SharedArrayBuffer;
}

export type GeometryWorkerRequest = GeometryWorkerInitMessage | GeometryWorkerProcessMessage | GeometryWorkerPrePassMessage;

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

self.onmessage = async (e: MessageEvent<GeometryWorkerRequest>) => {
  try {
    if (e.data.type === 'prepass' || e.data.type === 'prepass-fast') {
      if (!api) { await init(); api = new IfcAPI(); }
      const localBuffer = new Uint8Array(e.data.sharedBuffer.byteLength);
      localBuffer.set(new Uint8Array(e.data.sharedBuffer));
      // Fast pre-pass: only scan for entity locations (~1-2s)
      // Full pre-pass: also resolves styles + voids (~6s)
      const result = e.data.type === 'prepass-fast'
        ? api.buildPrePassFast(localBuffer)
        : api.buildPrePassOnce(localBuffer);
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

    if (e.data.type === 'process') {
      if (!api) {
        await init();
        api = new IfcAPI();
      }

      const { sharedBuffer, jobsFlat, unitScale, rtcX, rtcY, rtcZ, needsShift,
              voidKeys, voidCounts, voidValues, styleIds, styleColors } = e.data;

      // Copy shared bytes to local buffer (Firefox requires this for typed array ops)
      const localBytes = new Uint8Array(sharedBuffer.byteLength);
      localBytes.set(new Uint8Array(sharedBuffer));

      // Call processGeometryBatch with pre-pass data
      const collection = api.processGeometryBatch(
        localBytes, jobsFlat, unitScale,
        rtcX, rtcY, rtcZ, needsShift,
        voidKeys, voidCounts, voidValues,
        styleIds, styleColors,
      );

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
          positions, normals, indices,
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
    }
  } catch (err) {
    (self as unknown as Worker).postMessage(
      { type: 'error', message: err instanceof Error ? err.message : String(err) } as GeometryWorkerErrorMessage,
    );
  }
};

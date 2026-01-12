/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Worker - Handles mesh collection in a Web Worker
 * Uses IFC-Lite for native Rust geometry processing (1.9x faster than web-ifc)
 */

import init, { IfcAPI } from '@ifc-lite/wasm';
import { IfcLiteMeshCollector } from './ifc-lite-mesh-collector.js';
import type { MeshData } from './types.js';
import type { TaskType } from './worker-pool.js';

interface WorkerTaskMessage {
  id: string;
  type: TaskType;
  data: any;
}

interface WorkerResponseMessage {
  id: string;
  type: 'task-result' | 'task-error' | 'ready';
  result?: any;
  error?: string;
}

// Global IFC-Lite API instance (initialized once per worker)
let ifcApi: IfcAPI | null = null;
let ifcApiInitialized: boolean = false;

/**
 * Initialize IFC-Lite API in worker context
 */
async function initIfcApi(wasmPath: string = '/'): Promise<IfcAPI> {
  if (ifcApi && ifcApiInitialized) {
    return ifcApi;
  }

  const initStart = performance.now();
  console.log('[Worker] Initializing IFC-Lite...');

  // Initialize WASM module
  const wasmUrl = wasmPath.endsWith('/')
    ? `${wasmPath}ifc_lite_wasm_bg.wasm`
    : `${wasmPath}/ifc_lite_wasm_bg.wasm`;

  await init(wasmUrl);
  ifcApi = new IfcAPI();
  ifcApiInitialized = true;

  const initTime = performance.now() - initStart;
  console.log(`[Worker] IFC-Lite initialized in ${initTime.toFixed(2)}ms`);

  return ifcApi;
}

/**
 * Handle mesh collection task
 */
async function handleMeshCollection(data: { buffer: ArrayBuffer; wasmPath?: string }): Promise<MeshData[]> {
  const taskStart = performance.now();
  const { buffer, wasmPath = '/' } = data;

  // Initialize IFC-Lite if needed
  const apiInitStart = performance.now();
  const api = await initIfcApi(wasmPath);
  const apiInitTime = performance.now() - apiInitStart;
  if (apiInitTime > 10) {
    console.log(`[Worker] IFC-Lite init took ${apiInitTime.toFixed(2)}ms`);
  }

  // Convert buffer to string (IFC files are text)
  const decoder = new TextDecoder();
  const content = decoder.decode(new Uint8Array(buffer));

  // Collect meshes using IFC-Lite
  const collectStart = performance.now();
  const collector = new IfcLiteMeshCollector(api, content);
  const meshes = collector.collectMeshes();
  const collectTime = performance.now() - collectStart;
  const totalTime = performance.now() - taskStart;

  console.log(`[Worker] Mesh collection: ${collectTime.toFixed(2)}ms, total: ${totalTime.toFixed(2)}ms, meshes: ${meshes.length}`);

  return meshes;
}

/**
 * Process task and send result back to main thread
 */
async function processTask(task: WorkerTaskMessage): Promise<void> {
  try {
    let result: any;

    switch (task.type) {
      case 'mesh-collection':
        result = await handleMeshCollection(task.data);
        break;

      case 'generate-lod':
      case 'build-bvh':
        throw new Error(`Task type '${task.type}' not yet implemented`);

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    // Extract transferable buffers for zero-copy transfer
    const transferables: Transferable[] = [];

    if (Array.isArray(result)) {
      // MeshData[] - extract all typed array buffers
      for (const mesh of result) {
        if (mesh.positions?.buffer) {
          transferables.push(mesh.positions.buffer);
        }
        if (mesh.normals?.buffer) {
          transferables.push(mesh.normals.buffer);
        }
        if (mesh.indices?.buffer) {
          transferables.push(mesh.indices.buffer);
        }
      }
    }

    // Send result with transferables
    const response: WorkerResponseMessage = {
      id: task.id,
      type: 'task-result',
      result,
    };

    self.postMessage(response, { transfer: transferables });
  } catch (error) {
    // Send error back
    const response: WorkerResponseMessage = {
      id: task.id,
      type: 'task-error',
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
  }
}

// Signal that worker is ready (send immediately on load)
const readyMessage: WorkerResponseMessage = {
  id: '',
  type: 'ready',
};
self.postMessage(readyMessage);

// Listen for messages from main thread
self.onmessage = async (e: MessageEvent<WorkerTaskMessage>) => {
  await processTask(e.data);
};

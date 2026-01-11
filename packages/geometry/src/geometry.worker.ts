/**
 * Geometry Worker - Handles mesh collection in a Web Worker
 * Initializes web-ifc once per worker and processes mesh collection tasks
 */

import * as WebIFC from 'web-ifc';
import { MeshCollector } from './mesh-collector.js';
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

// Global web-ifc API instance (initialized once per worker)
let ifcApi: WebIFC.IfcAPI | null = null;
let ifcApiInitialized: boolean = false;

/**
 * Initialize web-ifc API in worker context
 */
async function initIfcApi(wasmPath: string = '/'): Promise<WebIFC.IfcAPI> {
  if (ifcApi && ifcApiInitialized) {
    return ifcApi;
  }

  const initStart = performance.now();
  console.log('[Worker] Initializing web-ifc...');
  ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath(wasmPath, true);
  await ifcApi.Init();
  ifcApiInitialized = true;
  const initTime = performance.now() - initStart;
  console.log(`[Worker] web-ifc initialized in ${initTime.toFixed(2)}ms`);

  return ifcApi;
}

/**
 * Handle mesh collection task
 */
async function handleMeshCollection(data: { buffer: ArrayBuffer; wasmPath?: string }): Promise<MeshData[]> {
  const taskStart = performance.now();
  const { buffer, wasmPath = '/' } = data;

  // Initialize web-ifc if needed
  const apiInitStart = performance.now();
  const api = await initIfcApi(wasmPath);
  const apiInitTime = performance.now() - apiInitStart;
  if (apiInitTime > 10) {
    console.log(`[Worker] web-ifc init took ${apiInitTime.toFixed(2)}ms`);
  }

  // Open model
  const openStart = performance.now();
  const modelID = api.OpenModel(new Uint8Array(buffer));
  const openTime = performance.now() - openStart;
  console.log(`[Worker] Model opened in ${openTime.toFixed(2)}ms`);

  try {
    // Collect meshes
    const collectStart = performance.now();
    const collector = new MeshCollector(api, modelID);
    const meshes = collector.collectMeshes();
    const collectTime = performance.now() - collectStart;
    const totalTime = performance.now() - taskStart;
    console.log(`[Worker] Mesh collection: ${collectTime.toFixed(2)}ms, total: ${totalTime.toFixed(2)}ms, meshes: ${meshes.length}`);

    // Close model
    api.CloseModel(modelID);

    return meshes;
  } catch (error) {
    // Ensure model is closed on error
    try {
      api.CloseModel(modelID);
    } catch (e) {
      // Ignore close errors
    }
    throw error;
  }
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

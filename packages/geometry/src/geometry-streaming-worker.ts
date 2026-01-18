/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Streaming Worker
 * 
 * Runs WASM geometry parsing in a dedicated worker and streams batches
 * back to main thread. This enables true parallelism with data model parsing.
 * 
 * Architecture:
 * - Main thread sends IFC content to worker
 * - Worker runs parseMeshes() (the slow WASM call)
 * - Worker streams MeshData batches back via postMessage
 * - Main thread receives batches and renders immediately
 * - Data model parsing runs in parallel on main thread
 */

import init, { IfcAPI } from '@ifc-lite/wasm';
import type { MeshData } from './types.js';

// Messages from main thread
interface StartMessage {
  type: 'start';
  ifcContent: string;
  batchSize: number;
}

type IncomingMessage = StartMessage;

// Messages to main thread
interface BatchMessage {
  type: 'batch';
  meshes: MeshData[];
  batchNumber: number;
  totalMeshes: number;
}

interface CompleteMessage {
  type: 'complete';
  stats: {
    totalMeshes: number;
    totalVertices: number;
    totalTriangles: number;
    parseTimeMs: number;
  };
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

interface ColorUpdateMessage {
  type: 'colorUpdate';
  updates: Array<[number, [number, number, number, number]]>;
}

type OutgoingMessage = BatchMessage | CompleteMessage | ErrorMessage | ColorUpdateMessage;

// Worker state
let ifcApi: IfcAPI | null = null;

/**
 * Initialize WASM module
 */
async function initWasm(): Promise<void> {
  if (ifcApi) return;
  
  const start = performance.now();
  await init();
  ifcApi = new IfcAPI();
  console.log(`[GeometryWorker] WASM initialized in ${(performance.now() - start).toFixed(0)}ms`);
}

/**
 * Convert IFC Z-up to WebGL Y-up coordinates
 */
function convertZUpToYUp(coords: Float32Array): void {
  for (let i = 0; i < coords.length; i += 3) {
    const y = coords[i + 1];
    const z = coords[i + 2];
    coords[i + 1] = z;
    coords[i + 2] = -y;
  }
}

/**
 * Process geometry and stream batches using async API for early first batch
 * Optimized: Send first batch immediately, then accumulate for fewer postMessages
 */
async function processGeometry(content: string, batchSize: number): Promise<void> {
  if (!ifcApi) {
    throw new Error('WASM not initialized');
  }

  const parseStart = performance.now();
  console.log(`[GeometryWorker] Starting streaming geometry parsing...`);

  let batchNumber = 0;
  let totalMeshes = 0;
  let totalVertices = 0;
  let totalTriangles = 0;
  let firstBatchSent = false;
  
  // Accumulator for batching multiple WASM batches into fewer postMessages
  // (reduces postMessage overhead significantly)
  let accumulatedMeshes: MeshData[] = [];
  const POST_MESSAGE_BATCH_SIZE = 500; // Send to main thread every 500 meshes
  
  // Track colors for deferred updates
  const colorUpdates = new Map<number, [number, number, number, number]>();

  // Use parseMeshesAsync with callbacks for true streaming
  await ifcApi.parseMeshesAsync(content, {
    batchSize,
    
    // Handle color updates
    onColorUpdate: (updates: Map<number, [number, number, number, number]>) => {
      for (const [expressId, color] of updates) {
        colorUpdates.set(expressId, color);
      }
      // Send color update to main thread
      const colorMsg: ColorUpdateMessage = {
        type: 'colorUpdate',
        updates: Array.from(updates.entries()),
      };
      self.postMessage(colorMsg);
    },
    
    // Handle each batch of meshes as it's parsed
    onBatch: (meshes: any[], _progress: any) => {
      for (const mesh of meshes) {
        // Check for empty geometry BEFORE copying (optimization)
        const srcPositions = mesh.positions;
        const srcIndices = mesh.indices;
        if (srcPositions.length === 0 || srcIndices.length === 0) {
          mesh.free();
          continue;
        }

        const expressId = mesh.expressId;
        
        // Copy data from WASM memory (required - WASM memory invalidated after free())
        const positions = new Float32Array(srcPositions);
        const normals = new Float32Array(mesh.normals);
        const indices = new Uint32Array(srcIndices);

        // Convert coordinate system
        convertZUpToYUp(positions);
        convertZUpToYUp(normals);

        // Get color (may have been updated after initial parse)
        const updatedColor = colorUpdates.get(expressId);
        const colorArray = updatedColor ?? mesh.color;

        accumulatedMeshes.push({
          expressId,
          ifcType: mesh.ifcType,
          positions,
          normals,
          indices,
          color: [colorArray[0], colorArray[1], colorArray[2], colorArray[3]],
        });

        totalVertices += positions.length / 3;
        totalTriangles += indices.length / 3;
        totalMeshes++;
        
        mesh.free();
      }

      // Send first batch immediately for fast first frame
      if (!firstBatchSent && accumulatedMeshes.length >= batchSize) {
        batchNumber++;
        const firstBatch = accumulatedMeshes.splice(0, batchSize);
        sendBatch(firstBatch, batchNumber, totalMeshes);
        firstBatchSent = true;
        console.log(`[GeometryWorker] First batch sent at ${(performance.now() - parseStart).toFixed(0)}ms`);
      }
      // After first batch, accumulate more before sending (reduces overhead)
      else if (firstBatchSent && accumulatedMeshes.length >= POST_MESSAGE_BATCH_SIZE) {
        batchNumber++;
        const batch = accumulatedMeshes.splice(0, POST_MESSAGE_BATCH_SIZE);
        sendBatch(batch, batchNumber, totalMeshes);
      }
    },
    
    // Handle completion
    onComplete: (stats: { totalMeshes: number; totalVertices: number; totalTriangles: number }) => {
      // Send any remaining accumulated meshes
      if (accumulatedMeshes.length > 0) {
        batchNumber++;
        sendBatch(accumulatedMeshes, batchNumber, totalMeshes);
        accumulatedMeshes = [];
      }
      
      const parseTime = performance.now() - parseStart;
      
      const completeMsg: CompleteMessage = {
        type: 'complete',
        stats: {
          totalMeshes: stats.totalMeshes,
          totalVertices: stats.totalVertices,
          totalTriangles: stats.totalTriangles,
          parseTimeMs: parseTime,
        },
      };
      self.postMessage(completeMsg);
      
      console.log(`[GeometryWorker] Complete: ${stats.totalMeshes} meshes in ${parseTime.toFixed(0)}ms`);
    },
  });
}

/**
 * Send a batch of meshes to main thread
 * Uses Transferable for zero-copy transfer of ArrayBuffers
 */
function sendBatch(meshes: MeshData[], batchNumber: number, totalMeshes: number): void {
  // Collect transferable buffers for zero-copy transfer
  const transferables: Transferable[] = [];
  
  for (const mesh of meshes) {
    transferables.push(mesh.positions.buffer as ArrayBuffer);
    transferables.push(mesh.normals.buffer as ArrayBuffer);
    transferables.push(mesh.indices.buffer as ArrayBuffer);
  }

  const msg: BatchMessage = {
    type: 'batch',
    meshes,
    batchNumber,
    totalMeshes,
  };

  // Transfer ownership of buffers to main thread (zero-copy)
  (self as unknown as Worker).postMessage(msg, transferables);
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (e: MessageEvent<IncomingMessage>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'start':
        await initWasm();
        await processGeometry(msg.ifcContent, msg.batchSize);
        break;
    }
  } catch (error) {
    const errorMsg: ErrorMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(errorMsg);
  }
};

// Signal ready
self.postMessage({ type: 'ready' });

/**
 * Spike 8: glTF Export
 * Goal: Export geometry to GLB format
 * Success: Valid GLB file that can be loaded in viewers
 */

import { GeometryProcessor } from '@ifc-lite/geometry';
import type { GeometryResult, Mesh } from '@ifc-lite/geometry';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export interface GLTFSpikeResult {
  passed: boolean;
  glbSizeBytes: number;
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  exportTimeMs: number;
}

/**
 * Simple glTF/GLB exporter for testing
 */
class SimpleGLTFExporter {
  /**
   * Export to GLB format
   */
  exportGLB(geometryResult: GeometryResult): Uint8Array {
    const meshes = geometryResult.meshes;
    
    // Build glTF JSON
    const gltf: any = {
      asset: {
        version: '2.0',
        generator: 'IFC-Lite',
      },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    
    // Collect all geometry data
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let positionOffset = 0;
    let normalOffset = 0;
    let indexOffset = 0;
    
    const nodeIndices: number[] = [];
    
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i] as any;
      const meshPositions = mesh.positions || [];
      const meshNormals = mesh.normals || [];
      const meshIndices = mesh.indices || [];
      
      // Add to combined buffers
      const vertexStart = positions.length / 3;
      positions.push(...Array.from(meshPositions));
      normals.push(...Array.from(meshNormals));
      
      // Adjust indices
      const adjustedIndices = Array.from(meshIndices).map(idx => idx + vertexStart);
      indices.push(...adjustedIndices);
      
      // Create accessors
      const posAccessorIdx = gltf.accessors.length;
      gltf.accessors.push({
        bufferView: 0,
        byteOffset: positionOffset * 4,
        componentType: 5126, // FLOAT
        count: meshPositions.length / 3,
        type: 'VEC3',
      });
      
      const normAccessorIdx = gltf.accessors.length;
      gltf.accessors.push({
        bufferView: 1,
        byteOffset: normalOffset * 4,
        componentType: 5126,
        count: meshNormals.length / 3,
        type: 'VEC3',
      });
      
      const idxAccessorIdx = gltf.accessors.length;
      gltf.accessors.push({
        bufferView: 2,
        byteOffset: indexOffset * 4,
        componentType: 5125, // UNSIGNED_INT
        count: meshIndices.length,
        type: 'SCALAR',
      });
      
      // Create mesh
      const meshIdx = gltf.meshes.length;
      gltf.meshes.push({
        primitives: [{
          attributes: {
            POSITION: posAccessorIdx,
            NORMAL: normAccessorIdx,
          },
          indices: idxAccessorIdx,
        }],
      });
      
      // Create node
      const nodeIdx = gltf.nodes.length;
      gltf.nodes.push({
        mesh: meshIdx,
        extras: {
          expressId: mesh.expressId || i,
        },
      });
      
      nodeIndices.push(nodeIdx);
      
      positionOffset += meshPositions.length * 4;
      normalOffset += meshNormals.length * 4;
      indexOffset += meshIndices.length * 4;
    }
    
    gltf.scenes[0].nodes = nodeIndices;
    
    // Create buffer views
    const positionsBytes = new Float32Array(positions).buffer;
    const normalsBytes = new Float32Array(normals).buffer;
    const indicesBytes = new Uint32Array(indices).buffer;
    
    const totalBufferSize = positionsBytes.byteLength + normalsBytes.byteLength + indicesBytes.byteLength;
    
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: 0,
      byteLength: positionsBytes.byteLength,
      target: 34962, // ARRAY_BUFFER
    });
    
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: positionsBytes.byteLength,
      byteLength: normalsBytes.byteLength,
      target: 34962,
    });
    
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: positionsBytes.byteLength + normalsBytes.byteLength,
      byteLength: indicesBytes.byteLength,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    
    gltf.buffers[0].byteLength = totalBufferSize;
    
    // Pack GLB
    return this.packGLB(gltf, [
      new Uint8Array(positionsBytes),
      new Uint8Array(normalsBytes),
      new Uint8Array(indicesBytes),
    ]);
  }
  
  private packGLB(gltfJson: any, buffers: Uint8Array[]): Uint8Array {
    const jsonString = JSON.stringify(gltfJson);
    const jsonBuffer = new TextEncoder().encode(jsonString);
    
    // Pad JSON to 4-byte boundary
    const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
    const paddedJsonLength = jsonBuffer.byteLength + jsonPadding;
    
    // Combine buffers
    const totalBinLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const binPadding = (4 - (totalBinLength % 4)) % 4;
    const paddedBinLength = totalBinLength + binPadding;
    
    // GLB header + JSON chunk + BIN chunk
    const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    const bytes = new Uint8Array(glb);
    
    let offset = 0;
    
    // GLB header
    view.setUint32(offset, 0x46546C67, true); // 'glTF' magic
    offset += 4;
    view.setUint32(offset, 2, true); // version
    offset += 4;
    view.setUint32(offset, totalLength, true); // total length
    offset += 4;
    
    // JSON chunk header
    view.setUint32(offset, paddedJsonLength, true);
    offset += 4;
    view.setUint32(offset, 0x4E4F534A, true); // 'JSON'
    offset += 4;
    
    // JSON chunk data
    bytes.set(jsonBuffer, offset);
    offset += jsonBuffer.byteLength;
    for (let i = 0; i < jsonPadding; i++) {
      bytes[offset++] = 0x20; // Space padding
    }
    
    // BIN chunk header
    view.setUint32(offset, paddedBinLength, true);
    offset += 4;
    view.setUint32(offset, 0x004E4942, true); // 'BIN\0'
    offset += 4;
    
    // BIN chunk data
    for (const buffer of buffers) {
      bytes.set(buffer, offset);
      offset += buffer.byteLength;
    }
    // Zero padding is automatic from ArrayBuffer
    
    return new Uint8Array(glb);
  }
}

/**
 * Run glTF export spike test
 */
export async function runGLTFSpike(file: File): Promise<GLTFSpikeResult> {
  console.log('[Spike8] Starting glTF export test...');
  
  // Load geometry
  const buffer = await file.arrayBuffer();
  const processor = new GeometryProcessor();
  
  // Set WASM path for Node.js environment
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(__dirname, '..', 'wasm') + '/';
  await processor.init(wasmPath);
  
  const geometryResult = await processor.process(new Uint8Array(buffer));
  
  const meshCount = geometryResult.meshes.length;
  const vertexCount = geometryResult.totalVertices;
  const triangleCount = geometryResult.totalTriangles;
  
  console.log(`[Spike8] Loaded ${meshCount} meshes, ${vertexCount} vertices, ${triangleCount} triangles`);
  
  if (meshCount === 0) {
    return {
      passed: false,
      glbSizeBytes: 0,
      meshCount: 0,
      vertexCount: 0,
      triangleCount: 0,
      exportTimeMs: 0,
    };
  }
  
  // Export to GLB
  const exporter = new SimpleGLTFExporter();
  const exportStart = performance.now();
  const glb = exporter.exportGLB(geometryResult);
  const exportTimeMs = performance.now() - exportStart;
  
  console.log(`[Spike8] Exported GLB: ${(glb.byteLength / 1024).toFixed(2)} KB in ${exportTimeMs.toFixed(3)}ms`);
  
  // Validate GLB header
  const view = new DataView(glb.buffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const passed = magic === 0x46546C67 && version === 2 && glb.byteLength > 100;
  
  if (passed) {
    console.log('[Spike8] GLB header valid');
  } else {
    console.warn('[Spike8] GLB header invalid');
  }
  
  return {
    passed,
    glbSizeBytes: glb.byteLength,
    meshCount,
    vertexCount,
    triangleCount,
    exportTimeMs,
  };
}

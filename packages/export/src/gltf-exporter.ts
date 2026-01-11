/**
 * glTF/GLB exporter
 */

import type { GeometryResult } from '@ifc-lite/geometry';

export interface GLTFExportOptions {
  useInstancing?: boolean;
  includeMetadata?: boolean;
}

export class GLTFExporter {
  private geometryResult: GeometryResult;
  
  constructor(geometryResult: GeometryResult) {
    this.geometryResult = geometryResult;
  }
  
  /**
   * Export to GLB (binary glTF)
   */
  exportGLB(options: GLTFExportOptions = {}): Uint8Array {
    const gltf = this.buildGLTF(options);
    return this.packGLB(gltf.json, gltf.buffers);
  }
  
  /**
   * Export to glTF (JSON + separate .bin)
   */
  exportGLTF(options: GLTFExportOptions = {}): { json: string; bin: Uint8Array } {
    const gltf = this.buildGLTF(options);
    return {
      json: JSON.stringify(gltf.json, null, 2),
      bin: this.combineBuffers(gltf.buffers),
    };
  }
  
  private buildGLTF(options: GLTFExportOptions): { json: any; buffers: Uint8Array[] } {
    const meshes = this.geometryResult.meshes;
    
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
    
    if (options.includeMetadata) {
      gltf.asset.extras = {
        meshCount: meshes.length,
        vertexCount: this.geometryResult.totalVertices,
        triangleCount: this.geometryResult.totalTriangles,
      };
    }
    
    // Collect geometry data
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let positionOffset = 0;
    let normalOffset = 0;
    let indexOffset = 0;
    
    const nodeIndices: number[] = [];
    
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i] as any;
      const meshPositions = (mesh.positions || []) as Float32Array | number[];
      const meshNormals = (mesh.normals || []) as Float32Array | number[];
      const meshIndices = (mesh.indices || []) as Uint32Array | number[];
      
      const vertexStart = positions.length / 3;
      positions.push(...Array.from(meshPositions));
      normals.push(...Array.from(meshNormals));
      
      const adjustedIndices = Array.from(meshIndices).map((idx: number) => idx + vertexStart);
      indices.push(...adjustedIndices);
      
      // Accessors
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
      
      // Mesh
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
      
      // Node
      const nodeIdx = gltf.nodes.length;
      const node: any = {
        mesh: meshIdx,
      };
      
      if (options.includeMetadata && mesh.expressId) {
        node.extras = {
          expressId: mesh.expressId,
        };
      }
      
      gltf.nodes.push(node);
      nodeIndices.push(nodeIdx);
      
      positionOffset += meshPositions.length * 4;
      normalOffset += meshNormals.length * 4;
      indexOffset += meshIndices.length * 4;
    }
    
    gltf.scenes[0].nodes = nodeIndices;
    
    // Buffer views
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
    
    return {
      json: gltf,
      buffers: [
        new Uint8Array(positionsBytes),
        new Uint8Array(normalsBytes),
        new Uint8Array(indicesBytes),
      ],
    };
  }
  
  private combineBuffers(buffers: Uint8Array[]): Uint8Array {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      combined.set(buffer, offset);
      offset += buffer.byteLength;
    }
    return combined;
  }
  
  private packGLB(gltfJson: any, buffers: Uint8Array[]): Uint8Array {
    const jsonString = JSON.stringify(gltfJson);
    const jsonBuffer = new TextEncoder().encode(jsonString);
    
    const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
    const paddedJsonLength = jsonBuffer.byteLength + jsonPadding;
    
    const bin = this.combineBuffers(buffers);
    const binPadding = (4 - (bin.byteLength % 4)) % 4;
    const paddedBinLength = bin.byteLength + binPadding;
    
    const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    const bytes = new Uint8Array(glb);
    
    let offset = 0;
    
    // GLB header
    view.setUint32(offset, 0x46546C67, true); // 'glTF'
    offset += 4;
    view.setUint32(offset, 2, true);
    offset += 4;
    view.setUint32(offset, totalLength, true);
    offset += 4;
    
    // JSON chunk
    view.setUint32(offset, paddedJsonLength, true);
    offset += 4;
    view.setUint32(offset, 0x4E4F534A, true); // 'JSON'
    offset += 4;
    bytes.set(jsonBuffer, offset);
    offset += jsonBuffer.byteLength;
    for (let i = 0; i < jsonPadding; i++) {
      bytes[offset++] = 0x20;
    }
    
    // BIN chunk
    view.setUint32(offset, paddedBinLength, true);
    offset += 4;
    view.setUint32(offset, 0x004E4942, true); // 'BIN\0'
    offset += 4;
    bytes.set(bin, offset);
    
    return new Uint8Array(glb);
  }
}

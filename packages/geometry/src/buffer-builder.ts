/**
 * Buffer builder - creates GPU-ready interleaved vertex buffers
 */

import type { MeshData, GeometryResult } from './types.js';

export class BufferBuilder {
  /**
   * Build interleaved vertex buffer from mesh data
   * Format: [x,y,z,nx,ny,nz] per vertex
   */
  buildInterleavedBuffer(mesh: MeshData): Float32Array {
    const vertexCount = mesh.positions.length / 3;
    const buffer = new Float32Array(vertexCount * 6); // 6 floats per vertex (pos + normal)

    for (let i = 0; i < vertexCount; i++) {
      const base = i * 6;
      const posBase = i * 3;
      const normBase = i * 3;

      // Position
      buffer[base] = mesh.positions[posBase];
      buffer[base + 1] = mesh.positions[posBase + 1];
      buffer[base + 2] = mesh.positions[posBase + 2];

      // Normal
      buffer[base + 3] = mesh.normals[normBase];
      buffer[base + 4] = mesh.normals[normBase + 1];
      buffer[base + 5] = mesh.normals[normBase + 2];
    }

    return buffer;
  }

  /**
   * Process all meshes and build GPU-ready buffers
   */
  processMeshes(meshes: MeshData[]): GeometryResult {
    let totalTriangles = 0;
    let totalVertices = 0;

    for (const mesh of meshes) {
      totalTriangles += mesh.indices.length / 3;
      totalVertices += mesh.positions.length / 3;
    }

    return {
      meshes,
      totalTriangles,
      totalVertices,
    };
  }
}

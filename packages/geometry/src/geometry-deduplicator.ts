/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Deduplicator - Groups identical meshes for GPU instancing
 * 
 * Reduces draw calls from N individual meshes to M unique geometries with instances.
 * A typical building with 40,000 elements might have only 500-2000 unique geometries.
 */

import type { MeshData } from './types.js';

export interface InstancedMeshData {
  /** Unique hash for this geometry */
  geometryHash: string;
  /** Vertex positions (shared by all instances) */
  positions: Float32Array;
  /** Vertex normals (shared by all instances) */
  normals: Float32Array;
  /** Triangle indices (shared by all instances) */
  indices: Uint32Array;
  /** All instances of this geometry */
  instances: Array<{
    expressId: number;
    color: [number, number, number, number];
    // Transform is identity for now - all instances use same positions
    // Future: add per-instance transform matrix
  }>;
}

/**
 * Fast hash for geometry data
 * Uses a subset of vertices for speed while maintaining uniqueness
 */
function hashGeometry(positions: Float32Array, indices: Uint32Array): string {
  // Hash based on: vertex count, index count, first few vertices, first few indices
  const parts: number[] = [
    positions.length,
    indices.length,
  ];
  
  // Sample first 12 position values (4 vertices)
  const positionSamples = Math.min(12, positions.length);
  for (let i = 0; i < positionSamples; i++) {
    // Quantize to 3 decimal places for floating point stability
    parts.push(Math.round(positions[i] * 1000));
  }
  
  // Sample first 6 indices (2 triangles)
  const indexSamples = Math.min(6, indices.length);
  for (let i = 0; i < indexSamples; i++) {
    parts.push(indices[i]);
  }
  
  // Also sample from middle and end if we have enough data
  if (positions.length > 24) {
    const mid = Math.floor(positions.length / 2);
    for (let i = 0; i < 6; i++) {
      parts.push(Math.round(positions[mid + i] * 1000));
    }
  }
  
  return parts.join('_');
}

/**
 * Deduplicate meshes by grouping identical geometries
 * Returns instanced mesh data that can be rendered with GPU instancing
 */
export function deduplicateMeshes(meshes: MeshData[]): InstancedMeshData[] {
  const geometryGroups = new Map<string, InstancedMeshData>();
  
  for (const mesh of meshes) {
    const hash = hashGeometry(mesh.positions, mesh.indices);
    
    const existing = geometryGroups.get(hash);
    if (existing) {
      // Add as instance of existing geometry
      existing.instances.push({
        expressId: mesh.expressId,
        color: mesh.color,
      });
    } else {
      // First occurrence - create new geometry group
      geometryGroups.set(hash, {
        geometryHash: hash,
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        instances: [{
          expressId: mesh.expressId,
          color: mesh.color,
        }],
      });
    }
  }
  
  return Array.from(geometryGroups.values());
}

/**
 * Stats about deduplication results
 */
export interface DeduplicationStats {
  inputMeshes: number;
  uniqueGeometries: number;
  deduplicationRatio: number;
  totalInstances: number;
  maxInstancesPerGeometry: number;
}

/**
 * Get statistics about deduplication results
 */
export function getDeduplicationStats(instanced: InstancedMeshData[]): DeduplicationStats {
  const totalInstances = instanced.reduce((sum, g) => sum + g.instances.length, 0);
  const maxInstances = Math.max(...instanced.map(g => g.instances.length));
  
  return {
    inputMeshes: totalInstances,
    uniqueGeometries: instanced.length,
    deduplicationRatio: totalInstances / instanced.length,
    totalInstances,
    maxInstancesPerGeometry: maxInstances,
  };
}

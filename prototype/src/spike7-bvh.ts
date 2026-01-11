/**
 * Spike 7: BVH Spatial Index
 * Goal: Test BVH construction and query performance
 * Success: BVH queries faster than linear scan for large datasets
 */

import { GeometryProcessor } from '@ifc-lite/geometry';
import type { GeometryResult } from '@ifc-lite/geometry';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export interface BVHSpikeResult {
  passed: boolean;
  meshCount: number;
  bvhBuildTimeMs: number;
  linearQueryTimeMs: number;
  bvhQueryTimeMs: number;
  speedup: number;
  queryResultCount: number;
}

/**
 * Simple AABB structure
 */
interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Simple BVH node
 */
interface BVHNode {
  bounds: AABB;
  left?: BVHNode;
  right?: BVHNode;
  meshIndices?: number[];
}

/**
 * Simple BVH implementation for testing
 */
class SimpleBVH {
  private root: BVHNode | null = null;
  private meshes: Array<{ bounds: AABB; expressId: number }> = [];
  
  build(meshes: Array<{ bounds: AABB; expressId: number }>): void {
    this.meshes = meshes;
    if (meshes.length === 0) return;
    
    const indices = meshes.map((_, i) => i);
    this.root = this.buildNode(indices, 0);
  }
  
  private buildNode(indices: number[], depth: number): BVHNode {
    if (indices.length === 0) {
      throw new Error('Empty node');
    }
    
    if (indices.length === 1) {
      return {
        bounds: this.meshes[indices[0]].bounds,
        meshIndices: [indices[0]],
      };
    }
    
    // Compute bounds for all meshes
    const bounds = this.computeBounds(indices);
    
    // Choose split axis (longest axis)
    const extent = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const axis = extent[0] > extent[1] && extent[0] > extent[2] ? 0 :
                 extent[1] > extent[2] ? 1 : 2;
    
    // Sort by center along axis
    indices.sort((a, b) => {
      const centerA = (this.meshes[a].bounds.min[axis] + this.meshes[a].bounds.max[axis]) / 2;
      const centerB = (this.meshes[b].bounds.min[axis] + this.meshes[b].bounds.max[axis]) / 2;
      return centerA - centerB;
    });
    
    // Split in half
    const mid = Math.floor(indices.length / 2);
    const leftIndices = indices.slice(0, mid);
    const rightIndices = indices.slice(mid);
    
    return {
      bounds,
      left: this.buildNode(leftIndices, depth + 1),
      right: this.buildNode(rightIndices, depth + 1),
    };
  }
  
  private computeBounds(indices: number[]): AABB {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const idx of indices) {
      const b = this.meshes[idx].bounds;
      minX = Math.min(minX, b.min[0]);
      minY = Math.min(minY, b.min[1]);
      minZ = Math.min(minZ, b.min[2]);
      maxX = Math.max(maxX, b.max[0]);
      maxY = Math.max(maxY, b.max[1]);
      maxZ = Math.max(maxZ, b.max[2]);
    }
    
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };
  }
  
  queryAABB(queryBounds: AABB): number[] {
    const results: number[] = [];
    if (!this.root) return results;
    
    this.queryNode(this.root, queryBounds, results);
    return results;
  }
  
  private queryNode(node: BVHNode, queryBounds: AABB, results: number[]): void {
    if (!this.intersects(node.bounds, queryBounds)) {
      return;
    }
    
    if (node.meshIndices) {
      // Leaf node - check all meshes
      for (const idx of node.meshIndices) {
        if (this.intersects(this.meshes[idx].bounds, queryBounds)) {
          results.push(this.meshes[idx].expressId);
        }
      }
    } else {
      // Internal node - recurse
      if (node.left) this.queryNode(node.left, queryBounds, results);
      if (node.right) this.queryNode(node.right, queryBounds, results);
    }
  }
  
  private intersects(a: AABB, b: AABB): boolean {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
           a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
           a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  }
}

/**
 * Compute bounding box from mesh data
 */
function computeMeshBounds(mesh: { positions: Float32Array }): AABB {
  const positions = mesh.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Linear scan query (baseline)
 */
function linearQuery(
  meshes: Array<{ bounds: AABB; expressId: number }>,
  queryBounds: AABB
): number[] {
  const results: number[] = [];
  
  for (const mesh of meshes) {
    if (intersectsAABB(mesh.bounds, queryBounds)) {
      results.push(mesh.expressId);
    }
  }
  
  return results;
}

function intersectsAABB(a: AABB, b: AABB): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
         a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
         a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

/**
 * Run BVH spike test
 */
export async function runBVHSpike(file: File): Promise<BVHSpikeResult> {
  console.log('[Spike7] Starting BVH spatial index test...');
  
  // Load geometry
  const buffer = await file.arrayBuffer();
  const processor = new GeometryProcessor();
  
  // Set WASM path for Node.js environment
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(__dirname, '..', 'wasm') + '/';
  await processor.init(wasmPath);
  
  const geometryResult = await processor.process(new Uint8Array(buffer));
  
  const meshCount = geometryResult.meshes.length;
  console.log(`[Spike7] Loaded ${meshCount} meshes`);
  
  if (meshCount === 0) {
    return {
      passed: false,
      meshCount: 0,
      bvhBuildTimeMs: 0,
      linearQueryTimeMs: 0,
      bvhQueryTimeMs: 0,
      speedup: 0,
      queryResultCount: 0,
    };
  }
  
  // Compute bounds for all meshes
  const meshesWithBounds: Array<{ bounds: AABB; expressId: number }> = [];
  for (const mesh of geometryResult.meshes) {
    // Find mesh data (simplified - assume mesh has positions)
    const positions = (mesh as any).positions || new Float32Array(0);
    if (positions.length > 0) {
      const bounds = computeMeshBounds({ positions });
      meshesWithBounds.push({
        bounds,
        expressId: (mesh as any).expressId || 0,
      });
    }
  }
  
  console.log(`[Spike7] Computed bounds for ${meshesWithBounds.length} meshes`);
  
  // === Build BVH ===
  const bvh = new SimpleBVH();
  const buildStart = performance.now();
  bvh.build(meshesWithBounds);
  const bvhBuildTimeMs = performance.now() - buildStart;
  console.log(`[Spike7] BVH build time: ${bvhBuildTimeMs.toFixed(3)}ms`);
  
  // === Query test ===
  // Use a query box that covers about 10% of the scene
  let sceneMinX = Infinity, sceneMinY = Infinity, sceneMinZ = Infinity;
  let sceneMaxX = -Infinity, sceneMaxY = -Infinity, sceneMaxZ = -Infinity;
  
  for (const mesh of meshesWithBounds) {
    sceneMinX = Math.min(sceneMinX, mesh.bounds.min[0]);
    sceneMinY = Math.min(sceneMinY, mesh.bounds.min[1]);
    sceneMinZ = Math.min(sceneMinZ, mesh.bounds.min[2]);
    sceneMaxX = Math.max(sceneMaxX, mesh.bounds.max[0]);
    sceneMaxY = Math.max(sceneMaxY, mesh.bounds.max[1]);
    sceneMaxZ = Math.max(sceneMaxZ, mesh.bounds.max[2]);
  }
  
  const centerX = (sceneMinX + sceneMaxX) / 2;
  const centerY = (sceneMinY + sceneMaxY) / 2;
  const centerZ = (sceneMinZ + sceneMaxZ) / 2;
  const sizeX = (sceneMaxX - sceneMinX) * 0.1;
  const sizeY = (sceneMaxY - sceneMinY) * 0.1;
  const sizeZ = (sceneMaxZ - sceneMinZ) * 0.1;
  
  const queryBounds: AABB = {
    min: [centerX - sizeX / 2, centerY - sizeY / 2, centerZ - sizeZ / 2],
    max: [centerX + sizeX / 2, centerY + sizeY / 2, centerZ + sizeZ / 2],
  };
  
  // Linear query
  const linearStart = performance.now();
  const linearResults = linearQuery(meshesWithBounds, queryBounds);
  const linearQueryTimeMs = performance.now() - linearStart;
  console.log(`[Spike7] Linear query: ${linearQueryTimeMs.toFixed(3)}ms (${linearResults.length} results)`);
  
  // BVH query
  const bvhStart = performance.now();
  const bvhResults = bvh.queryAABB(queryBounds);
  const bvhQueryTimeMs = performance.now() - bvhStart;
  console.log(`[Spike7] BVH query: ${bvhQueryTimeMs.toFixed(3)}ms (${bvhResults.length} results)`);
  
  const speedup = linearQueryTimeMs > 0 ? linearQueryTimeMs / bvhQueryTimeMs : 1;
  const passed = speedup >= 1.0 && bvhResults.length === linearResults.length;
  
  if (!passed) {
    console.warn(`[Spike7] Results mismatch: BVH=${bvhResults.length}, Linear=${linearResults.length}`);
  }
  
  return {
    passed,
    meshCount,
    bvhBuildTimeMs,
    linearQueryTimeMs,
    bvhQueryTimeMs,
    speedup,
    queryResultCount: bvhResults.length,
  };
}

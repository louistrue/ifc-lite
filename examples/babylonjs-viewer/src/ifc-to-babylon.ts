/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Converts @ifc-lite/geometry MeshData into Babylon.js objects.
 *
 * Three rendering strategies are provided:
 *
 *  meshDataToBabylon        — one Mesh per entity (simple, good for picking)
 *  geometryResultToBatched  — merge by color (fewer draw calls, moderate)
 *  batchWithVertexColors    — merge ALL opaque into one draw call via vertex
 *                             colors; transparent grouped by alpha (best perf).
 *                             Returns a triangleMaps index for entity picking.
 */

import {
  Mesh,
  VertexData,
  StandardMaterial,
  TransformNode,
  Color3,
  Vector3,
} from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { MeshData, GeometryResult } from '@ifc-lite/geometry';

/** Map from expressId → Babylon.js mesh, for picking / highlighting */
export type ExpressIdMap = Map<number, Mesh>;

/**
 * Maps a contiguous triangle range within a merged mesh back to an expressId.
 * `start` and `count` are in triangle units (i.e. faceId from scene.pick).
 */
export type TriangleRange = { expressId: number; start: number; count: number };

/**
 * Per-mesh triangle → entity lookup table produced by batchWithVertexColors.
 * Keys are the actual Babylon.js Mesh objects added to the scene.
 */
export type TriangleMaps = Map<Mesh, TriangleRange[]>;

/**
 * Convert a single MeshData into a Babylon.js Mesh.
 */
export function meshDataToBabylon(meshData: MeshData, scene: Scene): Mesh {
  const mesh = new Mesh(`entity-${meshData.expressId}`, scene);

  const vertexData = new VertexData();
  vertexData.positions = meshData.positions;
  vertexData.normals = meshData.normals;
  vertexData.indices = meshData.indices;
  vertexData.applyToMesh(mesh);

  const [r, g, b, a] = meshData.color;
  const material = new StandardMaterial(`mat-${meshData.expressId}`, scene);
  material.diffuseColor = new Color3(r, g, b);
  material.specularColor = new Color3(0, 0, 0);
  if (a < 1) {
    material.alpha = a;
    material.backFaceCulling = false;
  }

  mesh.material = material;
  mesh.metadata = { expressId: meshData.expressId, ifcType: meshData.ifcType };

  return mesh;
}

/**
 * Convert an entire GeometryResult into a Babylon.js TransformNode tree.
 *
 * Returns the root node and an expressId→Mesh map for picking.
 */
export function geometryResultToBatched(result: GeometryResult, scene: Scene): {
  root: TransformNode;
  expressIdMap: ExpressIdMap;
} {
  const root = new TransformNode('model-root', scene);
  const expressIdMap: ExpressIdMap = new Map();

  const colorBuckets = new Map<string, MeshData[]>();
  for (const mesh of result.meshes) {
    const key = mesh.color.join(',');
    let bucket = colorBuckets.get(key);
    if (!bucket) {
      bucket = [];
      colorBuckets.set(key, bucket);
    }
    bucket.push(mesh);
  }

  let bucketIndex = 0;
  for (const [, meshes] of colorBuckets) {
    let totalPositions = 0;
    let totalIndices = 0;
    for (const m of meshes) {
      totalPositions += m.positions.length;
      totalIndices += m.indices.length;
    }

    const positions = new Float32Array(totalPositions);
    const normals = new Float32Array(totalPositions);
    const indices = new Uint32Array(totalIndices);

    let posOffset = 0;
    let idxOffset = 0;
    let vertexOffset = 0;

    for (const m of meshes) {
      positions.set(m.positions, posOffset);
      normals.set(m.normals, posOffset);

      for (let i = 0; i < m.indices.length; i++) {
        indices[idxOffset + i] = m.indices[i] + vertexOffset;
      }

      posOffset += m.positions.length;
      idxOffset += m.indices.length;
      vertexOffset += m.positions.length / 3;
    }

    const batchedMesh = new Mesh(`batch-${bucketIndex++}`, scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.indices = indices;
    vertexData.applyToMesh(batchedMesh);

    const [r, g, b, a] = meshes[0].color;
    const material = new StandardMaterial(`batch-mat-${bucketIndex}`, scene);
    material.diffuseColor = new Color3(r, g, b);
    material.specularColor = new Color3(0, 0, 0);
    if (a < 1) {
      material.alpha = a;
      material.backFaceCulling = false;
    }

    batchedMesh.material = material;
    batchedMesh.parent = root;

    for (const m of meshes) {
      expressIdMap.set(m.expressId, batchedMesh);
    }
  }

  return { root, expressIdMap };
}

/**
 * Highest-performance batching strategy for large models.
 *
 * Merges ALL opaque meshes into a single draw call using a vertex color
 * attribute. Transparent meshes are grouped by alpha value. Alongside the
 * root node, returns a `triangleMaps` index so individual entities can be
 * identified by their Babylon.js scene.pick faceId after the fact — enabling
 * object picking without a separate per-entity geometry layer.
 */
export function batchWithVertexColors(meshes: MeshData[], scene: Scene): {
  root: TransformNode;
  expressIdMap: ExpressIdMap;
  triangleMaps: TriangleMaps;
} {
  const root = new TransformNode('batch-root', scene);
  const expressIdMap: ExpressIdMap = new Map();
  const triangleMaps: TriangleMaps = new Map();

  const opaque = meshes.filter((m) => m.color[3] >= 1);
  const transparent = meshes.filter((m) => m.color[3] < 1);

  if (opaque.length > 0) {
    const { mesh, triangleRanges } = mergeWithVertexColors(opaque, scene, false);
    mesh.parent = root;
    triangleMaps.set(mesh, triangleRanges);
    for (const m of opaque) expressIdMap.set(m.expressId, mesh);
  }

  if (transparent.length > 0) {
    const alphaGroups = new Map<number, MeshData[]>();
    for (const m of transparent) {
      const alpha = Math.round(m.color[3] * 100) / 100;
      let bucket = alphaGroups.get(alpha);
      if (!bucket) {
        bucket = [];
        alphaGroups.set(alpha, bucket);
      }
      bucket.push(m);
    }
    for (const [alpha, group] of alphaGroups) {
      const { mesh, triangleRanges } = mergeWithVertexColors(group, scene, true, alpha);
      mesh.parent = root;
      triangleMaps.set(mesh, triangleRanges);
      for (const m of group) expressIdMap.set(m.expressId, mesh);
    }
  }

  return { root, expressIdMap, triangleMaps };
}

/**
 * Find the expressId for the entity whose triangles contain `faceId`.
 * Uses binary search — O(log n) per pick operation.
 * Returns null if not found.
 */
export function findEntityByFace(
  ranges: TriangleRange[],
  faceId: number,
): number | null {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = ranges[mid];
    if (faceId < r.start) {
      hi = mid - 1;
    } else if (faceId >= r.start + r.count) {
      lo = mid + 1;
    } else {
      return r.expressId;
    }
  }
  return null;
}

/** Merge an array of MeshData into one Mesh with per-vertex RGBA colors. */
function mergeWithVertexColors(
  meshes: MeshData[],
  scene: Scene,
  transparent: boolean,
  opacity = 1,
): { mesh: Mesh; triangleRanges: TriangleRange[] } {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const m of meshes) {
    totalVertices += m.positions.length / 3;
    totalIndices += m.indices.length;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 4); // RGBA for Babylon.js
  const indices = new Uint32Array(totalIndices);

  const triangleRanges: TriangleRange[] = [];
  let vOffset = 0;
  let iOffset = 0;

  for (const m of meshes) {
    const vertCount = m.positions.length / 3;
    const triCount = m.indices.length / 3;

    positions.set(m.positions, vOffset * 3);
    normals.set(m.normals, vOffset * 3);

    const [r, g, b] = m.color;
    for (let v = 0; v < vertCount; v++) {
      colors[(vOffset + v) * 4 + 0] = r;
      colors[(vOffset + v) * 4 + 1] = g;
      colors[(vOffset + v) * 4 + 2] = b;
      colors[(vOffset + v) * 4 + 3] = 1;
    }

    for (let i = 0; i < m.indices.length; i++) {
      indices[iOffset + i] = m.indices[i] + vOffset;
    }

    triangleRanges.push({ expressId: m.expressId, start: iOffset / 3, count: triCount });

    vOffset += vertCount;
    iOffset += m.indices.length;
  }

  const mesh = new Mesh('batched', scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  // White diffuse so vertex colors pass through as the actual surface color.
  // Black specular — no per-fragment specular highlights on large merged meshes.
  const material = new StandardMaterial('batched-mat', scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0, 0, 0);

  if (transparent) {
    material.alpha = opacity;
    material.backFaceCulling = false;
  }

  mesh.material = material;
  mesh.hasVertexAlpha = false; // vertex colors are RGB only, alpha via material

  return { mesh, triangleRanges };
}

/**
 * Dispose a TransformNode and all child meshes, releasing GPU resources.
 */
export function disposeNode(node: TransformNode) {
  const meshes = node.getChildMeshes();
  for (const mesh of meshes) {
    if (mesh.material) mesh.material.dispose();
    mesh.dispose();
  }
  node.dispose();
}

/**
 * Compute the axis-aligned bounding box of all meshes under a node.
 */
export function computeBounds(root: TransformNode): {
  center: Vector3;
  size: Vector3;
  maxDim: number;
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const mesh of root.getChildMeshes()) {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const bMin = bounds.minimumWorld;
    const bMax = bounds.maximumWorld;
    if (bMin.x < minX) minX = bMin.x;
    if (bMin.y < minY) minY = bMin.y;
    if (bMin.z < minZ) minZ = bMin.z;
    if (bMax.x > maxX) maxX = bMax.x;
    if (bMax.y > maxY) maxY = bMax.y;
    if (bMax.z > maxZ) maxZ = bMax.z;
  }

  const size = new Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  const center = new Vector3(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  );
  const maxDim = Math.max(size.x, size.y, size.z);

  return { center, size, maxDim };
}

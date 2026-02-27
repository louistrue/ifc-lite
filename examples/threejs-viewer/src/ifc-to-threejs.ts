/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Converts @ifc-lite/geometry MeshData into Three.js objects.
 *
 * This is the key integration layer — it consumes the engine-agnostic
 * geometry output (Float32Array positions/normals, Uint32Array indices,
 * RGBA color) and builds Three.js BufferGeometry + MeshStandardMaterial.
 */

import * as THREE from 'three';
import type { MeshData, GeometryResult } from '@ifc-lite/geometry';

/** Map from expressId → Three.js mesh, for picking / highlighting */
export type ExpressIdMap = Map<number, THREE.Mesh>;

/**
 * Convert a single MeshData into a Three.js Mesh.
 */
export function meshDataToThree(mesh: MeshData): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(mesh.normals, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  const [r, g, b, a] = mesh.color;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(r, g, b),
    transparent: a < 1,
    opacity: a,
    side: a < 1 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: a >= 1,
  });

  const threeMesh = new THREE.Mesh(geometry, material);
  threeMesh.userData.expressId = mesh.expressId;
  threeMesh.userData.ifcType = mesh.ifcType;

  return threeMesh;
}

/**
 * Convert an entire GeometryResult into a Three.js Group.
 *
 * Returns the group and an expressId→Mesh map for picking.
 */
export function geometryResultToThree(result: GeometryResult): {
  group: THREE.Group;
  expressIdMap: ExpressIdMap;
} {
  const group = new THREE.Group();
  const expressIdMap: ExpressIdMap = new Map();

  for (const mesh of result.meshes) {
    const threeMesh = meshDataToThree(mesh);
    group.add(threeMesh);
    expressIdMap.set(mesh.expressId, threeMesh);
  }

  return { group, expressIdMap };
}

/**
 * Batch meshes by color for fewer draw calls.
 *
 * Groups meshes that share the same RGBA color into merged
 * BufferGeometry objects. For large models this reduces draw calls
 * from thousands to dozens.
 */
export function geometryResultToBatched(result: GeometryResult): {
  group: THREE.Group;
  expressIdMap: ExpressIdMap;
} {
  const group = new THREE.Group();
  const expressIdMap: ExpressIdMap = new Map();

  // Group meshes by color key
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

  for (const [, meshes] of colorBuckets) {
    // Calculate total buffer sizes
    let totalPositions = 0;
    let totalNormals = 0;
    let totalIndices = 0;
    for (const m of meshes) {
      totalPositions += m.positions.length;
      totalNormals += m.normals.length;
      totalIndices += m.indices.length;
    }

    const positions = new Float32Array(totalPositions);
    const normals = new Float32Array(totalNormals);
    const indices = new Uint32Array(totalIndices);

    let posOffset = 0;
    let normOffset = 0;
    let idxOffset = 0;
    let vertexOffset = 0;

    for (const m of meshes) {
      positions.set(m.positions, posOffset);
      normals.set(m.normals, normOffset);

      // Offset indices by accumulated vertex count
      for (let i = 0; i < m.indices.length; i++) {
        indices[idxOffset + i] = m.indices[i] + vertexOffset;
      }

      posOffset += m.positions.length;
      normOffset += m.normals.length;
      idxOffset += m.indices.length;
      vertexOffset += m.positions.length / 3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const [r, g, b, a] = meshes[0].color;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, g, b),
      transparent: a < 1,
      opacity: a,
      side: a < 1 ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: a >= 1,
    });

    const batchedMesh = new THREE.Mesh(geometry, material);
    group.add(batchedMesh);

    // Still track individual meshes for picking (un-batched references)
    for (const m of meshes) {
      const individual = meshDataToThree(m);
      expressIdMap.set(m.expressId, individual);
    }
  }

  return { group, expressIdMap };
}

/**
 * Process streaming geometry events into Three.js.
 *
 * Call this inside a `for await` loop over GeometryProcessor.processStreaming().
 * Each batch of MeshData is converted and added to the scene incrementally.
 */
export function addStreamingBatchToScene(
  meshes: MeshData[],
  scene: THREE.Scene,
  expressIdMap: ExpressIdMap,
): THREE.Group {
  const batchGroup = new THREE.Group();
  for (const mesh of meshes) {
    const threeMesh = meshDataToThree(mesh);
    batchGroup.add(threeMesh);
    expressIdMap.set(mesh.expressId, threeMesh);
  }
  scene.add(batchGroup);
  return batchGroup;
}

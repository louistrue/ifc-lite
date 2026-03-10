/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * GLB content builder for 3D Tiles
 *
 * Packs a set of MeshData into a single GLB (binary glTF 2.0) file
 * suitable for use as 3D Tiles 1.1 tile content.
 */

import type { MeshData } from '@ifc-lite/geometry';

/**
 * Build a GLB binary from a set of meshes.
 * Each mesh becomes a separate node with its expressId stored in extras.
 */
export function buildGlbContent(meshes: MeshData[]): Uint8Array {
  // Collect all geometry into flat arrays
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allIndices: number[] = [];

  interface MeshRange {
    positionOffset: number;
    positionCount: number;
    normalOffset: number;
    normalCount: number;
    indexOffset: number;
    indexCount: number;
    expressId: number;
    color: [number, number, number, number];
  }
  const ranges: MeshRange[] = [];

  for (const mesh of meshes) {
    if (!mesh.positions.length || !mesh.indices.length) continue;

    ranges.push({
      positionOffset: allPositions.length,
      positionCount: mesh.positions.length,
      normalOffset: allNormals.length,
      normalCount: mesh.normals.length,
      indexOffset: allIndices.length,
      indexCount: mesh.indices.length,
      expressId: mesh.expressId,
      color: mesh.color,
    });

    for (let i = 0; i < mesh.positions.length; i++) {
      allPositions.push(mesh.positions[i]);
    }
    for (let i = 0; i < mesh.normals.length; i++) {
      allNormals.push(mesh.normals[i]);
    }
    for (let i = 0; i < mesh.indices.length; i++) {
      allIndices.push(mesh.indices[i]);
    }
  }

  if (ranges.length === 0) {
    return buildEmptyGlb();
  }

  // Build glTF JSON structure
  const accessors: Record<string, unknown>[] = [];
  const meshDefs: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const nodeIndices: number[] = [];

  for (const range of ranges) {
    const vertexCount = range.positionCount / 3;
    const positionByteOffset = range.positionOffset * 4;
    const normalByteOffset = range.normalOffset * 4;
    const indexByteOffset = range.indexOffset * 4;

    // Compute position bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = range.positionOffset; i < range.positionOffset + range.positionCount; i += 3) {
      const x = allPositions[i], y = allPositions[i + 1], z = allPositions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const posAccessorIdx = accessors.length;
    accessors.push({
      bufferView: 0,
      byteOffset: positionByteOffset,
      componentType: 5126, // FLOAT
      count: vertexCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normAccessorIdx = accessors.length;
    accessors.push({
      bufferView: 1,
      byteOffset: normalByteOffset,
      componentType: 5126,
      count: range.normalCount / 3,
      type: 'VEC3',
    });

    const idxAccessorIdx = accessors.length;
    accessors.push({
      bufferView: 2,
      byteOffset: indexByteOffset,
      componentType: 5125, // UNSIGNED_INT
      count: range.indexCount,
      type: 'SCALAR',
    });

    // Material with mesh color
    const meshIdx = meshDefs.length;
    meshDefs.push({
      primitives: [{
        attributes: { POSITION: posAccessorIdx, NORMAL: normAccessorIdx },
        indices: idxAccessorIdx,
      }],
    });

    const nodeIdx = nodes.length;
    nodes.push({
      mesh: meshIdx,
      extras: { expressId: range.expressId },
    });
    nodeIndices.push(nodeIdx);
  }

  // Build binary buffer
  const positionsArray = new Float32Array(allPositions);
  const normalsArray = new Float32Array(allNormals);
  const indicesArray = new Uint32Array(allIndices);

  const posBytes = positionsArray.byteLength;
  const normBytes = normalsArray.byteLength;
  const idxBytes = indicesArray.byteLength;
  const totalBinSize = posBytes + normBytes + idxBytes;

  const gltf = {
    asset: { version: '2.0', generator: 'IFC-Lite 3D Tiles' },
    scene: 0,
    scenes: [{ nodes: nodeIndices }],
    nodes,
    meshes: meshDefs,
    accessors,
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, byteStride: 12, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: normBytes, byteStride: 12, target: 34962 },
      { buffer: 0, byteOffset: posBytes + normBytes, byteLength: idxBytes, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinSize }],
  };

  return packGlb(gltf, positionsArray, normalsArray, indicesArray);
}

function buildEmptyGlb(): Uint8Array {
  const gltf = {
    asset: { version: '2.0', generator: 'IFC-Lite 3D Tiles' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  return packGlb(gltf);
}

function packGlb(
  gltfJson: Record<string, unknown>,
  positions?: Float32Array,
  normals?: Float32Array,
  indices?: Uint32Array,
): Uint8Array {
  const jsonString = JSON.stringify(gltfJson);
  const jsonBuffer = new TextEncoder().encode(jsonString);
  const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
  const paddedJsonLength = jsonBuffer.byteLength + jsonPadding;

  const hasBin = positions && normals && indices;
  const binLength = hasBin
    ? positions.byteLength + normals.byteLength + indices.byteLength
    : 0;
  const binPadding = (4 - (binLength % 4)) % 4;
  const paddedBinLength = binLength + binPadding;

  const totalLength = 12 + 8 + paddedJsonLength + (hasBin ? 8 + paddedBinLength : 0);
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);

  let offset = 0;

  // GLB header
  view.setUint32(offset, 0x46546C67, true); // 'glTF'
  offset += 4;
  view.setUint32(offset, 2, true); // version
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
  for (let i = 0; i < jsonPadding; i++) bytes[offset++] = 0x20;

  // BIN chunk
  if (hasBin) {
    view.setUint32(offset, paddedBinLength, true);
    offset += 4;
    view.setUint32(offset, 0x004E4942, true); // 'BIN\0'
    offset += 4;
    bytes.set(new Uint8Array(positions.buffer), offset);
    offset += positions.byteLength;
    bytes.set(new Uint8Array(normals.buffer), offset);
    offset += normals.byteLength;
    bytes.set(new Uint8Array(indices.buffer), offset);
  }

  return new Uint8Array(glb);
}

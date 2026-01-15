/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry serialization
 */

import type { MeshData, CoordinateInfo, Vec3, AABB } from '@ifc-lite/geometry';
import { BufferWriter, BufferReader } from '../utils/buffer-utils.js';

/**
 * Write geometry data to buffer
 * Format:
 *   - meshCount: uint32
 *   - totalVertices: uint32
 *   - totalTriangles: uint32
 *   - coordinateInfo (see below)
 *   - per mesh:
 *     - expressId: uint32
 *     - vertexCount: uint32
 *     - indexCount: uint32
 *     - color: float32[4]
 *     - positions: Float32Array[vertexCount * 3]
 *     - normals: Float32Array[vertexCount * 3]
 *     - indices: Uint32Array[indexCount]
 */
export function writeGeometry(
  writer: BufferWriter,
  meshes: MeshData[],
  totalVertices: number,
  totalTriangles: number,
  coordinateInfo: CoordinateInfo
): void {
  writer.writeUint32(meshes.length);
  writer.writeUint32(totalVertices);
  writer.writeUint32(totalTriangles);

  // Write coordinate info
  writeCoordinateInfo(writer, coordinateInfo);

  // Write each mesh
  for (const mesh of meshes) {
    writer.writeUint32(mesh.expressId);

    const vertexCount = mesh.positions.length / 3;
    const indexCount = mesh.indices.length;

    writer.writeUint32(vertexCount);
    writer.writeUint32(indexCount);

    // Write color (RGBA)
    writer.writeFloat32(mesh.color[0]);
    writer.writeFloat32(mesh.color[1]);
    writer.writeFloat32(mesh.color[2]);
    writer.writeFloat32(mesh.color[3]);

    // Write ifcType (as string length + UTF-8 bytes)
    const ifcType = mesh.ifcType || '';
    writer.writeString(ifcType);

    // Write geometry arrays
    writer.writeTypedArray(mesh.positions);
    writer.writeTypedArray(mesh.normals);
    writer.writeTypedArray(mesh.indices);
  }
}

function writeCoordinateInfo(writer: BufferWriter, info: CoordinateInfo): void {
  // Origin shift
  writeVec3(writer, info.originShift);

  // Original bounds
  writeAABB(writer, info.originalBounds);

  // Shifted bounds
  writeAABB(writer, info.shiftedBounds);

  // Is geo-referenced flag
  writer.writeUint8(info.isGeoReferenced ? 1 : 0);
}

function writeVec3(writer: BufferWriter, v: Vec3): void {
  writer.writeFloat64(v.x);
  writer.writeFloat64(v.y);
  writer.writeFloat64(v.z);
}

function writeAABB(writer: BufferWriter, aabb: AABB): void {
  writeVec3(writer, aabb.min);
  writeVec3(writer, aabb.max);
}

/**
 * Read geometry data from buffer
 */
export function readGeometry(reader: BufferReader, version: number = 2): {
  meshes: MeshData[];
  totalVertices: number;
  totalTriangles: number;
  coordinateInfo: CoordinateInfo;
} {
  const meshCount = reader.readUint32();
  const totalVertices = reader.readUint32();
  const totalTriangles = reader.readUint32();

  const coordinateInfo = readCoordinateInfo(reader);

  const meshes: MeshData[] = [];

  for (let i = 0; i < meshCount; i++) {
    const expressId = reader.readUint32();
    const vertexCount = reader.readUint32();
    const indexCount = reader.readUint32();

    const color: [number, number, number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];

    // Read ifcType (only in version 2+)
    let ifcType: string | undefined = undefined;
    if (version >= 2) {
      ifcType = reader.readString() || undefined;
    }

    const positions = reader.readFloat32Array(vertexCount * 3);
    const normals = reader.readFloat32Array(vertexCount * 3);
    const indices = reader.readUint32Array(indexCount);

    meshes.push({
      expressId,
      positions,
      normals,
      indices,
      color,
      ifcType,
    });
  }

  return {
    meshes,
    totalVertices,
    totalTriangles,
    coordinateInfo,
  };
}

function readCoordinateInfo(reader: BufferReader): CoordinateInfo {
  const originShift = readVec3(reader);
  const originalBounds = readAABB(reader);
  const shiftedBounds = readAABB(reader);
  const isGeoReferenced = reader.readUint8() === 1;

  return {
    originShift,
    originalBounds,
    shiftedBounds,
    isGeoReferenced,
  };
}

function readVec3(reader: BufferReader): Vec3 {
  return {
    x: reader.readFloat64(),
    y: reader.readFloat64(),
    z: reader.readFloat64(),
  };
}

function readAABB(reader: BufferReader): AABB {
  return {
    min: readVec3(reader),
    max: readVec3(reader),
  };
}

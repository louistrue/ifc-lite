/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { GeometryResult, HugeGeometryEntityInfo, HugeGeometryStats } from '@ifc-lite/geometry';
import type { FederatedModel } from '../store/types.js';

export interface GeometryEntityBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export function getGeometryElementCount(
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryStats?: HugeGeometryStats | null,
): number {
  return hugeGeometryStats?.totalElements ?? geometryResult?.meshes.length ?? 0;
}

export function getGeometryTriangleCount(
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryStats?: HugeGeometryStats | null,
): number {
  return hugeGeometryStats?.totalTriangles ?? geometryResult?.totalTriangles ?? 0;
}

export function hasGeometryLoaded(
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryStats?: HugeGeometryStats | null,
): boolean {
  return getGeometryElementCount(geometryResult, hugeGeometryStats) > 0;
}

export function getGeometryEntityIds(
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryEntities?: Map<number, HugeGeometryEntityInfo> | null,
): number[] {
  if (hugeGeometryEntities && hugeGeometryEntities.size > 0) {
    return Array.from(hugeGeometryEntities.keys());
  }
  return geometryResult?.meshes.map((mesh) => mesh.expressId) ?? [];
}

export function getGeometryEntityInfos(
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryEntities?: Map<number, HugeGeometryEntityInfo> | null,
): HugeGeometryEntityInfo[] {
  if (hugeGeometryEntities && hugeGeometryEntities.size > 0) {
    return Array.from(hugeGeometryEntities.values());
  }
  return (
    geometryResult?.meshes.map((mesh) => ({
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      color: mesh.color,
      boundsMin: [0, 0, 0] as [number, number, number],
      boundsMax: [0, 0, 0] as [number, number, number],
    })) ?? []
  );
}

export function getGeometryEntityInfo(
  expressId: number,
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryEntities?: Map<number, HugeGeometryEntityInfo> | null,
): HugeGeometryEntityInfo | null {
  const hugeEntry = hugeGeometryEntities?.get(expressId);
  if (hugeEntry) return hugeEntry;

  const mesh = geometryResult?.meshes.find((entry) => entry.expressId === expressId);
  if (!mesh) return null;

  return {
    expressId: mesh.expressId,
    ifcType: mesh.ifcType,
    modelIndex: mesh.modelIndex,
    color: mesh.color,
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
  };
}

export function getGeometryEntityBounds(
  expressId: number,
  geometryResult: GeometryResult | null | undefined,
  hugeGeometryEntities?: Map<number, HugeGeometryEntityInfo> | null,
): GeometryEntityBounds | null {
  const hugeEntry = hugeGeometryEntities?.get(expressId);
  if (hugeEntry) {
    return {
      min: {
        x: hugeEntry.boundsMin[0],
        y: hugeEntry.boundsMin[1],
        z: hugeEntry.boundsMin[2],
      },
      max: {
        x: hugeEntry.boundsMax[0],
        y: hugeEntry.boundsMax[1],
        z: hugeEntry.boundsMax[2],
      },
    };
  }

  const meshes = geometryResult?.meshes.filter((entry) => entry.expressId === expressId);
  if (!meshes || meshes.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const mesh of meshes) {
    const positions = mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return null;
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

export function getModelGeometryElementCount(model: FederatedModel): number {
  return getGeometryElementCount(model.geometryResult, model.hugeGeometryStats);
}

export function hasModelGeometryLoaded(model: FederatedModel): boolean {
  return hasGeometryLoaded(model.geometryResult, model.hugeGeometryStats);
}

export function modelHasIfcTypeGeometry(model: FederatedModel, ifcType: string): boolean {
  return getGeometryEntityInfos(model.geometryResult, model.hugeGeometryEntities)
    .some((entity) => entity.ifcType === ifcType);
}

export function hasIfcTypeGeometry(
  geometryResult: GeometryResult | null | undefined,
  ifcType: string,
  hugeGeometryEntities?: Map<number, HugeGeometryEntityInfo> | null,
): boolean {
  return getGeometryEntityInfos(geometryResult, hugeGeometryEntities)
    .some((entity) => entity.ifcType === ifcType);
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core IFC clash detection engine.
 *
 * Uses a two-phase approach:
 * 1. Broad phase: AABB overlap test to find candidate pairs
 * 2. Narrow phase: Triangle-triangle intersection for geometric confirmation
 *
 * The narrow phase runs for both 'collision' and 'intersection' modes to avoid
 * false positives from adjacent elements whose bounding boxes overlap but
 * whose actual geometry doesn't intersect.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData } from '@ifc-lite/geometry';
import { IFC_ENTITY_NAMES } from '@ifc-lite/data';
import { AABBUtils, type AABB } from '@ifc-lite/spatial';
import type {
  ClashSettings,
  ClashSet,
  ClashResult,
  Clash,
  ClashElement,
} from './types.js';
import { DEFAULT_CLASH_SETTINGS } from './types.js';

interface ElementMesh {
  expressId: number;
  globalId: string;
  type: string;
  name: string;
  file: string;
  bounds: AABB;
  mesh: MeshData;
}

/**
 * Run clash detection between element groups.
 *
 * @param clashSets  One or more clash set definitions
 * @param stores     Map of file path → { store, meshes } for each referenced file
 * @param settings   Clash detection settings
 */
export function detectClashes(
  clashSets: ClashSet[],
  stores: Map<string, { store: IfcDataStore; meshes: MeshData[] }>,
  settings?: ClashSettings,
): ClashResult {
  const opts: Required<ClashSettings> = { ...DEFAULT_CLASH_SETTINGS, ...settings };
  const allClashes: Clash[] = [];

  for (const clashSet of clashSets) {
    const groupA = buildElementGroup(clashSet.a.file, clashSet.a.types, clashSet.a.globalIds, stores);
    const groupB = clashSet.b
      ? buildElementGroup(clashSet.b.file, clashSet.b.types, clashSet.b.globalIds, stores)
      : null;

    const clashes = groupB
      ? checkGroupPair(groupA, groupB, clashSet.name, opts)
      : checkWithinGroup(groupA, clashSet.name, opts);

    allClashes.push(...clashes);
  }

  // Build summary
  const byClashSet: Record<string, number> = {};
  const byTypePair: Record<string, number> = {};

  for (const clash of allClashes) {
    byClashSet[clash.clashSet] = (byClashSet[clash.clashSet] ?? 0) + 1;

    const pair = [clash.a.type, clash.b.type].sort().join(' vs ');
    byTypePair[pair] = (byTypePair[pair] ?? 0) + 1;
  }

  return {
    clashes: allClashes,
    summary: {
      totalClashes: allClashes.length,
      byClashSet,
      byTypePair,
    },
    settings: opts,
  };
}

function buildElementGroup(
  file: string,
  types: string[] | undefined,
  globalIds: string[] | undefined,
  stores: Map<string, { store: IfcDataStore; meshes: MeshData[] }>,
): ElementMesh[] {
  const entry = stores.get(file);
  if (!entry) {
    throw new Error(`Clash set references file "${file}" but no store/geometry was loaded for it. Ensure the model has geometry before running clash detection.`);
  }

  const { store, meshes } = entry;

  // Build expressId → mesh lookup
  const meshMap = new Map<number, MeshData>();
  for (const m of meshes) {
    meshMap.set(m.expressId, m);
  }

  // Build type filter set (normalize to uppercase for matching)
  const typeFilterSet = types
    ? new Set(types.map(t => t.toUpperCase()))
    : null;

  // Build globalId filter set
  const gidFilterSet = globalIds ? new Set(globalIds) : null;

  const elements: ElementMesh[] = [];

  for (const [typeName, ids] of store.entityIndex.byType) {
    for (const id of ids) {
      // Use canonical type name from store (proper PascalCase)
      const displayName = store.entities.getTypeName(id) || IFC_ENTITY_NAMES[typeName] || typeName;

      // Apply type filter
      if (typeFilterSet) {
        if (!typeFilterSet.has(typeName) && !typeFilterSet.has(displayName.toUpperCase())) {
          continue;
        }
      }

      const mesh = meshMap.get(id);
      if (!mesh || mesh.positions.length === 0) continue;

      const gid = store.entities.getGlobalId(id);
      if (!gid) continue;

      // Apply globalId filter
      if (gidFilterSet && !gidFilterSet.has(gid)) continue;

      const bounds = computeBounds(mesh);
      const name = store.entities.getName(id) || '';
      elements.push({
        expressId: id,
        globalId: gid,
        type: displayName,
        name,
        file,
        bounds,
        mesh,
      });
    }
  }

  return elements;
}

function checkGroupPair(
  groupA: ElementMesh[],
  groupB: ElementMesh[],
  clashSetName: string,
  opts: Required<ClashSettings>,
): Clash[] {
  const clashes: Clash[] = [];
  // Deduplicate same-file pairs to avoid (A,B) and (B,A) duplicates
  const seenPairs = new Set<string>();

  for (const elemA of groupA) {
    for (const elemB of groupB) {
      // Skip same element
      if (elemA.expressId === elemB.expressId && elemA.file === elemB.file) continue;

      // Canonical pair key to avoid duplicate (A,B)/(B,A) for same-file groups
      if (elemA.file === elemB.file) {
        const lo = Math.min(elemA.expressId, elemB.expressId);
        const hi = Math.max(elemA.expressId, elemB.expressId);
        const key = `${elemA.file}:${lo}:${hi}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
      }

      const clash = testClash(elemA, elemB, clashSetName, opts);
      if (clash) {
        clashes.push(clash);
        if (!opts.checkAll) break;
      }
    }
  }

  return clashes;
}

function checkWithinGroup(
  group: ElementMesh[],
  clashSetName: string,
  opts: Required<ClashSettings>,
): Clash[] {
  const clashes: Clash[] = [];

  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const clash = testClash(group[i], group[j], clashSetName, opts);
      if (clash) {
        clashes.push(clash);
        if (!opts.checkAll) break;
      }
    }
  }

  return clashes;
}

function testClash(
  elemA: ElementMesh,
  elemB: ElementMesh,
  clashSetName: string,
  opts: Required<ClashSettings>,
): Clash | null {
  const boundsA = elemA.bounds;
  const boundsB = elemB.bounds;

  if (opts.mode === 'clearance') {
    // Expand bounds by clearance distance and check overlap
    const expandedA: AABB = {
      min: [boundsA.min[0] - opts.clearance, boundsA.min[1] - opts.clearance, boundsA.min[2] - opts.clearance],
      max: [boundsA.max[0] + opts.clearance, boundsA.max[1] + opts.clearance, boundsA.max[2] + opts.clearance],
    };

    if (!AABBUtils.intersects(expandedA, boundsB)) return null;

    // Compute approximate distance between AABBs
    const dist = aabbDistance(boundsA, boundsB);

    // If elements actually intersect beyond tolerance, don't report as clearance issue
    // (use 'collision' or 'intersection' mode for actual overlaps)
    if (dist < 0 && Math.abs(dist) > opts.tolerance) return null;

    // Within clearance threshold
    if (dist <= opts.clearance) {
      return buildClash(elemA, elemB, dist, clashSetName);
    }

    return null;
  }

  // ── Collision / intersection mode ──

  // Broad phase: AABB overlap check
  if (!AABBUtils.intersects(boundsA, boundsB)) return null;

  // Skip elements that merely touch (within tolerance)
  const dist = aabbDistance(boundsA, boundsB);
  if (opts.allowTouching && dist >= -opts.tolerance) return null;

  // Narrow phase: triangle-level intersection test.
  // This is critical to avoid false positives — adjacent walls, slabs, and beams
  // routinely have overlapping AABBs without their actual geometry intersecting.
  if (!triangleIntersectionTest(elemA.mesh, elemB.mesh, opts.tolerance)) return null;

  return buildClash(elemA, elemB, dist, clashSetName);
}

function buildClash(
  elemA: ElementMesh,
  elemB: ElementMesh,
  distance: number,
  clashSetName: string,
): Clash {
  const centerA = AABBUtils.center(elemA.bounds);
  const centerB = AABBUtils.center(elemB.bounds);
  const point: [number, number, number] = [
    (centerA[0] + centerB[0]) / 2,
    (centerA[1] + centerB[1]) / 2,
    (centerA[2] + centerB[2]) / 2,
  ];

  return {
    a: toClashElement(elemA),
    b: toClashElement(elemB),
    distance,
    point,
    clashSet: clashSetName,
  };
}

function toClashElement(elem: ElementMesh): ClashElement {
  return {
    expressId: elem.expressId,
    globalId: elem.globalId,
    type: elem.type,
    name: elem.name,
    file: elem.file,
  };
}

/**
 * Approximate signed distance between two AABBs.
 * Negative = penetration depth, positive = gap, zero = touching.
 *
 * Penetration depth uses the minimum overlap across axes (the smallest
 * axis overlap determines the separation vector).
 */
function aabbDistance(a: AABB, b: AABB): number {
  let sqDist = 0;
  let minOverlap = Infinity;
  let hasPenetration = true;

  for (let i = 0; i < 3; i++) {
    const gap = Math.max(b.min[i] - a.max[i], a.min[i] - b.max[i]);
    if (gap > 0) {
      sqDist += gap * gap;
      hasPenetration = false;
    } else {
      // Overlap on this axis — track minimum for correct penetration depth
      const overlap = Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
      minOverlap = Math.min(minOverlap, overlap);
    }
  }

  if (hasPenetration) return -minOverlap;
  return Math.sqrt(sqDist);
}

/**
 * Triangle-triangle intersection test between two meshes.
 *
 * Uses sampling for large meshes to bound computation. For meshes with
 * fewer than ~100 triangles each, all pairs are tested exhaustively.
 * For larger meshes, a representative sample is tested which may produce
 * false negatives on complex geometry.
 *
 * @param tolerance  Minimum penetration depth to consider a real clash
 */
function triangleIntersectionTest(meshA: MeshData, meshB: MeshData, tolerance: number = 0): boolean {
  const trisA = meshA.indices.length / 3;
  const trisB = meshB.indices.length / 3;

  if (trisA === 0 || trisB === 0) return false;

  // For small meshes, test all pairs. For large meshes, sample.
  const maxChecks = 50000;
  const totalPairs = trisA * trisB;
  const stepA = totalPairs <= maxChecks ? 1 : Math.max(1, Math.floor(trisA / Math.sqrt(maxChecks)));
  const stepB = totalPairs <= maxChecks ? 1 : Math.max(1, Math.floor(trisB / Math.sqrt(maxChecks)));

  for (let ia = 0; ia < trisA; ia += stepA) {
    const a0 = getVertex(meshA, meshA.indices[ia * 3]);
    const a1 = getVertex(meshA, meshA.indices[ia * 3 + 1]);
    const a2 = getVertex(meshA, meshA.indices[ia * 3 + 2]);

    for (let ib = 0; ib < trisB; ib += stepB) {
      const b0 = getVertex(meshB, meshB.indices[ib * 3]);
      const b1 = getVertex(meshB, meshB.indices[ib * 3 + 1]);
      const b2 = getVertex(meshB, meshB.indices[ib * 3 + 2]);

      if (trianglesIntersect(a0, a1, a2, b0, b1, b2, tolerance)) {
        return true;
      }
    }
  }

  return false;
}

type Vec3 = [number, number, number];

function getVertex(mesh: MeshData, index: number): Vec3 {
  const i = index * 3;
  return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Separating Axis Theorem (SAT) triangle-triangle intersection test.
 *
 * Tests 13 potential separating axes (2 face normals + 9 edge cross products).
 * A tolerance parameter allows ignoring coplanar faces that merely touch.
 */
function trianglesIntersect(
  a0: Vec3, a1: Vec3, a2: Vec3,
  b0: Vec3, b1: Vec3, b2: Vec3,
  tolerance: number = 0,
): boolean {
  const edgesA = [sub(a1, a0), sub(a2, a1), sub(a0, a2)];
  const edgesB = [sub(b1, b0), sub(b2, b1), sub(b0, b2)];
  const normalA = cross(edgesA[0], edgesA[1]);
  const normalB = cross(edgesB[0], edgesB[1]);

  // Test face normals as separating axes
  const axes: Vec3[] = [normalA, normalB];

  // Test edge cross products as separating axes
  for (const eA of edgesA) {
    for (const eB of edgesB) {
      const axis = cross(eA, eB);
      const len = Math.sqrt(dot(axis, axis));
      if (len > 1e-10) {
        axes.push([axis[0] / len, axis[1] / len, axis[2] / len]);
      }
    }
  }

  const vertsA = [a0, a1, a2];
  const vertsB = [b0, b1, b2];

  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity;
    let minB = Infinity, maxB = -Infinity;

    for (const v of vertsA) {
      const p = dot(v, axis);
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    for (const v of vertsB) {
      const p = dot(v, axis);
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }

    // Separating axis found — no intersection.
    // Use tolerance to filter out coplanar faces that barely touch.
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap < tolerance) return false;
  }

  return true;
}

function computeBounds(mesh: MeshData): AABB {
  const positions = mesh.positions;
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

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

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

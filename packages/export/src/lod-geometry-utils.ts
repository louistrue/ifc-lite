/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Vec3 } from './lod-geometry-types.js';

export type IfcInput = ArrayBuffer | Uint8Array | string;

/** Read an IFC file from a path, ArrayBuffer, or Uint8Array into an ArrayBuffer. */
export async function readIfcInput(input: IfcInput): Promise<ArrayBuffer> {
  if (typeof input === 'string') {
    // Node-only path reading (dynamic import so browser bundles don't include fs)
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(input);
    // Copy into tightly-sized buffer (fs.readFile may return a larger underlying ArrayBuffer)
    return new Uint8Array(buf).buffer as ArrayBuffer;
  }
  if (input instanceof ArrayBuffer) return input;
  // Uint8Array view — avoid copy when already covering the entire buffer
  if (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength) {
    return input.buffer as ArrayBuffer;
  }
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

/**
 * Normalize IFC type names to canonical PascalCase (e.g. "IFCWALL" → "IfcWall").
 * For multi-word uppercase types (e.g. "IFCWALLSTANDARDCASE") we pass through
 * as-is since we cannot recover PascalCase without a full type registry lookup.
 */
export function normalizeIfcTypeName(typeName: string): string {
  const s = String(typeName || '').trim();
  if (!s) return '';
  // Already in PascalCase (e.g. "IfcWall", "IfcWallStandardCase")
  if (s.startsWith('Ifc') && s.length > 3 && s[3] >= 'A' && s[3] <= 'Z') return s;
  // Pass through as-is — uppercase form is valid for matching
  return s;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vec3Len(a: Vec3): number {
  return Math.sqrt(vec3Dot(a, a));
}

export function vec3Normalize(a: Vec3, fallback: Vec3): Vec3 {
  const l = vec3Len(a);
  if (!Number.isFinite(l) || l <= 1e-12) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function mat4Identity(): Float64Array {
  return new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** Row-major 4x4 multiply: out = a * b */
export function mat4Mul(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    const r0 = r * 4;
    for (let c = 0; c < 4; c++) {
      o[r0 + c] =
        a[r0 + 0] * b[0 * 4 + c] +
        a[r0 + 1] * b[1 * 4 + c] +
        a[r0 + 2] * b[2 * 4 + c] +
        a[r0 + 3] * b[3 * 4 + c];
    }
  }
  return o;
}

export function mat4FromBasisTranslation(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3, t: Vec3): Float64Array {
  // Row-major, columns are basis vectors (x,y,z), last column is translation.
  return new Float64Array([
    xAxis[0], yAxis[0], zAxis[0], t[0],
    xAxis[1], yAxis[1], zAxis[1], t[1],
    xAxis[2], yAxis[2], zAxis[2], t[2],
    0, 0, 0, 1,
  ]);
}

export function mat4TransformPoint(m: Float64Array, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

export function aabbFromPoints(points: Vec3[]): { min: Vec3; max: Vec3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
  }
  if (!Number.isFinite(minX)) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}


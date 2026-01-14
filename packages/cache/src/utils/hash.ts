/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * xxHash64 implementation for source file validation
 * Based on the xxHash algorithm by Yann Collet
 */

const PRIME64_1 = 0x9E3779B185EBCA87n;
const PRIME64_2 = 0xC2B2AE3D27D4EB4Fn;
const PRIME64_3 = 0x165667B19E3779F9n;
const PRIME64_4 = 0x85EBCA77C2B2AE63n;
const PRIME64_5 = 0x27D4EB2F165667C5n;

function rotl64(x: bigint, r: number): bigint {
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & 0xFFFFFFFFFFFFFFFFn;
}

function round64(acc: bigint, input: bigint): bigint {
  acc = (acc + input * PRIME64_2) & 0xFFFFFFFFFFFFFFFFn;
  acc = rotl64(acc, 31);
  acc = (acc * PRIME64_1) & 0xFFFFFFFFFFFFFFFFn;
  return acc;
}

function mergeRound64(acc: bigint, val: bigint): bigint {
  val = round64(0n, val);
  acc = (acc ^ val) & 0xFFFFFFFFFFFFFFFFn;
  acc = (acc * PRIME64_1 + PRIME64_4) & 0xFFFFFFFFFFFFFFFFn;
  return acc;
}

function avalanche64(h: bigint): bigint {
  h = (h ^ (h >> 33n)) & 0xFFFFFFFFFFFFFFFFn;
  h = (h * PRIME64_2) & 0xFFFFFFFFFFFFFFFFn;
  h = (h ^ (h >> 29n)) & 0xFFFFFFFFFFFFFFFFn;
  h = (h * PRIME64_3) & 0xFFFFFFFFFFFFFFFFn;
  h = (h ^ (h >> 32n)) & 0xFFFFFFFFFFFFFFFFn;
  return h;
}

/**
 * Compute xxHash64 of a buffer
 * @param data - Input data as ArrayBuffer or Uint8Array
 * @param seed - Optional seed value (default: 0)
 * @returns 64-bit hash as bigint
 */
export function xxhash64(data: ArrayBuffer | Uint8Array, seed: bigint = 0n): bigint {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let h64: bigint;
  let offset = 0;

  if (len >= 32) {
    let v1 = (seed + PRIME64_1 + PRIME64_2) & 0xFFFFFFFFFFFFFFFFn;
    let v2 = (seed + PRIME64_2) & 0xFFFFFFFFFFFFFFFFn;
    let v3 = seed;
    let v4 = (seed - PRIME64_1) & 0xFFFFFFFFFFFFFFFFn;

    const limit = len - 32;
    while (offset <= limit) {
      v1 = round64(v1, view.getBigUint64(offset, true));
      v2 = round64(v2, view.getBigUint64(offset + 8, true));
      v3 = round64(v3, view.getBigUint64(offset + 16, true));
      v4 = round64(v4, view.getBigUint64(offset + 24, true));
      offset += 32;
    }

    h64 = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18);
    h64 = h64 & 0xFFFFFFFFFFFFFFFFn;
    h64 = mergeRound64(h64, v1);
    h64 = mergeRound64(h64, v2);
    h64 = mergeRound64(h64, v3);
    h64 = mergeRound64(h64, v4);
  } else {
    h64 = (seed + PRIME64_5) & 0xFFFFFFFFFFFFFFFFn;
  }

  h64 = (h64 + BigInt(len)) & 0xFFFFFFFFFFFFFFFFn;

  // Process remaining 8-byte chunks
  while (offset + 8 <= len) {
    const k1 = round64(0n, view.getBigUint64(offset, true));
    h64 = (h64 ^ k1) & 0xFFFFFFFFFFFFFFFFn;
    h64 = (rotl64(h64, 27) * PRIME64_1 + PRIME64_4) & 0xFFFFFFFFFFFFFFFFn;
    offset += 8;
  }

  // Process remaining 4-byte chunk
  if (offset + 4 <= len) {
    h64 = (h64 ^ (BigInt(view.getUint32(offset, true)) * PRIME64_1)) & 0xFFFFFFFFFFFFFFFFn;
    h64 = (rotl64(h64, 23) * PRIME64_2 + PRIME64_3) & 0xFFFFFFFFFFFFFFFFn;
    offset += 4;
  }

  // Process remaining bytes
  while (offset < len) {
    h64 = (h64 ^ (BigInt(bytes[offset]) * PRIME64_5)) & 0xFFFFFFFFFFFFFFFFn;
    h64 = (rotl64(h64, 11) * PRIME64_1) & 0xFFFFFFFFFFFFFFFFn;
    offset++;
  }

  return avalanche64(h64);
}

/**
 * Compute xxHash64 and return as hex string
 */
export function xxhash64Hex(data: ArrayBuffer | Uint8Array, seed: bigint = 0n): string {
  return xxhash64(data, seed).toString(16).padStart(16, '0');
}

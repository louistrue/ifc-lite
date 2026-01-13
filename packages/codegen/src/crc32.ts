/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CRC32 Type ID Generator
 *
 * Generates consistent CRC32 hashes for IFC type names.
 * Used for fast O(1) type lookup in both TypeScript and Rust.
 *
 * This matches the algorithm used by web-ifc for compatibility.
 */

// Pre-computed CRC32 lookup table (IEEE polynomial)
const CRC32_TABLE = buildCRC32Table();

function buildCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

/**
 * Calculate CRC32 hash for a string
 * @param str Input string (will be uppercased)
 * @returns 32-bit unsigned integer hash
 */
export function crc32(str: string): number {
  const upper = str.toUpperCase();
  let crc = 0xffffffff;
  for (let i = 0; i < upper.length; i++) {
    crc = CRC32_TABLE[(crc ^ upper.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Generate type IDs for all entities in a schema
 */
export function generateTypeIds(entityNames: string[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const name of entityNames) {
    ids.set(name, crc32(name));
  }
  return ids;
}

/**
 * Check for CRC32 collisions in a list of names
 * @returns Map of hash -> names[] for any collisions
 */
export function findCollisions(names: string[]): Map<number, string[]> {
  const hashToNames = new Map<number, string[]>();

  for (const name of names) {
    const hash = crc32(name);
    const existing = hashToNames.get(hash) || [];
    existing.push(name);
    hashToNames.set(hash, existing);
  }

  // Filter to only collisions
  const collisions = new Map<number, string[]>();
  for (const [hash, nameList] of hashToNames) {
    if (nameList.length > 1) {
      collisions.set(hash, nameList);
    }
  }

  return collisions;
}

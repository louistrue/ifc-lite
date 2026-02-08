/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity table - columnar storage for IFC entities
 * Uses TypedArrays for cache-efficient bulk operations
 */

import type { StringTable } from './string-table.js';
import { IfcTypeEnum, EntityFlags, IfcTypeEnumFromString, IfcTypeEnumToString } from './types.js';

export interface EntityTable {
  readonly count: number;

  expressId: Uint32Array;
  typeEnum: Uint16Array;
  globalId: Uint32Array;
  name: Uint32Array;
  description: Uint32Array;
  objectType: Uint32Array;
  flags: Uint8Array;

  containedInStorey: Int32Array;
  definedByType: Int32Array;
  geometryIndex: Int32Array;

  typeRanges: Map<IfcTypeEnum, { start: number; end: number }>;

  getGlobalId(expressId: number): string;
  getName(expressId: number): string;
  getDescription(expressId: number): string;
  getObjectType(expressId: number): string;
  getTypeName(expressId: number): string;
  hasGeometry(expressId: number): boolean;
  getByType(type: IfcTypeEnum): number[];

  /** Get expressId by IFC GlobalId string (22-char GUID). Returns -1 if not found. */
  getExpressIdByGlobalId(globalId: string): number;

  /** Get all GlobalId → expressId mappings (for BCF integration) */
  getGlobalIdMap(): Map<string, number>;
}

export class EntityTableBuilder {
  private count: number = 0;
  private strings: StringTable;
  
  expressId: Uint32Array;
  typeEnum: Uint16Array;
  globalId: Uint32Array;
  name: Uint32Array;
  description: Uint32Array;
  objectType: Uint32Array;
  flags: Uint8Array;
  containedInStorey: Int32Array;
  definedByType: Int32Array;
  geometryIndex: Int32Array;
  
  private typeStarts: Map<IfcTypeEnum, number> = new Map();
  private typeCounts: Map<IfcTypeEnum, number> = new Map();
  
  constructor(capacity: number, strings: StringTable) {
    this.strings = strings;
    
    this.expressId = new Uint32Array(capacity);
    this.typeEnum = new Uint16Array(capacity);
    this.globalId = new Uint32Array(capacity);
    this.name = new Uint32Array(capacity);
    this.description = new Uint32Array(capacity);
    this.objectType = new Uint32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.containedInStorey = new Int32Array(capacity).fill(-1);
    this.definedByType = new Int32Array(capacity).fill(-1);
    this.geometryIndex = new Int32Array(capacity).fill(-1);
  }
  
  add(
    expressId: number,
    type: string,
    globalId: string,
    name: string,
    description: string,
    objectType: string,
    hasGeometry: boolean = false,
    isType: boolean = false
  ): void {
    const i = this.count++;
    
    this.expressId[i] = expressId;
    const typeEnum = IfcTypeEnumFromString(type);
    this.typeEnum[i] = typeEnum;
    this.globalId[i] = this.strings.intern(globalId);
    this.name[i] = this.strings.intern(name);
    this.description[i] = this.strings.intern(description);
    this.objectType[i] = this.strings.intern(objectType);
    
    let flags = 0;
    if (hasGeometry) flags |= EntityFlags.HAS_GEOMETRY;
    if (isType) flags |= EntityFlags.IS_TYPE;
    this.flags[i] = flags;
    
    // Track type ranges
    if (!this.typeStarts.has(typeEnum)) {
      this.typeStarts.set(typeEnum, i);
      this.typeCounts.set(typeEnum, 0);
    }
    this.typeCounts.set(typeEnum, this.typeCounts.get(typeEnum)! + 1);
  }
  
  build(): EntityTable {
    // Trim arrays to actual size
    const trim = <T extends TypedArray>(arr: T): T => {
      return arr.subarray(0, this.count) as T;
    };

    // Build type ranges (kept for cache serialization backward compat)
    const typeRanges = new Map<IfcTypeEnum, { start: number; end: number }>();
    for (const [type, start] of this.typeStarts) {
      const count = this.typeCounts.get(type)!;
      typeRanges.set(type, { start, end: start + count });
    }

    // Build correct per-type index arrays for getByType()
    // typeRanges assumes contiguous entities per type, which fails with interleaved IFC files
    const typeIndices = new Map<IfcTypeEnum, number[]>();
    for (let i = 0; i < this.count; i++) {
      const t = trim(this.typeEnum)[i] as IfcTypeEnum;
      let arr = typeIndices.get(t);
      if (!arr) {
        arr = [];
        typeIndices.set(t, arr);
      }
      arr.push(i);
    }

    const expressId = trim(this.expressId);
    const typeEnum = trim(this.typeEnum);
    const globalId = trim(this.globalId);
    const name = trim(this.name);
    const description = trim(this.description);
    const objectType = trim(this.objectType);
    const flags = trim(this.flags);
    const containedInStorey = trim(this.containedInStorey);
    const definedByType = trim(this.definedByType);
    const geometryIndex = trim(this.geometryIndex);

    // PERF: Build idToIndex map for O(1) lookups instead of O(n) linear search
    // This eliminates the linear search in indexOfId() which is called frequently
    const idToIndex = new Map<number, number>();
    for (let i = 0; i < this.count; i++) {
      idToIndex.set(expressId[i], i);
    }

    const indexOfId = (id: number): number => idToIndex.get(id) ?? -1;

    // Build GlobalId string → expressId map for BCF integration
    // This allows O(1) lookup of expressId from IFC GlobalId (22-char string)
    const globalIdToExpressId = new Map<string, number>();
    for (let i = 0; i < this.count; i++) {
      const gidString = this.strings.get(globalId[i]);
      if (gidString) {
        globalIdToExpressId.set(gidString, expressId[i]);
      }
    }

    return {
      count: this.count,
      expressId,
      typeEnum,
      globalId,
      name,
      description,
      objectType,
      flags,
      containedInStorey,
      definedByType,
      geometryIndex,
      typeRanges,

      getGlobalId: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? this.strings.get(globalId[idx]) : '';
      },
      getName: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? this.strings.get(name[idx]) : '';
      },
      getDescription: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? this.strings.get(description[idx]) : '';
      },
      getObjectType: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? this.strings.get(objectType[idx]) : '';
      },
      getTypeName: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? IfcTypeEnumToString(typeEnum[idx]) : 'Unknown';
      },
      hasGeometry: (id) => {
        const idx = indexOfId(id);
        return idx >= 0 ? (flags[idx] & EntityFlags.HAS_GEOMETRY) !== 0 : false;
      },
      getByType: (type) => {
        const indices = typeIndices.get(type);
        if (!indices) return [];
        const ids: number[] = new Array(indices.length);
        for (let i = 0; i < indices.length; i++) {
          ids[i] = expressId[indices[i]];
        }
        return ids;
      },

      getExpressIdByGlobalId: (gid) => globalIdToExpressId.get(gid) ?? -1,

      getGlobalIdMap: () => new Map(globalIdToExpressId), // Defensive copy
    };
  }
}

type TypedArray = Uint32Array | Uint16Array | Uint8Array | Int32Array;

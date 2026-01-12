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
  getTypeName(expressId: number): string;
  hasGeometry(expressId: number): boolean;
  getByType(type: IfcTypeEnum): number[];
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
    
    // Build type ranges
    const typeRanges = new Map<IfcTypeEnum, { start: number; end: number }>();
    for (const [type, start] of this.typeStarts) {
      const count = this.typeCounts.get(type)!;
      typeRanges.set(type, { start, end: start + count });
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
        const idx = this.indexOfId(expressId, id);
        return idx >= 0 ? this.strings.get(globalId[idx]) : '';
      },
      getName: (id) => {
        const idx = this.indexOfId(expressId, id);
        return idx >= 0 ? this.strings.get(name[idx]) : '';
      },
      getTypeName: (id) => {
        const idx = this.indexOfId(expressId, id);
        return idx >= 0 ? IfcTypeEnumToString(typeEnum[idx]) : 'Unknown';
      },
      hasGeometry: (id) => {
        const idx = this.indexOfId(expressId, id);
        return idx >= 0 ? (flags[idx] & EntityFlags.HAS_GEOMETRY) !== 0 : false;
      },
      getByType: (type) => {
        const range = typeRanges.get(type);
        if (!range) return [];
        const ids: number[] = [];
        for (let i = range.start; i < range.end; i++) {
          ids.push(expressId[i]);
        }
        return ids;
      },
    };
  }
  
  private indexOfId(expressId: Uint32Array, id: number): number {
    // Linear search (TODO: optimize with binary search if sorted)
    for (let i = 0; i < expressId.length; i++) {
      if (expressId[i] === id) return i;
    }
    return -1;
  }
}

type TypedArray = Uint32Array | Uint16Array | Uint8Array | Int32Array;

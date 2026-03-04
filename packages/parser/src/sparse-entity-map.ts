/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Memory-efficient replacement for Map<number, EntityRef>.
 *
 * Uses typed arrays indexed by expressId instead of V8 Map + heap objects.
 * EntityRef objects are created on-demand by get()/entries()/values() — these
 * are short-lived young-gen allocations that the GC handles cheaply.
 *
 * Memory: ~15 bytes per slot vs ~120 bytes per entry for Map<number, EntityRef>.
 * For 8.4M entities: ~126MB vs ~1008MB → ~880MB savings.
 *
 * Performance: typed-array indexing is faster than Map hash lookups for
 * get/set/has. Iterators are hand-rolled (no generator functions) to avoid
 * V8 generator overhead.
 */

import type { EntityRef } from './types.js';

export class SparseEntityMap {
  private _byteOffset: Uint32Array;
  private _byteLength: Uint32Array;
  private _lineNumber: Uint32Array;
  private _typeIndex: Uint16Array;
  private _occupied: Uint8Array;
  private _typeStrings: string[] = [];
  private _typeToIndex: Map<string, number> = new Map();
  private _size = 0;
  private _capacity: number;

  constructor(initialCapacity = 1_000_000) {
    this._capacity = initialCapacity;
    this._byteOffset = new Uint32Array(initialCapacity);
    this._byteLength = new Uint32Array(initialCapacity);
    this._lineNumber = new Uint32Array(initialCapacity);
    this._typeIndex = new Uint16Array(initialCapacity);
    this._occupied = new Uint8Array(initialCapacity);
  }

  get size(): number {
    return this._size;
  }

  get(id: number): EntityRef | undefined {
    if (id < 0 || id >= this._capacity || !this._occupied[id]) return undefined;
    return {
      expressId: id,
      type: this._typeStrings[this._typeIndex[id]],
      byteOffset: this._byteOffset[id],
      byteLength: this._byteLength[id],
      lineNumber: this._lineNumber[id],
    };
  }

  has(id: number): boolean {
    return id >= 0 && id < this._capacity && this._occupied[id] === 1;
  }

  set(id: number, ref: EntityRef): this {
    this._ensureCapacity(id);
    if (!this._occupied[id]) {
      this._size++;
      this._occupied[id] = 1;
    }
    this._byteOffset[id] = ref.byteOffset;
    this._byteLength[id] = ref.byteLength;
    this._lineNumber[id] = ref.lineNumber;
    this._typeIndex[id] = this._internType(ref.type);
    return this;
  }

  delete(id: number): boolean {
    if (id < 0 || id >= this._capacity || !this._occupied[id]) return false;
    this._occupied[id] = 0;
    this._size--;
    return true;
  }

  clear(): void {
    this._occupied.fill(0);
    this._size = 0;
  }

  forEach(callback: (value: EntityRef, key: number, map: Map<number, EntityRef>) => void): void {
    const occ = this._occupied;
    const cap = this._capacity;
    for (let i = 0; i < cap; i++) {
      if (occ[i]) {
        callback(
          {
            expressId: i,
            type: this._typeStrings[this._typeIndex[i]],
            byteOffset: this._byteOffset[i],
            byteLength: this._byteLength[i],
            lineNumber: this._lineNumber[i],
          },
          i,
          this as unknown as Map<number, EntityRef>,
        );
      }
    }
  }

  keys(): IterableIterator<number> {
    const occ = this._occupied;
    const cap = this._capacity;
    let i = 0;
    return {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<number> {
        while (i < cap) {
          if (occ[i]) return { value: i++, done: false };
          i++;
        }
        return { value: undefined as any, done: true };
      },
    };
  }

  values(): IterableIterator<EntityRef> {
    const self = this;
    const occ = this._occupied;
    const cap = this._capacity;
    let i = 0;
    return {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<EntityRef> {
        while (i < cap) {
          if (occ[i]) {
            const id = i++;
            return {
              value: {
                expressId: id,
                type: self._typeStrings[self._typeIndex[id]],
                byteOffset: self._byteOffset[id],
                byteLength: self._byteLength[id],
                lineNumber: self._lineNumber[id],
              },
              done: false,
            };
          }
          i++;
        }
        return { value: undefined as any, done: true };
      },
    };
  }

  entries(): IterableIterator<[number, EntityRef]> {
    const self = this;
    const occ = this._occupied;
    const cap = this._capacity;
    let i = 0;
    return {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<[number, EntityRef]> {
        while (i < cap) {
          if (occ[i]) {
            const id = i++;
            return {
              value: [id, {
                expressId: id,
                type: self._typeStrings[self._typeIndex[id]],
                byteOffset: self._byteOffset[id],
                byteLength: self._byteLength[id],
                lineNumber: self._lineNumber[id],
              }],
              done: false,
            };
          }
          i++;
        }
        return { value: undefined as any, done: true };
      },
    };
  }

  [Symbol.iterator](): IterableIterator<[number, EntityRef]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'SparseEntityMap';
  }

  // ---- internal helpers ----

  private _ensureCapacity(id: number): void {
    if (id < this._capacity) return;
    let newCap = this._capacity;
    while (newCap <= id) newCap *= 2;

    const newByteOffset = new Uint32Array(newCap);
    newByteOffset.set(this._byteOffset);
    this._byteOffset = newByteOffset;

    const newByteLength = new Uint32Array(newCap);
    newByteLength.set(this._byteLength);
    this._byteLength = newByteLength;

    const newLineNumber = new Uint32Array(newCap);
    newLineNumber.set(this._lineNumber);
    this._lineNumber = newLineNumber;

    const newTypeIndex = new Uint16Array(newCap);
    newTypeIndex.set(this._typeIndex);
    this._typeIndex = newTypeIndex;

    const newOccupied = new Uint8Array(newCap);
    newOccupied.set(this._occupied);
    this._occupied = newOccupied;

    this._capacity = newCap;
  }

  private _internType(type: string): number {
    let idx = this._typeToIndex.get(type);
    if (idx !== undefined) return idx;
    idx = this._typeStrings.length;
    this._typeStrings.push(type);
    this._typeToIndex.set(type, idx);
    return idx;
  }
}

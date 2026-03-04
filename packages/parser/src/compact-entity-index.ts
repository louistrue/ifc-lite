/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Compact entity index using typed arrays instead of Map<number, EntityRef>.
 *
 * For a 487MB IFC file with ~6.4M entities, the standard Map-based index
 * consumes ~1 GB (EntityRef objects + Map overhead). This columnar layout
 * brings that down to ~90 MB by storing numeric fields in typed arrays and
 * pooling type strings.
 *
 * Implements the subset of the Map interface used by consumers so it can
 * serve as a drop-in replacement for `Map<number, EntityRef>`.
 */

import type { EntityRef } from './types.js';

export class CompactEntityIndex {
    /** Number of entities stored */
    public size: number = 0;

    // Typed arrays indexed by expressId (direct-address table).
    // All IFC express IDs are positive integers, typically dense from 1..N.
    private offsets: Uint32Array;
    private lengths: Uint32Array;
    private lineNums: Uint32Array;
    private typeIds: Uint16Array;

    // Type string pool (deduplicated). Typically ~200 unique IFC types.
    private typePool: string[];
    private typeToIndex: Map<string, number>;

    // Tracks which slots are populated (byteLength is never 0 for real entities).
    // We use lengths[id] > 0 as the existence check.
    private maxId: number;

    /**
     * @param maxExpressId The highest express ID that will be stored.
     *                     Determines array sizes — should be exact or close.
     */
    constructor(maxExpressId: number) {
        this.maxId = maxExpressId;
        const len = maxExpressId + 1;
        this.offsets = new Uint32Array(len);
        this.lengths = new Uint32Array(len);
        this.lineNums = new Uint32Array(len);
        this.typeIds = new Uint16Array(len);
        this.typePool = [];
        this.typeToIndex = new Map();
    }

    // ── Map-compatible API ──────────────────────────────────────────────

    set(expressId: number, ref: EntityRef): this {
        if (expressId > this.maxId) {
            this.grow(expressId);
        }
        const isNew = this.lengths[expressId] === 0;

        this.offsets[expressId] = ref.byteOffset;
        this.lengths[expressId] = ref.byteLength;
        this.lineNums[expressId] = ref.lineNumber;

        // Pool the type string
        let typeIdx = this.typeToIndex.get(ref.type);
        if (typeIdx === undefined) {
            typeIdx = this.typePool.length;
            this.typePool.push(ref.type);
            this.typeToIndex.set(ref.type, typeIdx);
        }
        this.typeIds[expressId] = typeIdx;

        if (isNew) this.size++;
        return this;
    }

    get(expressId: number): EntityRef | undefined {
        if (expressId < 0 || expressId > this.maxId || this.lengths[expressId] === 0) {
            return undefined;
        }
        return {
            expressId,
            type: this.typePool[this.typeIds[expressId]],
            byteOffset: this.offsets[expressId],
            byteLength: this.lengths[expressId],
            lineNumber: this.lineNums[expressId],
        };
    }

    has(expressId: number): boolean {
        return expressId >= 0 && expressId <= this.maxId && this.lengths[expressId] > 0;
    }

    /** Iterate over all [expressId, EntityRef] pairs. */
    *[Symbol.iterator](): IterableIterator<[number, EntityRef]> {
        for (let id = 0; id <= this.maxId; id++) {
            if (this.lengths[id] > 0) {
                yield [id, {
                    expressId: id,
                    type: this.typePool[this.typeIds[id]],
                    byteOffset: this.offsets[id],
                    byteLength: this.lengths[id],
                    lineNumber: this.lineNums[id],
                }];
            }
        }
    }

    /** Iterate over all [expressId, EntityRef] pairs (Map-compatible). */
    entries(): IterableIterator<[number, EntityRef]> {
        return this[Symbol.iterator]();
    }

    /** Iterate over all express IDs. */
    *keys(): IterableIterator<number> {
        for (let id = 0; id <= this.maxId; id++) {
            if (this.lengths[id] > 0) {
                yield id;
            }
        }
    }

    /** Iterate over all EntityRef values. */
    *values(): IterableIterator<EntityRef> {
        for (let id = 0; id <= this.maxId; id++) {
            if (this.lengths[id] > 0) {
                yield {
                    expressId: id,
                    type: this.typePool[this.typeIds[id]],
                    byteOffset: this.offsets[id],
                    byteLength: this.lengths[id],
                    lineNumber: this.lineNums[id],
                };
            }
        }
    }

    forEach(callback: (value: EntityRef, key: number, map: CompactEntityIndex) => void): void {
        for (let id = 0; id <= this.maxId; id++) {
            if (this.lengths[id] > 0) {
                callback({
                    expressId: id,
                    type: this.typePool[this.typeIds[id]],
                    byteOffset: this.offsets[id],
                    byteLength: this.lengths[id],
                    lineNumber: this.lineNums[id],
                }, id, this);
            }
        }
    }

    // ── Additional utilities ────────────────────────────────────────────

    /** Fast access to byteOffset without creating an EntityRef object. */
    getByteOffset(expressId: number): number {
        return this.offsets[expressId];
    }

    /** Fast access to byteLength without creating an EntityRef object. */
    getByteLength(expressId: number): number {
        return this.lengths[expressId];
    }

    /** Fast access to type string without creating an EntityRef object. */
    getType(expressId: number): string {
        return this.typePool[this.typeIds[expressId]];
    }

    /** The highest express ID with data. */
    getMaxId(): number {
        return this.maxId;
    }

    // ── Internal ────────────────────────────────────────────────────────

    /** Grow the typed arrays to accommodate a larger expressId. */
    private grow(newMaxId: number): void {
        const newLen = newMaxId + 1;

        const newOffsets = new Uint32Array(newLen);
        newOffsets.set(this.offsets);
        this.offsets = newOffsets;

        const newLengths = new Uint32Array(newLen);
        newLengths.set(this.lengths);
        this.lengths = newLengths;

        const newLineNums = new Uint32Array(newLen);
        newLineNums.set(this.lineNums);
        this.lineNums = newLineNums;

        const newTypeIds = new Uint16Array(newLen);
        newTypeIds.set(this.typeIds);
        this.typeIds = newTypeIds;

        this.maxId = newMaxId;
    }
}

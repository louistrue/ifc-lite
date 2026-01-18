/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EntityTable serialization
 */

import type { EntityTable, StringTable } from '@ifc-lite/data';
import { IfcTypeEnum, IfcTypeEnumToString } from '@ifc-lite/data';
import { BufferWriter, BufferReader } from '../utils/buffer-utils.js';

/**
 * Write EntityTable to buffer
 * Format:
 *   - count: uint32
 *   - expressId: Uint32Array[count]
 *   - typeEnum: Uint16Array[count]
 *   - globalId: Uint32Array[count] (string indices)
 *   - name: Uint32Array[count]
 *   - description: Uint32Array[count]
 *   - objectType: Uint32Array[count]
 *   - flags: Uint8Array[count]
 *   - containedInStorey: Int32Array[count]
 *   - definedByType: Int32Array[count]
 *   - geometryIndex: Int32Array[count]
 *   - typeRangeCount: uint16
 *   - typeRanges: [type:uint16, start:uint32, end:uint32][]
 */
export function writeEntities(writer: BufferWriter, entities: EntityTable): void {
  const count = entities.count;

  // Write count
  writer.writeUint32(count);

  // Write columnar arrays
  writer.writeTypedArray(entities.expressId);
  writer.writeTypedArray(entities.typeEnum);
  writer.writeTypedArray(entities.globalId);
  writer.writeTypedArray(entities.name);
  writer.writeTypedArray(entities.description);
  writer.writeTypedArray(entities.objectType);
  writer.writeTypedArray(entities.flags);
  writer.writeTypedArray(entities.containedInStorey);
  writer.writeTypedArray(entities.definedByType);
  writer.writeTypedArray(entities.geometryIndex);

  // Write type ranges
  const typeRangeCount = entities.typeRanges.size;
  writer.writeUint16(typeRangeCount);

  for (const [type, range] of entities.typeRanges) {
    writer.writeUint16(type);
    writer.writeUint32(range.start);
    writer.writeUint32(range.end);
  }
}

/**
 * Read EntityTable from buffer
 */
export function readEntities(reader: BufferReader, strings: StringTable): EntityTable {
  const count = reader.readUint32();

  // Read columnar arrays
  const expressId = reader.readUint32Array(count);
  const typeEnum = reader.readUint16Array(count);
  const globalId = reader.readUint32Array(count);
  const name = reader.readUint32Array(count);
  const description = reader.readUint32Array(count);
  const objectType = reader.readUint32Array(count);
  const flags = reader.readUint8Array(count);
  const containedInStorey = reader.readInt32Array(count);
  const definedByType = reader.readInt32Array(count);
  const geometryIndex = reader.readInt32Array(count);

  // Read type ranges
  const typeRangeCount = reader.readUint16();
  const typeRanges = new Map<IfcTypeEnum, { start: number; end: number }>();

  for (let i = 0; i < typeRangeCount; i++) {
    const type = reader.readUint16() as IfcTypeEnum;
    const start = reader.readUint32();
    const end = reader.readUint32();
    typeRanges.set(type, { start, end });
  }

  // Build EntityTable with methods
  const HAS_GEOMETRY = 0b00000001;

  // PRE-BUILD INDEX MAP: O(n) once, then O(1) lookups
  // This eliminates O(n²) when getName/hasGeometry are called for every entity
  const idToIndex = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    idToIndex.set(expressId[i], i);
  }

  const indexOfId = (id: number): number => {
    return idToIndex.get(id) ?? -1;
  };

  return {
    count,
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
      return idx >= 0 ? strings.get(globalId[idx]) : '';
    },
    getName: (id) => {
      const idx = indexOfId(id);
      return idx >= 0 ? strings.get(name[idx]) : '';
    },
    getDescription: (id) => {
      const idx = indexOfId(id);
      return idx >= 0 ? strings.get(description[idx]) : '';
    },
    getObjectType: (id) => {
      const idx = indexOfId(id);
      return idx >= 0 ? strings.get(objectType[idx]) : '';
    },
    getTypeName: (id) => {
      const idx = indexOfId(id);
      return idx >= 0 ? IfcTypeEnumToString(typeEnum[idx]) : 'Unknown';
    },
    hasGeometry: (id) => {
      const idx = indexOfId(id);
      return idx >= 0 ? (flags[idx] & HAS_GEOMETRY) !== 0 : false;
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StoreApi } from './types.js';
import type { EntityRef, EntityData, PropertySetData, QuantitySetData, ExportBackendMethods } from '@ifc-lite/sdk';
import { EntityNode } from '@ifc-lite/query';
import { getModelForRef } from './model-compat.js';

/** Options for CSV export */
interface CsvOptions {
  columns: string[];
  separator?: string;
  filename?: string;
}

/**
 * Validate that a value is a CsvOptions object.
 */
function isCsvOptions(v: unknown): v is CsvOptions {
  if (v === null || typeof v !== 'object' || !('columns' in v)) return false;
  const columns = (v as CsvOptions).columns;
  if (!Array.isArray(columns)) return false;
  // Validate all column entries are strings
  return columns.every((c): c is string => typeof c === 'string');
}

/**
 * Validate that a value is an array of EntityRef objects.
 */
function isEntityRefArray(v: unknown): v is EntityRef[] {
  if (!Array.isArray(v)) return false;
  if (v.length === 0) return true;
  const first = v[0] as Record<string, unknown>;
  // Accept both raw EntityRef and entity proxy objects with .ref
  if ('modelId' in first && 'expressId' in first) {
    return typeof first.modelId === 'string' && typeof first.expressId === 'number';
  }
  if ('ref' in first && first.ref !== null && typeof first.ref === 'object') {
    const ref = first.ref as Record<string, unknown>;
    return typeof ref.modelId === 'string' && typeof ref.expressId === 'number';
  }
  return false;
}

/**
 * Normalize entity refs — entities from the sandbox may be EntityData
 * objects with a .ref property, or raw EntityRef { modelId, expressId }.
 */
function normalizeRefs(raw: unknown[]): EntityRef[] {
  return raw.map((item) => {
    const r = item as Record<string, unknown>;
    if (r.ref && typeof r.ref === 'object') {
      return r.ref as EntityRef;
    }
    return { modelId: r.modelId as string, expressId: r.expressId as number };
  });
}

/**
 * Escape a CSV cell value — wrap in quotes if it contains the separator,
 * double-quotes, or newlines.
 */
function escapeCsv(value: string, sep: string): string {
  if (value.includes(sep) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export adapter — implements CSV and JSON export directly.
 *
 * This adapter resolves entity data by dispatching to the query adapter
 * on the same LocalBackend, providing full export support for both
 * direct dispatch calls and SDK namespace usage.
 */
export function createExportAdapter(store: StoreApi): ExportBackendMethods {
  /** Resolve entity data via the query subsystem */
  function getEntityData(ref: EntityRef): EntityData | null {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
    if (!model?.ifcDataStore) return null;

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return {
      ref,
      globalId: node.globalId,
      name: node.name,
      type: node.type,
      description: node.description,
      objectType: node.objectType,
    };
  }

  /** Resolve property sets for an entity */
  function getProperties(ref: EntityRef): PropertySetData[] {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
    if (!model?.ifcDataStore) return [];

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return node.properties().map((pset: { name: string; globalId?: string; properties: Array<{ name: string; type: number; value: string | number | boolean | null }> }) => ({
      name: pset.name,
      globalId: pset.globalId,
      properties: pset.properties.map((p: { name: string; type: number; value: string | number | boolean | null }) => ({
        name: p.name,
        type: p.type,
        value: p.value,
      })),
    }));
  }

  /** Resolve quantity sets for an entity */
  function getQuantities(ref: EntityRef): QuantitySetData[] {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
    if (!model?.ifcDataStore) return [];

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return node.quantities().map((qset: { name: string; quantities: Array<{ name: string; type: number; value: number }> }) => ({
      name: qset.name,
      quantities: qset.quantities.map((q: { name: string; type: number; value: number }) => ({
        name: q.name,
        type: q.type,
        value: q.value,
      })),
    }));
  }

  /** Resolve a single column value from entity data + properties + quantities.
   * Accepts both IFC PascalCase (Name, GlobalId) and legacy camelCase (name, globalId).
   * Dot-path columns (e.g. "Pset_WallCommon.FireRating" or "Qto_WallBaseQuantities.GrossVolume")
   * resolve against property sets first, then quantity sets. */
  function resolveColumnValue(
    data: EntityData,
    col: string,
    getProps: () => PropertySetData[],
    getQties: () => QuantitySetData[],
  ): string {
    // IFC schema attribute names (PascalCase) + legacy camelCase
    switch (col) {
      case 'Name': case 'name': return data.name;
      case 'Type': case 'type': return data.type;
      case 'GlobalId': case 'globalId': return data.globalId;
      case 'Description': case 'description': return data.description;
      case 'ObjectType': case 'objectType': return data.objectType;
      case 'modelId': return data.ref.modelId;
      case 'expressId': return String(data.ref.expressId);
    }

    // Property/Quantity path: "SetName.ValueName"
    const dotIdx = col.indexOf('.');
    if (dotIdx > 0) {
      const setName = col.slice(0, dotIdx);
      const valueName = col.slice(dotIdx + 1);

      // Try property sets first
      const psets = getProps();
      const pset = psets.find(p => p.name === setName);
      if (pset) {
        const prop = pset.properties.find(p => p.name === valueName);
        if (prop?.value != null) return String(prop.value);
      }

      // Fall back to quantity sets
      const qsets = getQties();
      const qset = qsets.find(q => q.name === setName);
      if (qset) {
        const qty = qset.quantities.find(q => q.name === valueName);
        if (qty?.value != null) return String(qty.value);
      }

      return '';
    }

    return '';
  }

  return {
    csv(rawRefs: unknown, rawOptions: unknown) {
      if (!isEntityRefArray(rawRefs)) {
        throw new Error('export.csv: first argument must be an array of entity references');
      }
      if (!isCsvOptions(rawOptions)) {
        throw new Error('export.csv: second argument must be { columns: string[], separator?: string }');
      }

      const refs = normalizeRefs(rawRefs);
      const options = rawOptions;
      const sep = options.separator ?? ',';
      const rows: string[][] = [];

      // Header row
      rows.push(options.columns);

      // Data rows
      for (const ref of refs) {
        const data = getEntityData(ref);
        if (!data) continue;

        // Lazy-load properties/quantities only if a column needs them
        let cachedProps: PropertySetData[] | null = null;
        const getProps = (): PropertySetData[] => {
          if (!cachedProps) cachedProps = getProperties(ref);
          return cachedProps;
        };
        let cachedQties: QuantitySetData[] | null = null;
        const getQties = (): QuantitySetData[] => {
          if (!cachedQties) cachedQties = getQuantities(ref);
          return cachedQties;
        };

        const row = options.columns.map(col => resolveColumnValue(data, col, getProps, getQties));
        rows.push(row);
      }

      const csvString = rows.map(r => r.map(cell => escapeCsv(cell, sep)).join(sep)).join('\n');

      // If filename specified, trigger browser download
      if (options.filename) {
        triggerDownload(csvString, options.filename, 'text/csv;charset=utf-8;');
      }

      return csvString;
    },

    json(rawRefs: unknown, columns: unknown) {
      if (!isEntityRefArray(rawRefs)) {
        throw new Error('export.json: first argument must be an array of entity references');
      }
      if (!Array.isArray(columns)) {
        throw new Error('export.json: second argument must be a string[] of column names');
      }

      const refs = normalizeRefs(rawRefs);
      const result: Record<string, unknown>[] = [];

      for (const ref of refs) {
        const data = getEntityData(ref);
        if (!data) continue;

        let cachedProps: PropertySetData[] | null = null;
        const getProps = (): PropertySetData[] => {
          if (!cachedProps) cachedProps = getProperties(ref);
          return cachedProps;
        };
        let cachedQties: QuantitySetData[] | null = null;
        const getQties = (): QuantitySetData[] => {
          if (!cachedQties) cachedQties = getQuantities(ref);
          return cachedQties;
        };

        const row: Record<string, unknown> = {};
        for (const col of columns as string[]) {
          const value = resolveColumnValue(data, col, getProps, getQties);
          // Try to parse numeric values
          const numVal = Number(value);
          row[col] = value === '' ? null : !isNaN(numVal) && value.trim() !== '' ? numVal : value;
        }
        result.push(row);
      }

      return result;
    },

    download(content: string, filename: string, mimeType?: string) {
      triggerDownload(content, filename, mimeType ?? 'text/plain');
      return undefined;
    },
  };
}

/** Trigger a browser file download */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

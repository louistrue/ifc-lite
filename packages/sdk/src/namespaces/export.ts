/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.export — Multi-format data export
 *
 * Wraps @ifc-lite/export for GLTF, CSV, STEP, and Parquet export.
 * The export namespace works with EntityRef to determine which
 * entities to include, and delegates to the appropriate exporter.
 */

import type { BimBackend, EntityRef, EntityData, PropertySetData, QuantitySetData } from '../types.js';

export interface ExportCsvOptions {
  columns: string[];
  filename?: string;
  separator?: string;
}

export interface ExportGltfOptions {
  filename?: string;
}

export interface ExportStepOptions {
  filename?: string;
  includeMutations?: boolean;
}

/** bim.export — Data export in multiple formats */
export class ExportNamespace {
  constructor(private backend: BimBackend) {}

  /**
   * Export entities to CSV format.
   * Columns can be entity attributes (name, type, globalId) or
   * property paths (Pset_WallCommon.FireRating).
   */
  csv(refs: EntityRef[], options: ExportCsvOptions): string {
    const rows: string[][] = [];

    // Check if any columns need property/quantity lookups (Set.Value paths)
    const hasDotColumns = options.columns.some(c => c.indexOf('.') > 0);

    // Header row
    rows.push(options.columns);

    // Data rows
    for (const ref of refs) {
      const data = this.backend.query.entityData(ref);
      if (!data) continue;

      // Fetch properties/quantities once per entity (not per column)
      let psets: PropertySetData[] | null = null;
      let qsets: QuantitySetData[] | null = null;
      if (hasDotColumns) {
        psets = this.backend.query.properties(ref);
        qsets = this.backend.query.quantities(ref);
      }

      const row: string[] = [];
      for (const col of options.columns) {
        // IFC PascalCase attribute names (per IFC EXPRESS schema) — also accept legacy camelCase
        if (col === 'Name' || col === 'name') { row.push(data.name); continue; }
        if (col === 'Type' || col === 'type') { row.push(data.type); continue; }
        if (col === 'GlobalId' || col === 'globalId') { row.push(data.globalId); continue; }
        if (col === 'Description' || col === 'description') { row.push(data.description); continue; }
        if (col === 'ObjectType' || col === 'objectType') { row.push(data.objectType); continue; }

        // Property/Quantity path: "SetName.ValueName"
        const dotIdx = col.indexOf('.');
        if (dotIdx > 0) {
          const setName = col.slice(0, dotIdx);
          const valueName = col.slice(dotIdx + 1);

          // Try property sets first
          if (psets) {
            const pset = psets.find(p => p.name === setName);
            if (pset) {
              const prop = pset.properties.find(p => p.name === valueName);
              if (prop?.value != null) { row.push(String(prop.value)); continue; }
            }
          }

          // Fall back to quantity sets
          if (qsets) {
            const qset = qsets.find(q => q.name === setName);
            if (qset) {
              const qty = qset.quantities.find(q => q.name === valueName);
              if (qty?.value != null) { row.push(String(qty.value)); continue; }
            }
          }

          row.push('');
        } else {
          row.push('');
        }
      }
      rows.push(row);
    }

    const sep = options.separator ?? ',';
    const csvString = rows.map(r => r.map(cell => this.escapeCsv(cell, sep)).join(sep)).join('\n');

    // Trigger browser download if filename specified
    if (options.filename) {
      this.backend.export.download(csvString, options.filename, 'text/csv;charset=utf-8;');
    }

    return csvString;
  }

  /**
   * Export entities as a JSON array of objects.
   * Each object has the specified columns as keys.
   */
  json(refs: EntityRef[], columns: string[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    const hasDotColumns = columns.some(c => c.indexOf('.') > 0);

    for (const ref of refs) {
      const data = this.backend.query.entityData(ref);
      if (!data) continue;

      // Fetch properties/quantities once per entity (not per column)
      let psets: PropertySetData[] | null = null;
      let qsets: QuantitySetData[] | null = null;
      if (hasDotColumns) {
        psets = this.backend.query.properties(ref);
        qsets = this.backend.query.quantities(ref);
      }

      const row: Record<string, unknown> = {};
      for (const col of columns) {
        // IFC PascalCase attribute names (per IFC EXPRESS schema) — also accept legacy camelCase
        if (col === 'Name' || col === 'name') { row[col] = data.name; continue; }
        if (col === 'Type' || col === 'type') { row[col] = data.type; continue; }
        if (col === 'GlobalId' || col === 'globalId') { row[col] = data.globalId; continue; }
        if (col === 'Description' || col === 'description') { row[col] = data.description; continue; }
        if (col === 'ObjectType' || col === 'objectType') { row[col] = data.objectType; continue; }

        const dotIdx = col.indexOf('.');
        if (dotIdx > 0) {
          const setName = col.slice(0, dotIdx);
          const valueName = col.slice(dotIdx + 1);
          let resolved = false;

          // Try property sets first
          if (psets) {
            const pset = psets.find(p => p.name === setName);
            if (pset) {
              const prop = pset.properties.find(p => p.name === valueName);
              if (prop?.value != null) { row[col] = prop.value; resolved = true; }
            }
          }

          // Fall back to quantity sets
          if (!resolved && qsets) {
            const qset = qsets.find(q => q.name === setName);
            if (qset) {
              const qty = qset.quantities.find(q => q.name === valueName);
              if (qty?.value != null) { row[col] = qty.value; resolved = true; }
            }
          }

          if (!resolved) row[col] = null;
        }
      }
      result.push(row);
    }

    return result;
  }

  private escapeCsv(value: string, sep: string): string {
    if (value.includes(sep) || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

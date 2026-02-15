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

import type { BimBackend, EntityRef, EntityData, PropertySetData } from '../types.js';

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

    // Check if any columns need property lookups (Pset.Property paths)
    const hasPropertyColumns = options.columns.some(c => c.indexOf('.') > 0);

    // Header row
    rows.push(options.columns);

    // Data rows
    for (const ref of refs) {
      const data = this.backend.query.entityData(ref);
      if (!data) continue;

      // Fetch properties once per entity (not per column)
      let psets: PropertySetData[] | null = null;
      if (hasPropertyColumns) {
        psets = this.backend.query.properties(ref);
      }

      const row: string[] = [];
      for (const col of options.columns) {
        // IFC PascalCase attribute names (per IFC EXPRESS schema) — also accept legacy camelCase
        if (col === 'Name' || col === 'name') { row.push(data.name); continue; }
        if (col === 'Type' || col === 'type') { row.push(data.type); continue; }
        if (col === 'GlobalId' || col === 'globalId') { row.push(data.globalId); continue; }
        if (col === 'Description' || col === 'description') { row.push(data.description); continue; }
        if (col === 'ObjectType' || col === 'objectType') { row.push(data.objectType); continue; }

        // Property path: "PsetName.PropertyName"
        const dotIdx = col.indexOf('.');
        if (dotIdx > 0 && psets) {
          const psetName = col.slice(0, dotIdx);
          const propName = col.slice(dotIdx + 1);
          const pset = psets.find(p => p.name === psetName);
          const prop = pset?.properties.find(p => p.name === propName);
          row.push(prop?.value != null ? String(prop.value) : '');
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
    const hasPropertyColumns = columns.some(c => c.indexOf('.') > 0);

    for (const ref of refs) {
      const data = this.backend.query.entityData(ref);
      if (!data) continue;

      // Fetch properties once per entity (not per column)
      let psets: PropertySetData[] | null = null;
      if (hasPropertyColumns) {
        psets = this.backend.query.properties(ref);
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
        if (dotIdx > 0 && psets) {
          const psetName = col.slice(0, dotIdx);
          const propName = col.slice(dotIdx + 1);
          const pset = psets.find(p => p.name === psetName);
          const prop = pset?.properties.find(p => p.name === propName);
          row[col] = prop?.value ?? null;
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CSV exporter for IFC data
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { PropertyValue } from '@ifc-lite/data';

export interface CSVExportOptions {
  includeProperties?: boolean;
  includeQuantities?: boolean;
  delimiter?: string;
  flattenProperties?: boolean;
}

export class CSVExporter {
  private store: IfcDataStore;

  constructor(store: IfcDataStore) {
    this.store = store;
  }

  /**
   * Export entities to CSV format
   * @param entityIds Optional array of entity IDs to export. If not provided, exports all entities.
   */
  exportEntities(entityIds?: number[], options: CSVExportOptions = {}): string {
    const delimiter = options.delimiter ?? ',';
    const includeProperties = options.includeProperties ?? false;
    const flattenProperties = options.flattenProperties ?? false;

    // Build header row
    const headers: string[] = ['expressId', 'globalId', 'name', 'type'];
    
    // Collect all unique property set names and property names (if flattening properties)
    const psetProps = new Map<string, Set<string>>();
    
    if (includeProperties && flattenProperties) {
      const allEntityIds = entityIds ?? this.getAllEntityIds();
      
      for (const id of allEntityIds) {
        const properties = this.store.properties.getForEntity(id);
        for (const pset of properties) {
          if (!psetProps.has(pset.name)) {
            psetProps.set(pset.name, new Set());
          }
          for (const prop of pset.properties) {
            psetProps.get(pset.name)!.add(prop.name);
          }
        }
      }
      
      // Add flattened property columns: PsetName_PropName
      for (const [psetName, propNames] of psetProps) {
        for (const propName of propNames) {
          headers.push(`${psetName}_${propName}`);
        }
      }
    }

    const rows: string[] = [this.escapeRow(headers, delimiter)];

    // Get entity IDs to export
    const ids = entityIds ?? this.getAllEntityIds();

    // Build data rows
    for (const id of ids) {
      const row: string[] = [
        String(id),
        this.escapeValue(this.store.entities.getGlobalId(id)),
        this.escapeValue(this.store.entities.getName(id)),
        this.escapeValue(this.store.entities.getTypeName(id)),
      ];

      if (includeProperties && flattenProperties) {
        const properties = this.store.properties.getForEntity(id);
        const propMap = new Map<string, Map<string, PropertyValue>>();
        
        // Build map of pset -> prop -> value
        for (const pset of properties) {
          const props = new Map<string, PropertyValue>();
          for (const prop of pset.properties) {
            props.set(prop.name, prop.value);
          }
          propMap.set(pset.name, props);
        }

        // Add property values in same order as headers
        for (const [psetName, propNames] of psetProps) {
          for (const propName of propNames) {
            const value = propMap.get(psetName)?.get(propName) ?? '';
            row.push(this.escapeValue(value));
          }
        }
      }

      rows.push(this.escapeRow(row, delimiter));
    }

    return rows.join('\n');
  }

  /**
   * Export properties to CSV format (one row per property)
   */
  exportProperties(entityIds?: number[], options: CSVExportOptions = {}): string {
    const delimiter = options.delimiter ?? ',';
    const headers = ['entityId', 'psetName', 'propName', 'value', 'type'];
    const rows: string[] = [this.escapeRow(headers, delimiter)];

    const ids = entityIds ?? this.getAllEntityIds();

    for (const id of ids) {
      const properties = this.store.properties.getForEntity(id);
      for (const pset of properties) {
        for (const prop of pset.properties) {
          const row: string[] = [
            String(id),
            this.escapeValue(pset.name),
            this.escapeValue(prop.name),
            this.escapeValue(prop.value),
            String(prop.type),
          ];
          rows.push(this.escapeRow(row, delimiter));
        }
      }
    }

    return rows.join('\n');
  }

  /**
   * Export quantities to CSV format (one row per quantity)
   */
  exportQuantities(entityIds?: number[], options: CSVExportOptions = {}): string {
    const delimiter = options.delimiter ?? ',';
    
    if (!this.store.quantities) {
      return this.escapeRow(['entityId', 'qsetName', 'quantityName', 'value', 'type'], delimiter);
    }

    const headers = ['entityId', 'qsetName', 'quantityName', 'value', 'type'];
    const rows: string[] = [this.escapeRow(headers, delimiter)];

    const ids = entityIds ?? this.getAllEntityIds();

    for (const id of ids) {
      const quantities = this.store.quantities.getForEntity(id);
      for (const qset of quantities) {
        for (const quant of qset.quantities) {
          const row: string[] = [
            String(id),
            this.escapeValue(qset.name),
            this.escapeValue(quant.name),
            String(quant.value),
            String(quant.type),
          ];
          rows.push(this.escapeRow(row, delimiter));
        }
      }
    }

    return rows.join('\n');
  }

  /**
   * Get all entity IDs from the store
   */
  private getAllEntityIds(): number[] {
    const ids: number[] = [];
    for (let i = 0; i < this.store.entities.count; i++) {
      ids.push(this.store.entities.expressId[i]);
    }
    return ids;
  }

  /**
   * Escape a value for CSV (handles quotes, commas, newlines)
   */
  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }
    
    const str = String(value);
    
    // If value contains delimiter, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    return str;
  }

  /**
   * Escape a row of values
   */
  private escapeRow(values: string[], delimiter: string): string {
    return values.map(v => this.escapeValue(v)).join(delimiter);
  }
}

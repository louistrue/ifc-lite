/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Build model context from the current viewer state.
 * This context is injected into the system prompt so the LLM
 * knows what's currently loaded in the 3D viewer.
 */

import { useViewerStore } from '@/store';
import type { ModelContext } from './system-prompt.js';

/**
 * Snapshot the current model context from the Zustand store.
 * Called before each LLM request to provide up-to-date context.
 */
export function getModelContext(): ModelContext {
  const state = useViewerStore.getState();

  const models: ModelContext['models'] = [];
  const typeCounts: Record<string, number> = {};

  // Federated models
  if (state.models.size > 0) {
    for (const [, model] of state.models) {
      const entityCount = model.ifcDataStore?.entities.count ?? 0;
      models.push({
        name: model.filename ?? 'Unknown',
        entityCount,
      });

      // Aggregate type counts
      if (model.ifcDataStore) {
        const store = model.ifcDataStore;
        for (let i = 0; i < store.entities.count; i++) {
          const id = store.entities.expressId[i];
          const type = store.entities.getTypeName(id);
          if (type) {
            typeCounts[type] = (typeCounts[type] ?? 0) + 1;
          }
        }
      }
    }
  }

  // Legacy single-model path
  if (models.length === 0 && state.ifcDataStore) {
    const store = state.ifcDataStore;
    models.push({
      name: state.filename ?? 'Model',
      entityCount: store.entities.count,
    });

    for (let i = 0; i < store.entities.count; i++) {
      const id = store.entities.expressId[i];
      const type = store.entities.getTypeName(id);
      if (type) {
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      }
    }
  }

  // Selection count
  const selectedCount = state.selectedEntityIds.size > 0
    ? state.selectedEntityIds.size
    : state.selectedEntityId !== null ? 1 : 0;

  return { models, typeCounts, selectedCount };
}

/**
 * Parse a CSV string into an array of row objects.
 * Simple parser that handles quoted fields with commas.
 */
export function parseCSV(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };

  // Parse header
  const columns = parseCSVLine(lines[0]);

  // Parse rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]] = values[j] ?? '';
    }
    rows.push(row);
  }

  return { columns, rows };
}

/** Parse a single CSV line, handling quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',' || char === ';') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

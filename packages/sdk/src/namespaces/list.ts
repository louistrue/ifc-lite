/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.list — Property lists / entity tables
 *
 * Full access to @ifc-lite/lists for configurable entity tables with
 * column discovery, filtering, presets, and CSV export.
 */

// ============================================================================
// Types
// ============================================================================

export interface ListColumn {
  /** Column header */
  header: string;
  /** Data source: 'name', 'type', 'globalId', or 'PsetName.PropName' */
  source: string;
}

export interface ListCondition {
  /** Property set name */
  psetName: string;
  /** Property name */
  propName: string;
  /** Comparison operator */
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'exists';
  /** Value to compare against */
  value?: string | number | boolean;
}

export interface ListDefinition {
  /** List name */
  name?: string;
  /** IFC types to include (empty = all) */
  types?: string[];
  /** Columns to display */
  columns: ListColumn[];
  /** Filter conditions */
  conditions?: ListCondition[];
  /** Maximum rows */
  limit?: number;
}

// ============================================================================
// Dynamic import
// ============================================================================

async function loadLists(): Promise<Record<string, unknown>> {
  const name = '@ifc-lite/lists';
  return import(/* webpackIgnore: true */ name) as Promise<Record<string, unknown>>;
}

type AnyFn = (...args: unknown[]) => unknown;

// ============================================================================
// ListNamespace
// ============================================================================

/** bim.list — Entity lists, property tables, column discovery, and CSV export */
export class ListNamespace {

  // --------------------------------------------------------------------------
  // Presets
  // --------------------------------------------------------------------------

  /** Get available list presets (e.g. wall schedule, door schedule). */
  async getPresets(): Promise<unknown[]> {
    const mod = await loadLists();
    return mod.LIST_PRESETS as unknown[];
  }

  /** Get the built-in entity attribute columns (name, type, globalId, etc.). */
  async getEntityAttributes(): Promise<unknown[]> {
    const mod = await loadLists();
    return mod.ENTITY_ATTRIBUTES as unknown[];
  }

  // --------------------------------------------------------------------------
  // Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a list query against a data provider.
   *
   * ```ts
   * const result = await bim.list.execute(myProvider, {
   *   types: ['IfcWall'],
   *   columns: [
   *     { header: 'Name', source: 'name' },
   *     { header: 'Type', source: 'type' },
   *     { header: 'External', source: 'Pset_WallCommon.IsExternal' },
   *   ],
   * });
   * ```
   */
  async execute(provider: unknown, definition: ListDefinition, modelId?: string): Promise<unknown> {
    const mod = await loadLists();
    return (mod.executeList as AnyFn)(definition, provider, modelId ?? 'default');
  }

  // --------------------------------------------------------------------------
  // Column discovery
  // --------------------------------------------------------------------------

  /**
   * Discover available columns from a data provider.
   * Returns all property sets and their properties found in the model.
   */
  async discoverColumns(provider: unknown, entityTypes?: string[]): Promise<unknown> {
    const mod = await loadLists();
    return (mod.discoverColumns as AnyFn)(provider, entityTypes ?? []);
  }

  // --------------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------------

  /** Convert a list result to CSV string. */
  async toCSV(result: unknown): Promise<string> {
    const mod = await loadLists();
    return (mod.listResultToCSV as (r: unknown) => string)(result);
  }
}

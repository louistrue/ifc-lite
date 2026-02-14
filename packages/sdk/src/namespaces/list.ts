/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.list — Property lists / entity tables
 *
 * Wraps @ifc-lite/lists for configurable entity tables with column discovery.
 */

export interface ListColumn {
  /** Column header */
  header: string;
  /** Data source: 'name', 'type', 'globalId', or 'PsetName.PropName' */
  source: string;
}

// Dynamic import helper
async function loadLists(): Promise<Record<string, unknown>> {
  const name = '@ifc-lite/lists';
  return import(/* webpackIgnore: true */ name) as Promise<Record<string, unknown>>;
}

/** bim.list — Entity lists and property tables */
export class ListNamespace {
  /**
   * Get available list presets.
   */
  async getPresets(): Promise<unknown[]> {
    const mod = await loadLists();
    return mod.LIST_PRESETS as unknown[];
  }
}

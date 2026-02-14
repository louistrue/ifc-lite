/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { NamespaceAdapter, StoreApi } from './types.js';

/**
 * Export adapter — delegates to the ExportNamespace on the SDK.
 *
 * Since ExportNamespace already uses `backend.dispatch('query', ...)`,
 * the export adapter can simply re-dispatch to the query adapter for
 * entity data. But for the LocalBackend, we implement csv/json inline
 * to avoid circular dispatch.
 */
export function createExportAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      switch (method) {
        case 'csv':
        case 'json':
          // The ExportNamespace in @ifc-lite/sdk handles csv/json via
          // backend.dispatch('query', ...). Since this adapter is registered
          // on LocalBackend, the SDK namespace is used directly by BimContext.
          // This adapter is a pass-through that signals the namespace exists.
          throw new Error(
            `Export '${method}' should be called via bim.export.${method}(), not dispatched directly. ` +
            `The ExportNamespace handles this internally.`,
          );
        default:
          throw new Error(`Unknown export method: ${method}`);
      }
    },
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC string encoding/decoding utilities and property value parsing.
 *
 * Core logic lives in @ifc-lite/encoding; this file re-exports it and adds
 * viewer-specific types (PropertySet/QuantitySet with mutation tracking).
 */

// Re-export core encoding functions from the package
export { decodeIfcString, parsePropertyValue } from '@ifc-lite/encoding';
export type { ParsedPropertyValue } from '@ifc-lite/encoding';

// ============================================================================
// Viewer-specific Types (with mutation tracking for property editing UI)
// ============================================================================

export interface PropertySet {
  name: string;
  properties: Array<{ name: string; value: unknown; isMutated?: boolean }>;
  isNewPset?: boolean;
}

export interface QuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number; type: number }>;
}

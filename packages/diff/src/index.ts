/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/diff - IFC model diffing
 */

export { computeDiff } from './differ.js';
export type {
  DiffSettings,
  DiffResult,
  EntityChange,
  AttributeChange,
  PropertyChange,
  QuantityChange,
  ChangeType,
} from './types.js';
export { DIFF_COLORS, DEFAULT_DIFF_SETTINGS } from './types.js';

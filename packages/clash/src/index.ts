/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/clash - IFC clash detection
 */

export { detectClashes } from './clasher.js';
export type {
  ClashSettings,
  ClashSet,
  ClashGroup,
  ClashMode,
  ClashResult,
  Clash,
  ClashElement,
} from './types.js';
export { DEFAULT_CLASH_SETTINGS, CLASH_COLORS } from './types.js';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ViewerState } from '../../store/index.js';

/**
 * Adapter — a plain object whose keys are method names.
 * LocalBackend calls adapter[method](...args) directly.
 * No more string-based dispatch switches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Adapter = Record<string, (...args: any[]) => unknown>;

/** Store API surface needed by adapters */
export type StoreApi = {
  getState: () => ViewerState;
  subscribe: (listener: (state: ViewerState, prevState: ViewerState) => void) => () => void;
};

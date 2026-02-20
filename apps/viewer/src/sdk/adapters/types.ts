/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ViewerState } from '../../store/index.js';

/** Store API surface needed by adapters */
export type StoreApi = {
  getState: () => ViewerState;
  subscribe: (listener: (state: ViewerState, prevState: ViewerState) => void) => () => void;
};

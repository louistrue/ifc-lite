/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useViewerStore } from './index.js';

export function resetVisibilityForHomeFromStore(): void {
  const state = useViewerStore.getState();
  state.showAllInAllModels();
  state.clearStoreySelection();
  state.clearHierarchyBasketSelection?.();
  state.clearEntitySelection?.();
  state.clearBasket?.();
  useViewerStore.setState({ activeBasketViewId: null });
}

export function goHomeFromStore(): void {
  const state = useViewerStore.getState();
  state.showAllInAllModels();
  state.clearStoreySelection();
  state.clearHierarchyBasketSelection?.();
  state.clearEntitySelection?.();
  useViewerStore.setState({ activeBasketViewId: null });
  state.cameraCallbacks.home?.();
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useViewerStore } from '../index.js';

/**
 * Coordinator for activating a saved basket view.
 * Owns camera + section + drawing side effects; delegates entity/isolation to pinboard.
 */
export function activateBasketViewFromStore(viewId: string): void {
  const state = useViewerStore.getState();
  const view = state.basketViews.find((v) => v.id === viewId);
  if (!view) return;

  // Basket activation must never restore or keep 2D profile overlays.
  // Basket views should only affect 3D model geometry visibility/sectioning.
  state.setDrawing2D(null);
  state.setDrawing2DPanelVisible(false);
  state.updateDrawing2DDisplayOptions({ show3DOverlay: false });

  state.clearEntitySelection?.();
  state.restoreBasketEntities(view.entityRefs, viewId);

  if (view.viewpoint) {
    state.cameraCallbacks.applyViewpoint?.(view.viewpoint, true);
  }

  if (view.section) {
    const sectionSnapshot = view.section;
    useViewerStore.setState({
      sectionPlane: { ...sectionSnapshot.plane },
      drawing2DPanelVisible: false,
    });
    if (sectionSnapshot.plane.enabled) {
      if (state.activeTool !== 'section') {
        state.setSuppressNextSection2DPanelAutoOpen(true);
      }
      state.setActiveTool('section');
    } else if (state.activeTool === 'section') {
      state.setActiveTool('select');
    }
  } else {
    // This view has no section snapshot: ensure previously active cutting is cleared.
    const current = useViewerStore.getState().sectionPlane;
    useViewerStore.setState({ sectionPlane: { ...current, enabled: false } });
    if (state.activeTool === 'section') {
      state.setActiveTool('select');
    }
  }
}

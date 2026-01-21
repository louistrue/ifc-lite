/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hover and context menu state slice
 */

import type { StateCreator } from 'zustand';
import type { HoverState, ContextMenuState } from '../types.js';

export interface HoverSlice {
  // State
  hoverState: HoverState;
  contextMenu: ContextMenuState;

  // Actions
  setHoverState: (state: HoverState) => void;
  clearHover: () => void;
  openContextMenu: (entityId: number | null, screenX: number, screenY: number) => void;
  closeContextMenu: () => void;
}

export const createHoverSlice: StateCreator<HoverSlice, [], [], HoverSlice> = (set) => ({
  // Initial state
  hoverState: { entityId: null, screenX: 0, screenY: 0 },
  contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },

  // Actions
  setHoverState: (hoverState) => set({ hoverState }),
  clearHover: () => set({ hoverState: { entityId: null, screenX: 0, screenY: 0 } }),

  openContextMenu: (entityId, screenX, screenY) => set({
    contextMenu: { isOpen: true, entityId, screenX, screenY },
  }),

  closeContextMenu: () => set({
    contextMenu: { isOpen: false, entityId: null, screenX: 0, screenY: 0 },
  }),
});

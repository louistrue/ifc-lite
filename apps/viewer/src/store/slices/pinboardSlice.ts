/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pinboard state slice
 *
 * Persistent selection basket for tracking components across sessions.
 * Users can pin entities, then isolate/show the pinned set.
 */

import type { StateCreator } from 'zustand';
import type { EntityRef } from '../types.js';
import { entityRefToString, stringToEntityRef } from '../types.js';

export interface PinboardSlice {
  // State
  /** Serialized EntityRef strings for O(1) membership check */
  pinboardEntities: Set<string>;

  // Actions
  /** Add entities to pinboard */
  addToPinboard: (refs: EntityRef[]) => void;
  /** Remove entities from pinboard */
  removeFromPinboard: (refs: EntityRef[]) => void;
  /** Replace pinboard contents */
  setPinboard: (refs: EntityRef[]) => void;
  /** Clear pinboard */
  clearPinboard: () => void;
  /** Isolate pinboard entities (show only pinned) */
  showPinboard: () => void;
  /** Check if entity is pinned */
  isInPinboard: (ref: EntityRef) => boolean;
  /** Get pinboard count */
  getPinboardCount: () => number;
  /** Get all pinboard entities as EntityRef array */
  getPinboardEntities: () => EntityRef[];
}

export const createPinboardSlice: StateCreator<PinboardSlice, [], [], PinboardSlice> = (set, get) => ({
  // Initial state
  pinboardEntities: new Set(),

  // Actions
  addToPinboard: (refs) => {
    set((state) => {
      const next = new Set(state.pinboardEntities);
      for (const ref of refs) {
        next.add(entityRefToString(ref));
      }
      return { pinboardEntities: next };
    });
  },

  removeFromPinboard: (refs) => {
    set((state) => {
      const next = new Set(state.pinboardEntities);
      for (const ref of refs) {
        next.delete(entityRefToString(ref));
      }
      return { pinboardEntities: next };
    });
  },

  setPinboard: (refs) => {
    const next = new Set<string>();
    for (const ref of refs) {
      next.add(entityRefToString(ref));
    }
    set({ pinboardEntities: next });
  },

  clearPinboard: () => set({ pinboardEntities: new Set() }),

  showPinboard: () => {
    // This will be wired to isolateEntities via the store composition
    // For now, we trigger isolation through a listener pattern
    const entities = get().getPinboardEntities();
    if (entities.length === 0) return;

    // Use the store's isolateEntities - accessed via combined store
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = get() as any;
    if (store.isolateEntities) {
      // Convert EntityRef to global IDs for isolation
      const globalIds: number[] = [];
      for (const ref of entities) {
        if (store.models) {
          const model = store.models.get(ref.modelId);
          const offset = model?.idOffset ?? 0;
          globalIds.push(ref.expressId + offset);
        } else {
          globalIds.push(ref.expressId);
        }
      }
      store.isolateEntities(globalIds);
    }
  },

  isInPinboard: (ref) => get().pinboardEntities.has(entityRefToString(ref)),

  getPinboardCount: () => get().pinboardEntities.size,

  getPinboardEntities: () => {
    const result: EntityRef[] = [];
    for (const str of get().pinboardEntities) {
      result.push(stringToEntityRef(str));
    }
    return result;
  },
});

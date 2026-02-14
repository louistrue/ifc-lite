/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pinboard (Basket) state slice
 *
 * The basket is an incremental isolation set. Users build it with:
 *   = (set)    — replace basket with current selection
 *   + (add)    — add current selection to basket
 *   − (remove) — remove current selection from basket
 *
 * When the basket is non-empty, only basket entities are visible (isolation).
 * The basket also syncs to isolatedEntities for renderer consumption.
 */

import type { StateCreator } from 'zustand';
import type { EntityRef } from '../types.js';
import { entityRefToString, stringToEntityRef } from '../types.js';

/** Minimal interface for accessing isolation + models from the combined store */
interface CombinedStoreAccess {
  isolatedEntities?: Set<number> | null;
  hiddenEntities?: Set<number>;
  models?: Map<string, { idOffset: number }>;
}

export interface PinboardSlice {
  // State
  /** Serialized EntityRef strings for O(1) membership check */
  pinboardEntities: Set<string>;

  // Actions
  /** Add entities to pinboard/basket */
  addToPinboard: (refs: EntityRef[]) => void;
  /** Remove entities from pinboard/basket */
  removeFromPinboard: (refs: EntityRef[]) => void;
  /** Replace pinboard/basket contents (= operation) */
  setPinboard: (refs: EntityRef[]) => void;
  /** Clear pinboard/basket and isolation */
  clearPinboard: () => void;
  /** Isolate pinboard entities (sync basket → isolatedEntities) */
  showPinboard: () => void;
  /** Check if entity is in basket */
  isInPinboard: (ref: EntityRef) => boolean;
  /** Get basket count */
  getPinboardCount: () => number;
  /** Get all basket entities as EntityRef array */
  getPinboardEntities: () => EntityRef[];

  // Basket actions (semantic aliases that also sync isolation)
  /** = Set basket to exactly these entities and isolate them */
  setBasket: (refs: EntityRef[]) => void;
  /** + Add entities to basket and update isolation */
  addToBasket: (refs: EntityRef[]) => void;
  /** − Remove entities from basket and update isolation */
  removeFromBasket: (refs: EntityRef[]) => void;
  /** Clear basket and clear isolation */
  clearBasket: () => void;
}

/** Convert basket EntityRefs to global IDs using model offsets */
function basketToGlobalIds(
  basketEntities: Set<string>,
  models?: Map<string, { idOffset: number }>,
): Set<number> {
  const globalIds = new Set<number>();
  for (const str of basketEntities) {
    const ref = stringToEntityRef(str);
    if (models) {
      const model = models.get(ref.modelId);
      const offset = model?.idOffset ?? 0;
      globalIds.add(ref.expressId + offset);
    } else {
      globalIds.add(ref.expressId);
    }
  }
  return globalIds;
}

/** Compute a single EntityRef's global ID */
function refToGlobalId(ref: EntityRef, models?: Map<string, { idOffset: number }>): number {
  const model = models?.get(ref.modelId);
  return ref.expressId + (model?.idOffset ?? 0);
}

export const createPinboardSlice: StateCreator<PinboardSlice, [], [], PinboardSlice> = (set, get) => ({
  // Initial state
  pinboardEntities: new Set(),

  // Legacy actions (kept for backward compat, but now they also sync isolation)
  addToPinboard: (refs) => {
    set((state) => {
      const next = new Set<string>(state.pinboardEntities);
      for (const ref of refs) {
        next.add(entityRefToString(ref));
      }
      const store = state as unknown as CombinedStoreAccess;
      const isolatedEntities = basketToGlobalIds(next, store.models);
      const hiddenEntities = new Set<number>(store.hiddenEntities ?? []);
      // Unhide any entities being added to basket
      for (const ref of refs) {
        const model = store.models?.get(ref.modelId);
        const offset = model?.idOffset ?? 0;
        hiddenEntities.delete(ref.expressId + offset);
      }
      return { pinboardEntities: next, isolatedEntities, hiddenEntities };
    });
  },

  removeFromPinboard: (refs) => {
    set((state) => {
      const next = new Set<string>(state.pinboardEntities);
      for (const ref of refs) {
        next.delete(entityRefToString(ref));
      }
      if (next.size === 0) {
        return { pinboardEntities: next, isolatedEntities: null };
      }
      const store = state as unknown as CombinedStoreAccess;
      const isolatedEntities = basketToGlobalIds(next, store.models);
      return { pinboardEntities: next, isolatedEntities };
    });
  },

  setPinboard: (refs) => {
    const next = new Set<string>();
    for (const ref of refs) {
      next.add(entityRefToString(ref));
    }
    if (next.size === 0) {
      set({ pinboardEntities: next, isolatedEntities: null });
      return;
    }
    const store = get() as unknown as CombinedStoreAccess;
    const hiddenEntities = new Set<number>(store.hiddenEntities ?? []);
    // Unhide basket entities
    for (const ref of refs) {
      const model = store.models?.get(ref.modelId);
      const offset = model?.idOffset ?? 0;
      hiddenEntities.delete(ref.expressId + offset);
    }
    const isolatedEntities = basketToGlobalIds(next, store.models);
    set({ pinboardEntities: next, isolatedEntities, hiddenEntities });
  },

  clearPinboard: () => set({ pinboardEntities: new Set(), isolatedEntities: null }),

  showPinboard: () => {
    const state = get();
    if (state.pinboardEntities.size === 0) return;
    const store = state as unknown as CombinedStoreAccess;
    const isolatedEntities = basketToGlobalIds(state.pinboardEntities, store.models);
    set({ isolatedEntities });
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

  // ──────────────────────────────────────────────────────────────────────────
  // Basket actions (= + −)
  // These are the primary API for the new basket-based isolation UX.
  // ──────────────────────────────────────────────────────────────────────────

  /** = Set basket to exactly these entities and isolate them */
  setBasket: (refs) => {
    if (refs.length === 0) {
      set({ pinboardEntities: new Set(), isolatedEntities: null });
      return;
    }
    const next = new Set<string>();
    for (const ref of refs) {
      next.add(entityRefToString(ref));
    }
    const store = get() as unknown as CombinedStoreAccess;
    const hiddenEntities = new Set<number>(store.hiddenEntities ?? []);
    // Unhide basket entities
    for (const ref of refs) {
      const model = store.models?.get(ref.modelId);
      const offset = model?.idOffset ?? 0;
      hiddenEntities.delete(ref.expressId + offset);
    }
    const isolatedEntities = basketToGlobalIds(next, store.models);
    set({ pinboardEntities: next, isolatedEntities, hiddenEntities });
  },

  /** + Add entities to basket and update isolation (incremental — avoids re-parsing all strings) */
  addToBasket: (refs) => {
    if (refs.length === 0) return;
    set((state) => {
      const next = new Set<string>(state.pinboardEntities);
      for (const ref of refs) {
        next.add(entityRefToString(ref));
      }
      const store = state as unknown as CombinedStoreAccess;
      const hiddenEntities = new Set<number>(store.hiddenEntities ?? []);
      // Incrementally add new globalIds to existing isolation set instead of re-parsing all
      const prevIsolated = store.isolatedEntities;
      const isolatedEntities = prevIsolated ? new Set<number>(prevIsolated) : basketToGlobalIds(state.pinboardEntities, store.models);
      for (const ref of refs) {
        const gid = refToGlobalId(ref, store.models);
        isolatedEntities.add(gid);
        hiddenEntities.delete(gid);
      }
      return { pinboardEntities: next, isolatedEntities, hiddenEntities };
    });
  },

  /** − Remove entities from basket and update isolation (incremental — avoids re-parsing all strings) */
  removeFromBasket: (refs) => {
    if (refs.length === 0) return;
    set((state) => {
      const next = new Set<string>(state.pinboardEntities);
      for (const ref of refs) {
        next.delete(entityRefToString(ref));
      }
      if (next.size === 0) {
        return { pinboardEntities: next, isolatedEntities: null };
      }
      const store = state as unknown as CombinedStoreAccess;
      // Incrementally remove globalIds from existing isolation set instead of re-parsing all
      const prevIsolated = store.isolatedEntities;
      if (prevIsolated) {
        const isolatedEntities = new Set<number>(prevIsolated);
        for (const ref of refs) {
          isolatedEntities.delete(refToGlobalId(ref, store.models));
        }
        return { pinboardEntities: next, isolatedEntities };
      }
      // Fallback: full recompute if no existing isolation set
      const isolatedEntities = basketToGlobalIds(next, store.models);
      return { pinboardEntities: next, isolatedEntities };
    });
  },

  /** Clear basket and clear isolation */
  clearBasket: () => set({ pinboardEntities: new Set(), isolatedEntities: null }),
});

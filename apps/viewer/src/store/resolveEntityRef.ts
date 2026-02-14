/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Single source of truth for resolving a globalId to an EntityRef.
 *
 * Every code path that needs an EntityRef from a globalId MUST use this
 * function.  It guarantees consistent modelId values so that basket
 * add/remove keys always match, regardless of which UI surface triggered
 * the selection.
 */

import type { EntityRef } from './types.js';
import { useViewerStore } from './index.js';

/**
 * Resolve a globalId (renderer-space) to an EntityRef (model-space).
 *
 * Resolution order:
 *  1. resolveGlobalIdFromModels (offset-based range check — the canonical path)
 *  2. First loaded model as fallback (single-model, offset 0)
 *
 * NEVER returns 'legacy', 'default', or any hardcoded sentinel as modelId.
 */
export function resolveEntityRef(globalId: number): EntityRef | null {
  const state = useViewerStore.getState();
  const resolved = state.resolveGlobalIdFromModels(globalId);
  if (resolved) {
    return { modelId: resolved.modelId, expressId: resolved.expressId };
  }

  // Fallback: single-model mode where offset is 0 → globalId === expressId
  if (state.models.size > 0) {
    const firstModelId = state.models.keys().next().value as string;
    return { modelId: firstModelId, expressId: globalId };
  }

  return null;
}

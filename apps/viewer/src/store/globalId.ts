/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, FederatedModel } from './types.js';

type ModelMapLike = ReadonlyMap<string, Pick<FederatedModel, 'idOffset'>>;

/**
 * Convert a local expressId to the renderer/global ID space.
 *
 * This is the viewer-level single source of truth for modelId + expressId →
 * globalId conversion outside Zustand hooks. It preserves single-model legacy
 * behavior by falling back to the original expressId when no federated model
 * entry exists.
 */
export function toGlobalIdFromModels(
  models: ModelMapLike,
  modelId: string,
  expressId: number,
): number {
  if (modelId === 'legacy' || modelId === 'default' || modelId === '__legacy__') {
    return expressId;
  }

  const model = models.get(modelId);
  if (!model) {
    return expressId;
  }

  return expressId + model.idOffset;
}

/**
 * Convert an EntityRef to the renderer/global ID space.
 */
export function toGlobalIdForRef(
  models: ModelMapLike,
  ref: EntityRef,
): number {
  return toGlobalIdFromModels(models, ref.modelId, ref.expressId);
}

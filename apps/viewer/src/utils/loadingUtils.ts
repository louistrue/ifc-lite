/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared loading utilities used across all IFC loading hooks.
 *
 * Consolidates the guarded spatial-index build pattern that was
 * duplicated across useIfcLoader, useIfcCache, useIfcServer, and
 * useIfcFederation.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { buildSpatialIndexAsync } from '@ifc-lite/spatial';
import { useViewerStore } from '../store.js';

/**
 * Build a spatial index in the background (time-sliced, non-blocking)
 * with a guard against stale loads.
 *
 * The guard captures the dataStore reference and compares it to the
 * current store when the async build completes. If the store has been
 * replaced (e.g. user loaded a new file), the result is discarded.
 *
 * @param meshes - Final mesh array with correct IDs and world-space positions
 * @param dataStore - The IfcDataStore to attach the spatial index to
 * @param setIfcDataStore - Store setter to trigger re-render
 */
export function buildSpatialIndexGuarded(
  meshes: MeshData[],
  dataStore: IfcDataStore,
  setIfcDataStore: (store: IfcDataStore) => void,
): void {
  if (meshes.length === 0) return;

  const capturedStore = dataStore;
  buildSpatialIndexAsync(meshes).then(spatialIndex => {
    const { ifcDataStore: currentStore } = useViewerStore.getState();
    if (currentStore !== capturedStore) return;
    capturedStore.spatialIndex = spatialIndex;
    setIfcDataStore({ ...capturedStore });
  }).catch(err => {
    console.warn('[loadingUtils] Failed to build spatial index:', err);
  });
}

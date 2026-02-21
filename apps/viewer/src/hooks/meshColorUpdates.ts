/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MeshData } from '@ifc-lite/geometry';

/**
 * Apply color updates in-place to mesh arrays used by streaming/caching paths.
 */
export function applyColorUpdatesToMeshes(
  meshes: MeshData[],
  updates: Map<number, [number, number, number, number]>
): void {
  if (meshes.length === 0 || updates.size === 0) return;
  for (const mesh of meshes) {
    const color = updates.get(mesh.expressId);
    if (!color) continue;
    mesh.color = color;
  }
}

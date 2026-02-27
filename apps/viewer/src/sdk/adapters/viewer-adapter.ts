/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, SectionPlane, CameraState, ViewerBackendMethods, RGBAColor } from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { getModelForRef } from './model-compat.js';

const AXIS_TO_STORE: Record<string, 'down' | 'front' | 'side'> = {
  x: 'side',
  y: 'down',
  z: 'front',
};
const STORE_TO_AXIS: Record<string, 'x' | 'y' | 'z'> = {
  side: 'x',
  down: 'y',
  front: 'z',
};

type RGBA = [number, number, number, number];

export function createViewerAdapter(store: StoreApi): ViewerBackendMethods {
  // Track original mesh colors so resetColors() can restore them.
  // This is needed because updateMeshColors permanently changes mesh batch colors.
  const savedOriginalColors = new Map<number, RGBA>();

  /** Save original mesh colors before overriding (only saves once per ID). */
  function saveOriginals(colorMap: Map<number, RGBA>): void {
    const state = store.getState();
    if (state.models.size > 0) {
      for (const [, model] of state.models) {
        const geo = model.geometryResult;
        if (!geo?.meshes) continue;
        for (const mesh of geo.meshes) {
          if (colorMap.has(mesh.expressId) && !savedOriginalColors.has(mesh.expressId)) {
            savedOriginalColors.set(mesh.expressId, [...mesh.color] as RGBA);
          }
        }
      }
    } else if (state.geometryResult?.meshes) {
      for (const mesh of state.geometryResult.meshes) {
        if (colorMap.has(mesh.expressId) && !savedOriginalColors.has(mesh.expressId)) {
          savedOriginalColors.set(mesh.expressId, [...mesh.color] as RGBA);
        }
      }
    }
  }

  return {
    colorize(refs: EntityRef[], color: RGBA) {
      const state = store.getState();
      // Merge with existing pending colors (supports multiple colorize calls per script)
      const existing = state.pendingColorUpdates;
      const colorMap = existing ? new Map(existing) : new Map<number, RGBA>();
      for (const ref of refs) {
        const model = getModelForRef(state, ref.modelId);
        if (model) {
          const globalId = ref.expressId + model.idOffset;
          colorMap.set(globalId, color);
        }
      }
      // Use both approaches: updateMeshColors handles transparent meshes (IfcSpace etc.)
      // by moving them from transparent to opaque batches. The overlay handles opaque meshes.
      saveOriginals(colorMap);
      state.updateMeshColors(colorMap);
      state.setPendingColorUpdates(colorMap);
      return undefined;
    },
    colorizeAll(batches: Array<{ refs: EntityRef[]; color: RGBA }>) {
      const state = store.getState();
      const batchMap = new Map<number, RGBA>();
      for (const batch of batches) {
        for (const ref of batch.refs) {
          const model = getModelForRef(state, ref.modelId);
          if (model) {
            batchMap.set(ref.expressId + model.idOffset, batch.color);
          }
        }
      }
      // Use both: mesh color update (for transparent entities) + overlay (for opaque entities)
      saveOriginals(batchMap);
      state.updateMeshColors(batchMap);
      state.setPendingColorUpdates(batchMap);
      return undefined;
    },
    resetColors() {
      const state = store.getState();
      // Restore original mesh colors (reverses transparent→opaque batch moves)
      if (savedOriginalColors.size > 0) {
        state.updateMeshColors(savedOriginalColors);
        savedOriginalColors.clear();
      }
      // Clear overlay (empty map triggers clearColorOverrides; null would skip the effect)
      state.setPendingColorUpdates(new Map());
      return undefined;
    },
    flyTo() {
      // flyTo requires renderer access — wired via useBimHost
      return undefined;
    },
    setSection(section: SectionPlane | null) {
      const state = store.getState();
      if (section) {
        state.setSectionPlaneAxis?.(AXIS_TO_STORE[section.axis] ?? 'down');
        state.setSectionPlanePosition?.(section.position);
        if (section.flipped !== undefined && state.sectionPlane?.flipped !== section.flipped) {
          state.flipSectionPlane?.();
        }
        if (state.sectionPlane?.enabled !== section.enabled) {
          state.toggleSectionPlane?.();
        }
      } else {
        if (state.sectionPlane?.enabled) {
          state.toggleSectionPlane?.();
        }
      }
      return undefined;
    },
    getSection() {
      const state = store.getState();
      if (!state.sectionPlane?.enabled) return null;
      return {
        axis: STORE_TO_AXIS[state.sectionPlane.axis] ?? 'y',
        position: state.sectionPlane.position,
        enabled: state.sectionPlane.enabled,
        flipped: state.sectionPlane.flipped,
      };
    },
    setCamera(cameraState: Partial<CameraState>) {
      const state = store.getState();
      if (cameraState.mode) {
        state.setProjectionMode?.(cameraState.mode);
      }
      return undefined;
    },
    getCamera() {
      const state = store.getState();
      return { mode: state.projectionMode ?? 'perspective' };
    },
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef, SectionPlane, CameraState } from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';

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

export function createViewerAdapter(store: StoreApi): NamespaceAdapter {
  return {
    dispatch(method: string, args: unknown[]): unknown {
      const state = store.getState();
      switch (method) {
        case 'colorize': {
          const refs = args[0] as EntityRef[];
          const color = args[1] as [number, number, number, number];
          const colorMap = new Map<number, [number, number, number, number]>();
          for (const ref of refs) {
            const model = state.models.get(ref.modelId);
            if (model) {
              const globalId = ref.expressId + model.idOffset;
              colorMap.set(globalId, color);
            }
          }
          state.setPendingColorUpdates(colorMap);
          return undefined;
        }
        case 'resetColors':
          state.clearPendingColorUpdates();
          return undefined;
        case 'flyTo':
          // flyTo requires renderer access — wired via useBimHost
          return undefined;
        case 'setSection': {
          const section = args[0] as SectionPlane | null;
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
        }
        case 'getSection': {
          if (!state.sectionPlane?.enabled) return null;
          return {
            axis: STORE_TO_AXIS[state.sectionPlane.axis] ?? 'y',
            position: state.sectionPlane.position,
            enabled: state.sectionPlane.enabled,
            flipped: state.sectionPlane.flipped,
          };
        }
        case 'setCamera': {
          const cameraState = args[0] as Partial<CameraState>;
          if (cameraState.mode) {
            state.setProjectionMode?.(cameraState.mode);
          }
          return undefined;
        }
        case 'getCamera':
          return { mode: state.projectionMode ?? 'perspective' };
        default:
          throw new Error(`Unknown viewer method: ${method}`);
      }
    },
  };
}

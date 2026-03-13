/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * StreamingViewerAdapter — Forwards bim.viewer.* and bim.visibility.*
 * calls to a running `ifc-lite view` server via its REST API.
 *
 * When eval/run/create commands are invoked with `--viewer PORT`, this
 * adapter replaces the headless no-op viewer methods so that SDK calls
 * like `bim.viewer.colorize(...)` actually update the 3D viewer in
 * real time.
 */

import type {
  ViewerBackendMethods,
  VisibilityBackendMethods,
  EntityRef,
} from '@ifc-lite/sdk';
import type { RGBAColor } from '@ifc-lite/sdk';

/** Post a command to the running viewer server. Fire-and-forget. */
function sendCommand(port: number, cmd: Record<string, unknown>): void {
  fetch(`http://localhost:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  }).catch(() => {
    /* silent — viewer may have closed */
  });
}

function refsToIds(refs: EntityRef[]): number[] {
  return refs.map(r => r.expressId);
}

/**
 * Create a ViewerBackendMethods that streams commands to a running viewer.
 */
export function createStreamingViewerAdapter(port: number): ViewerBackendMethods {
  return {
    colorize(refs: EntityRef[], color: RGBAColor): void {
      sendCommand(port, {
        action: 'colorizeEntities',
        ids: refsToIds(refs),
        color: [color.r, color.g, color.b, color.a ?? 1],
      });
    },

    colorizeAll(batches: Array<{ refs: EntityRef[]; color: RGBAColor }>): void {
      for (const batch of batches) {
        sendCommand(port, {
          action: 'colorizeEntities',
          ids: refsToIds(batch.refs),
          color: [batch.color.r, batch.color.g, batch.color.b, batch.color.a ?? 1],
        });
      }
    },

    resetColors(refs?: EntityRef[]): void {
      if (refs && refs.length > 0) {
        sendCommand(port, {
          action: 'resetColorEntities',
          ids: refsToIds(refs),
        });
      } else {
        sendCommand(port, { action: 'showall' });
      }
    },

    flyTo(refs: EntityRef[]): void {
      sendCommand(port, {
        action: 'flyto',
        ids: refsToIds(refs),
      });
    },

    setSection(section: unknown): void {
      sendCommand(port, {
        action: 'section',
        section,
      });
    },

    getSection() {
      return null;
    },

    setCamera(state: unknown): void {
      sendCommand(port, {
        action: 'camera',
        state,
      });
    },

    getCamera() {
      return { mode: 'perspective' as const };
    },
  };
}

/**
 * Create a VisibilityBackendMethods that streams commands to a running viewer.
 */
export function createStreamingVisibilityAdapter(port: number): VisibilityBackendMethods {
  return {
    hide(refs: EntityRef[]): void {
      sendCommand(port, {
        action: 'hideEntities',
        ids: refsToIds(refs),
      });
    },

    show(refs: EntityRef[]): void {
      sendCommand(port, {
        action: 'showEntities',
        ids: refsToIds(refs),
      });
    },

    isolate(refs: EntityRef[]): void {
      sendCommand(port, {
        action: 'isolateEntities',
        ids: refsToIds(refs),
      });
    },

    reset(): void {
      sendCommand(port, { action: 'showall' });
    },
  };
}

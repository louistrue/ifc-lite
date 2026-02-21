/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Inbound postMessage command handler.
 *
 * Receives commands from the parent SDK and dispatches them to the store
 * and renderer. Also handles the READY → INIT → INIT_ACK handshake.
 */

import {
  isEmbedMessage,
  createResponse,
  createEvent,
  EMBED_SOURCE,
  PROTOCOL_VERSION,
  type EmbedMessageEnvelope,
  type InboundCommandType,
  type InboundPayloads,
  type ModelInfo,
  type ViewPreset,
  type SectionAxis,
} from '@ifc-lite/embed-protocol';
import type { ViewerState } from '@/store/index.js';

/** Reference to the store's getState / setState for imperative access */
interface BridgeContext {
  getState: () => ViewerState;
  /** Callback to load a model from URL (async) */
  loadModelFromUrl: (url: string) => Promise<{ entities: number; triangles: number; vertices: number }>;
  /** Callback to load a model from ArrayBuffer */
  loadModelFromBuffer: (buffer: ArrayBuffer, name?: string) => Promise<{ entities: number; triangles: number; vertices: number }>;
}

let ctx: BridgeContext | null = null;
let parentOrigin: string = '*';

/** Initialize the bridge with store and callback references */
export function initBridge(context: BridgeContext) {
  ctx = context;
  window.addEventListener('message', onMessage);

  // Send READY event to parent
  emitToParent(createEvent('READY', { version: PROTOCOL_VERSION }));
}

/** Clean up the bridge */
export function destroyBridge() {
  window.removeEventListener('message', onMessage);
  ctx = null;
}

/** Emit an event to the parent window */
export function emitToParent(msg: EmbedMessageEnvelope, transfer?: Transferable[]) {
  if (window.parent === window) return; // Not in an iframe
  window.parent.postMessage(msg, parentOrigin, transfer ?? []);
}

/** Emit a typed event to the parent */
export function emitEvent(type: string, data?: unknown) {
  emitToParent({
    source: EMBED_SOURCE,
    version: PROTOCOL_VERSION,
    type,
    data,
  });
}

// ---- Internal message handler ----

function onMessage(event: MessageEvent) {
  if (!isEmbedMessage(event.data)) return;
  if (!ctx) return;

  const msg = event.data as EmbedMessageEnvelope;

  // Track parent origin for responses (but accept * initially for handshake)
  if (event.origin && event.origin !== 'null') {
    parentOrigin = event.origin;
  }

  const { type, requestId, data } = msg;

  // Handle commands with request/response pattern
  if (requestId) {
    handleCommand(type as InboundCommandType, data, requestId).catch((err) => {
      emitToParent(createResponse(requestId, undefined, {
        code: 'COMMAND_FAILED',
        message: err instanceof Error ? err.message : String(err),
      }));
    });
    return;
  }

  // Handle fire-and-forget commands (no requestId)
  handleCommand(type as InboundCommandType, data).catch(() => {
    // Silently ignore errors on fire-and-forget commands
  });
}

async function handleCommand(type: InboundCommandType, data: unknown, requestId?: string) {
  if (!ctx) throw new Error('Bridge not initialized');
  const state = ctx.getState();

  switch (type) {
    case 'INIT': {
      const payload = data as InboundPayloads['INIT'];
      // Apply initial config if provided
      if (payload?.config?.theme) state.setTheme(payload.config.theme);
      // ACK the init
      if (requestId) {
        emitToParent(createResponse(requestId));
      }
      emitEvent('INIT_ACK');
      return;
    }

    case 'LOAD_MODEL': {
      const payload = data as InboundPayloads['LOAD_MODEL'];
      const stats = await ctx.loadModelFromUrl(payload.url);
      if (requestId) emitToParent(createResponse(requestId, stats));
      return;
    }

    case 'LOAD_MODEL_BUFFER': {
      const buffer = data as ArrayBuffer;
      const stats = await ctx.loadModelFromBuffer(buffer);
      if (requestId) emitToParent(createResponse(requestId, stats));
      return;
    }

    case 'ADD_MODEL': {
      const payload = data as InboundPayloads['ADD_MODEL'];
      const stats = await ctx.loadModelFromUrl(payload.url);
      if (requestId) emitToParent(createResponse(requestId, { modelId: 'latest', ...stats }));
      return;
    }

    case 'REMOVE_MODEL': {
      const payload = data as InboundPayloads['REMOVE_MODEL'];
      state.removeModel(payload.modelId);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SELECT': {
      const payload = data as InboundPayloads['SELECT'];
      if (payload.ids.length === 0) {
        state.clearEntitySelection();
      } else {
        state.setSelectedEntityId(payload.ids[0]);
        state.setSelectedEntityIds(payload.ids);
      }
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SELECT_BY_GUID': {
      const payload = data as InboundPayloads['SELECT_BY_GUID'];
      // Search all models for matching GlobalId attributes
      const resolved: number[] = [];
      for (const [, model] of state.models) {
        const ds = model.ifcDataStore;
        if (!ds?.entities) continue;
        for (let i = 0; i < ds.entities.count; i++) {
          const attrs = ds.entities.getAttributes?.(i);
          if (attrs && payload.guids.includes(String(attrs.GlobalId))) {
            resolved.push(i + model.idOffset);
          }
        }
      }
      if (resolved.length > 0) {
        state.setSelectedEntityId(resolved[0]);
        state.setSelectedEntityIds(resolved);
      }
      if (requestId) emitToParent(createResponse(requestId, { resolved }));
      return;
    }

    case 'CLEAR_SELECTION': {
      state.clearEntitySelection();
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'ISOLATE': {
      const payload = data as InboundPayloads['ISOLATE'];
      state.isolateEntities(payload.ids);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'HIDE': {
      const payload = data as InboundPayloads['HIDE'];
      state.hideEntities(payload.ids);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SHOW': {
      const payload = data as InboundPayloads['SHOW'];
      state.showEntities(payload.ids);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SHOW_ALL': {
      state.showAllInAllModels();
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_COLORS': {
      const payload = data as InboundPayloads['SET_COLORS'];
      const updates = new Map<number, [number, number, number, number]>();
      for (const [key, color] of Object.entries(payload.colorMap)) {
        updates.set(Number(key), color);
      }
      state.updateMeshColors(updates);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'RESET_COLORS': {
      state.clearPendingColorUpdates();
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'FIT_TO_VIEW': {
      const payload = data as InboundPayloads['FIT_TO_VIEW'];
      if (payload?.ids && payload.ids.length > 0) {
        state.setSelectedEntityIds(payload.ids);
        state.cameraCallbacks.frameSelection?.();
      } else {
        state.cameraCallbacks.fitAll?.();
      }
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_CAMERA': {
      const payload = data as InboundPayloads['SET_CAMERA'];
      state.setCameraRotation({ azimuth: payload.azimuth, elevation: payload.elevation });
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_VIEW': {
      const payload = data as InboundPayloads['SET_VIEW'];
      state.cameraCallbacks.setPresetView?.(payload.preset as ViewPreset);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_SECTION': {
      const payload = data as InboundPayloads['SET_SECTION'];
      if (payload.axis !== undefined) state.setSectionPlaneAxis(payload.axis as SectionAxis);
      if (payload.position !== undefined) state.setSectionPlanePosition(payload.position);
      if (payload.enabled !== undefined) {
        const current = state.sectionPlane.enabled;
        if (current !== payload.enabled) state.toggleSectionPlane();
      }
      if (payload.flipped !== undefined) {
        const current = state.sectionPlane.flipped;
        if (current !== payload.flipped) state.flipSectionPlane();
      }
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_THEME': {
      const payload = data as InboundPayloads['SET_THEME'];
      state.setTheme(payload.theme);
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'SET_TYPE_VISIBILITY': {
      const payload = data as InboundPayloads['SET_TYPE_VISIBILITY'];
      const tv = state.typeVisibility;
      if (payload.spaces !== undefined && tv.spaces !== payload.spaces) state.toggleTypeVisibility('spaces');
      if (payload.openings !== undefined && tv.openings !== payload.openings) state.toggleTypeVisibility('openings');
      if (payload.site !== undefined && tv.site !== payload.site) state.toggleTypeVisibility('site');
      if (requestId) emitToParent(createResponse(requestId));
      return;
    }

    case 'GET_PROPERTIES': {
      const payload = data as InboundPayloads['GET_PROPERTIES'];
      // Find entity across all models
      const lookup = state.resolveGlobalIdFromModels(payload.id);
      if (!lookup) {
        if (requestId) emitToParent(createResponse(requestId, undefined, { code: 'NOT_FOUND', message: `Entity ${payload.id} not found` }));
        return;
      }
      const model = state.models.get(lookup.modelId);
      const ds = model?.ifcDataStore;
      const attrs = ds?.entities?.getAttributes?.(lookup.expressId);
      if (requestId) {
        emitToParent(createResponse(requestId, {
          expressId: lookup.expressId,
          ifcType: attrs?.type,
          name: attrs?.Name,
          globalId: attrs?.GlobalId,
          attributes: attrs || {},
          propertySets: [],
          quantitySets: [],
        }));
      }
      return;
    }

    case 'GET_SCREENSHOT': {
      // Screenshot requires canvas access - return placeholder for now
      if (requestId) {
        emitToParent(createResponse(requestId, undefined, {
          code: 'NOT_IMPLEMENTED',
          message: 'GET_SCREENSHOT not yet implemented',
        }));
      }
      return;
    }

    case 'GET_MODEL_INFO': {
      const models = Array.from(state.models.values());
      const info: ModelInfo = {
        models: models.map(m => ({
          modelId: m.id,
          name: m.name,
          entityCount: m.ifcDataStore?.entities?.count ?? 0,
          triangleCount: m.geometryResult?.totalTriangles ?? 0,
          visible: m.visible,
        })),
        totalEntities: models.reduce((sum, m) => sum + (m.ifcDataStore?.entities?.count ?? 0), 0),
        totalTriangles: models.reduce((sum, m) => sum + (m.geometryResult?.totalTriangles ?? 0), 0),
      };
      if (requestId) emitToParent(createResponse(requestId, info));
      return;
    }

    default:
      if (requestId) {
        emitToParent(createResponse(requestId, undefined, {
          code: 'UNKNOWN_COMMAND',
          message: `Unknown command: ${type}`,
        }));
      }
  }
}

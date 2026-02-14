/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BimHost — the viewer-side connection acceptor.
 *
 * The viewer creates a BimHost and registers its BimBackend.
 * External tools (ifc-scripts, ifc-flow) connect via transport and
 * send SdkRequests, which the host dispatches to the backend.
 *
 * Usage (viewer side):
 *   const host = new BimHost(backend)
 *   host.listenBroadcast('ifc-lite')  // Accept connections on BroadcastChannel
 */

import type {
  BimBackend,
  SdkRequest,
  SdkResponse,
  SdkEvent,
  BimEventType,
} from './types.js';

export class BimHost {
  private backend: BimBackend;
  private channels: BroadcastChannel[] = [];
  private ports: MessagePort[] = [];
  private eventSubscriptions: Array<() => void> = [];

  constructor(backend: BimBackend) {
    this.backend = backend;
  }

  /** Listen for connections on a BroadcastChannel */
  listenBroadcast(channelName: string): void {
    const channel = new BroadcastChannel(channelName);
    this.channels.push(channel);

    channel.onmessage = (event: MessageEvent) => {
      const request = event.data as SdkRequest;
      if (!request || typeof request !== 'object' || !('id' in request) || !('namespace' in request)) {
        return; // Not an SDK request
      }
      const response = this.dispatch(request);
      channel.postMessage(response);
    };

    // Forward events to connected clients
    this.forwardEvents((sdkEvent) => {
      channel.postMessage(sdkEvent);
    });
  }

  /** Accept a MessagePort connection (for iframe / worker) */
  acceptPort(port: MessagePort): void {
    this.ports.push(port);

    port.onmessage = (event: MessageEvent) => {
      const request = event.data as SdkRequest;
      if (!request || typeof request !== 'object' || !('id' in request) || !('namespace' in request)) {
        return;
      }
      const response = this.dispatch(request);
      port.postMessage(response);
    };

    this.forwardEvents((sdkEvent) => {
      port.postMessage(sdkEvent);
    });
  }

  /** Dispatch an SdkRequest to the backend and return the response */
  dispatch(request: SdkRequest): SdkResponse {
    try {
      const result = this.callBackend(request.namespace, request.method, request.args);
      return { id: request.id, result };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        id: request.id,
        error: { message: error.message, stack: error.stack },
      };
    }
  }

  /** Map namespace.method to backend calls */
  private callBackend(namespace: string, method: string, args: unknown[]): unknown {
    switch (`${namespace}.${method}`) {
      // Model
      case 'model.list': return this.backend.getModels();
      case 'model.activeId': return this.backend.getActiveModelId();

      // Query
      case 'query.entities': return this.backend.queryEntities(args[0] as Parameters<BimBackend['queryEntities']>[0]);
      case 'query.entityData': return this.backend.getEntityData(args[0] as Parameters<BimBackend['getEntityData']>[0]);
      case 'query.properties': return this.backend.getEntityProperties(args[0] as Parameters<BimBackend['getEntityProperties']>[0]);
      case 'query.quantities': return this.backend.getEntityQuantities(args[0] as Parameters<BimBackend['getEntityQuantities']>[0]);
      case 'query.related': return this.backend.getEntityRelated(
        args[0] as Parameters<BimBackend['getEntityRelated']>[0],
        args[1] as string,
        args[2] as 'forward' | 'inverse',
      );

      // Selection
      case 'selection.get': return this.backend.getSelection();
      case 'selection.set': return this.backend.setSelection(args[0] as Parameters<BimBackend['setSelection']>[0]);

      // Visibility
      case 'visibility.hide': return this.backend.hideEntities(args[0] as Parameters<BimBackend['hideEntities']>[0]);
      case 'visibility.show': return this.backend.showEntities(args[0] as Parameters<BimBackend['showEntities']>[0]);
      case 'visibility.isolate': return this.backend.isolateEntities(args[0] as Parameters<BimBackend['isolateEntities']>[0]);
      case 'visibility.reset': return this.backend.resetVisibility();

      // Viewer
      case 'viewer.colorize': return this.backend.colorize(
        args[0] as Parameters<BimBackend['colorize']>[0],
        args[1] as [number, number, number, number],
      );
      case 'viewer.resetColors': return this.backend.resetColors(args[0] as Parameters<BimBackend['resetColors']>[0]);
      case 'viewer.flyTo': return this.backend.flyTo(args[0] as Parameters<BimBackend['flyTo']>[0]);
      case 'viewer.setSection': return this.backend.setSection(args[0] as Parameters<BimBackend['setSection']>[0]);
      case 'viewer.getSection': return this.backend.getSection();
      case 'viewer.setCamera': return this.backend.setCamera(args[0] as Parameters<BimBackend['setCamera']>[0]);
      case 'viewer.getCamera': return this.backend.getCamera();

      // Mutation
      case 'mutate.setProperty': return this.backend.setProperty(
        args[0] as Parameters<BimBackend['setProperty']>[0],
        args[1] as string,
        args[2] as string,
        args[3] as string | number | boolean,
      );
      case 'mutate.deleteProperty': return this.backend.deleteProperty(
        args[0] as Parameters<BimBackend['deleteProperty']>[0],
        args[1] as string,
        args[2] as string,
      );
      case 'mutate.undo': return this.backend.undo(args[0] as string);
      case 'mutate.redo': return this.backend.redo(args[0] as string);

      // Spatial
      case 'spatial.queryBounds': return this.backend.queryBounds(
        args[0] as string,
        args[1] as Parameters<BimBackend['queryBounds']>[1],
      );
      case 'spatial.raycast': return this.backend.spatialRaycast(
        args[0] as string,
        args[1] as [number, number, number],
        args[2] as [number, number, number],
      );
      case 'spatial.queryFrustum': return this.backend.queryFrustum(
        args[0] as string,
        args[1] as Parameters<BimBackend['queryFrustum']>[1],
      );

      default:
        throw new Error(`Unknown SDK method: ${namespace}.${method}`);
    }
  }

  /** Subscribe to backend events and forward them */
  private forwardEvents(emit: (event: SdkEvent) => void): void {
    const events: BimEventType[] = [
      'selection:changed',
      'visibility:changed',
      'model:loaded',
      'model:removed',
      'mutation:changed',
      'lens:changed',
    ];

    for (const eventType of events) {
      const unsub = this.backend.subscribe(eventType, (data) => {
        emit({ type: eventType, data });
      });
      this.eventSubscriptions.push(unsub);
    }
  }

  /** Shut down all connections */
  close(): void {
    for (const channel of this.channels) {
      channel.close();
    }
    for (const port of this.ports) {
      port.close();
    }
    for (const unsub of this.eventSubscriptions) {
      unsub();
    }
    this.channels = [];
    this.ports = [];
    this.eventSubscriptions = [];
  }
}

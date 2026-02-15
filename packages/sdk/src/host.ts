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
 * Uses dispatchToBackend() to route string-based SdkRequests to the
 * typed namespace methods on the BimBackend.
 */

import type {
  BimBackend,
  SdkRequest,
  SdkResponse,
  SdkEvent,
  BimEventType,
} from './types.js';
import { dispatchToBackend } from './types.js';

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
        return;
      }
      const response = this.dispatch(request);
      channel.postMessage(response);
    };

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
      const result = dispatchToBackend(this.backend, request.namespace, request.method, request.args);
      return { id: request.id, result };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        id: request.id,
        error: { message: error.message, stack: error.stack },
      };
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

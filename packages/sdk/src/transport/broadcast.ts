/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BroadcastTransport — connects to a BimHost in another tab via BroadcastChannel.
 *
 * Usage (script IDE side):
 *   const transport = new BroadcastTransport('ifc-lite')
 *   const bim = createBimContext({ transport })
 *
 * The viewer (host side) listens on the same channel name via BimHost.
 */

import type { SdkRequest, SdkResponse, SdkEvent, Transport } from '../types.js';

export class BroadcastTransport implements Transport {
  private channel: BroadcastChannel;
  private pending = new Map<string, {
    resolve: (response: SdkResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private eventHandlers = new Set<(event: SdkEvent) => void>();
  private timeoutMs: number;

  constructor(channelName: string, options?: { timeoutMs?: number }) {
    this.channel = new BroadcastChannel(channelName);
    this.timeoutMs = options?.timeoutMs ?? 30_000;

    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data;

      // Response to a request
      if (data && typeof data === 'object' && 'id' in data && ('result' in data || 'error' in data)) {
        const response = data as SdkResponse;
        const entry = this.pending.get(response.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(response.id);
          entry.resolve(response);
        }
        return;
      }

      // Event from host
      if (data && typeof data === 'object' && 'type' in data && 'data' in data) {
        const sdkEvent = data as SdkEvent;
        for (const handler of this.eventHandlers) {
          handler(sdkEvent);
        }
      }
    };
  }

  async send(request: SdkRequest): Promise<SdkResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`BroadcastTransport: Request ${request.id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(request.id, { resolve, reject, timer });
      this.channel.postMessage(request);
    });
  }

  subscribe(handler: (event: SdkEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => { this.eventHandlers.delete(handler); };
  }

  close(): void {
    const closeError = new Error('BroadcastTransport: Transport closed');
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(closeError);
    }
    this.pending.clear();
    this.eventHandlers.clear();
    this.channel.close();
  }
}

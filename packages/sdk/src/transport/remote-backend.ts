/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RemoteBackend — implements BimBackend by proxying all calls over a Transport.
 *
 * Used when the SDK is in a different context than the viewer (cross-tab, iframe, etc).
 * With the generic dispatch pattern, this is a simple transport proxy:
 * every dispatch() call serializes to an SdkRequest and sends it through the transport.
 */

import type {
  BimBackend,
  Transport,
  BimEventType,
} from '../types.js';

let requestCounter = 0;

export class RemoteBackend implements BimBackend {
  constructor(private transport: Transport) {}

  dispatch(namespace: string, method: string, args: unknown[]): unknown {
    const id = `req-${requestCounter++}`;
    // Note: In a real async implementation, this would return a Promise.
    // For the initial SDK, we use synchronous semantics for the BimBackend
    // interface. A future iteration will make dispatch async and use the
    // transport's send() to await the response.
    throw new Error(
      `RemoteBackend: Cannot call ${namespace}.${method} synchronously. ` +
      `Remote transport requires async implementation. Request ID: ${id}`
    );
  }

  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void {
    return this.transport.subscribe((sdkEvent) => {
      if (sdkEvent.type === event) {
        handler(sdkEvent.data);
      }
    });
  }
}

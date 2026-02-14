/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Transport layer types — how SDK commands cross context boundaries.
 *
 * LocalTransport: direct function calls (zero overhead)
 * BroadcastTransport: BroadcastChannel API (cross-tab)
 * MessagePortTransport: MessagePort (iframe / worker)
 * WebSocketTransport: WebSocket (cross-process, Tauri, server)
 */

// Re-export from main types
export type { SdkRequest, SdkResponse, SdkEvent, Transport } from '../types.js';

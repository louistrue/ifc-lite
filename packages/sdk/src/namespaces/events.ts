/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, BimEventType, BimEventHandler, BimEventData } from '../types.js';

/** bim.events — Subscribe to viewer state changes */
export class EventsNamespace {
  private unsubscribers = new Map<string, () => void>();
  private nextId = 0;

  constructor(private backend: BimBackend) {}

  /** Subscribe to an event. Returns unsubscribe function. */
  on<T extends BimEventType>(event: T, handler: BimEventHandler<T>): () => void {
    const id = `${event}-${this.nextId++}`;
    const unsub = this.backend.subscribe(event, handler as (data: unknown) => void);
    this.unsubscribers.set(id, unsub);
    return () => {
      unsub();
      this.unsubscribers.delete(id);
    };
  }

  /** Unsubscribe all listeners */
  removeAll(): void {
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
  }
}

// Re-export event types for convenience
export type { BimEventType, BimEventHandler, BimEventData };

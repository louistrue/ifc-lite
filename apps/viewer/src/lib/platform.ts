/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Platform detection utilities for runtime bridge pattern
 * Routes to WASM (browser) or native (Tauri desktop) implementations
 */

/**
 * Detects if running in Tauri desktop environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Platform-specific cache implementation
 * Returns 'indexeddb' for browser, 'filesystem' for desktop
 */
export function getCacheType(): 'indexeddb' | 'filesystem' {
  return isTauri() ? 'filesystem' : 'indexeddb';
}

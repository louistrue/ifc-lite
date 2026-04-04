/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

type LogLevel = 'info' | 'warn' | 'error';

export async function logToDesktopTerminal(level: LogLevel, message: string): Promise<void> {
  const win = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke: InvokeFn } };
  if (!win.__TAURI_INTERNALS__?.invoke) {
    return;
  }

  try {
    await win.__TAURI_INTERNALS__.invoke('frontend_debug_log', { level, message });
  } catch {
    // Debug logging should never break app behavior.
  }
}

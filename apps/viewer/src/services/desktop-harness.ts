/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { NativeFileHandle } from './file-dialog.js';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriInternals {
  invoke: InvokeFn;
}

export interface DesktopHarnessRequest {
  file: NativeFileHandle;
  replaceFile?: NativeFileHandle;
  telemetryOutputPath?: string;
  runLabel?: string;
  exitAfterTelemetry: boolean;
  waitForMetadataCompletion: boolean;
}

export interface DesktopTelemetryReport {
  schemaVersion: number;
  source: 'desktop-native';
  mode: 'startup-harness' | 'manual';
  success: boolean;
  runLabel?: string;
  cache?: {
    key?: string | null;
    hit?: boolean | null;
    manifestMeshCount?: number | null;
    manifestShardCount?: number | null;
  } | null;
  file: {
    path: string;
    name: string;
    sizeBytes: number;
    sizeMB: number;
  };
  timings: Record<string, number | null>;
  batches: Record<string, number | string | null>;
  nativeStats?: Record<string, number | null> | null;
  metadata?: Record<string, number | boolean | null> | null;
  firstBatchTelemetry?: Record<string, number | string | null> | null;
  error?: string;
}

let activeHarnessRequest: DesktopHarnessRequest | null = null;
let startupHarnessRequestPromise: Promise<DesktopHarnessRequest | null> | null = null;
const STORAGE_KEY = 'ifc-lite:desktop-harness-request';
const CLAIMED_KEY = 'ifc-lite:desktop-harness-claimed';

function getInvoke(): InvokeFn | null {
  const win = globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return win.__TAURI_INTERNALS__?.invoke ?? null;
}

async function consumeStartupHarnessRequest(): Promise<DesktopHarnessRequest | null> {
  const invoke = getInvoke();
  if (!invoke) {
    return null;
  }

  try {
    return await invoke<DesktopHarnessRequest | null>('consume_startup_harness_request');
  } catch (error) {
    console.warn('[DesktopHarness] Failed to consume startup harness request:', error);
    return null;
  }
}

function getHarnessRequestFingerprint(request: DesktopHarnessRequest): string {
  return JSON.stringify({
    path: request.file.path,
    replacePath: request.replaceFile?.path ?? null,
    telemetryOutputPath: request.telemetryOutputPath ?? null,
    runLabel: request.runLabel ?? null,
    exitAfterTelemetry: request.exitAfterTelemetry,
    waitForMetadataCompletion: request.waitForMetadataCompletion,
  });
}

function getClaimedFingerprint(): string | null {
  try {
    return sessionStorage.getItem(CLAIMED_KEY);
  } catch {
    return null;
  }
}

function setClaimedFingerprint(fingerprint: string | null): void {
  try {
    if (fingerprint) {
      sessionStorage.setItem(CLAIMED_KEY, fingerprint);
    } else {
      sessionStorage.removeItem(CLAIMED_KEY);
    }
  } catch {
    // Ignore storage issues.
  }
}

export function setActiveHarnessRequest(request: DesktopHarnessRequest | null): void {
  activeHarnessRequest = request;
  try {
    if (request) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
      if (getClaimedFingerprint() !== getHarnessRequestFingerprint(request)) {
        setClaimedFingerprint(null);
      }
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage issues in non-browser or restricted contexts.
  }
}

export function getActiveHarnessRequest(): DesktopHarnessRequest | null {
  if (!activeHarnessRequest) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        activeHarnessRequest = JSON.parse(raw) as DesktopHarnessRequest;
      }
    } catch {
      // Ignore storage parse failures and fall back to in-memory state.
    }
  }
  return activeHarnessRequest;
}

export async function getStartupHarnessRequest(): Promise<DesktopHarnessRequest | null> {
  const existing = getActiveHarnessRequest();
  if (existing) {
    return existing;
  }

  if (!startupHarnessRequestPromise) {
    startupHarnessRequestPromise = consumeStartupHarnessRequest().then((request) => {
      if (request) {
        setActiveHarnessRequest(request);
      }
      return request;
    });
  }

  return await startupHarnessRequestPromise;
}

export function tryClaimStartupHarnessRequest(request: DesktopHarnessRequest): boolean {
  const active = getActiveHarnessRequest();
  if (!active) {
    return false;
  }

  const requestFingerprint = getHarnessRequestFingerprint(request);
  if (getHarnessRequestFingerprint(active) !== requestFingerprint) {
    return false;
  }

  if (getClaimedFingerprint() === requestFingerprint) {
    return false;
  }

  setClaimedFingerprint(requestFingerprint);
  return true;
}

export function clearActiveHarnessRequest(): void {
  activeHarnessRequest = null;
  startupHarnessRequestPromise = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage issues.
  }
  setClaimedFingerprint(null);
}

export async function finalizeActiveHarnessRun(report: DesktopTelemetryReport): Promise<string | null> {
  const invoke = getInvoke();
  const request = getActiveHarnessRequest();
  clearActiveHarnessRequest();

  if (!invoke || !request) {
    return null;
  }

  try {
    return await invoke<string>('write_desktop_telemetry', { report });
  } catch (error) {
    console.warn('[DesktopHarness] Failed to write desktop telemetry:', error);
    return null;
  }
}

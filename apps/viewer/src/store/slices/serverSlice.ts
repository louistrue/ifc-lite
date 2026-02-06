/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Server settings state slice
 *
 * Manages connection state to the IFC-Lite server, including health checks
 * and analytics availability detection.
 */

import type { StateCreator } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export interface ServerSliceState {
  /** Server URL (from env var or user input) */
  serverUrl: string;
  /** Whether the server health check passed */
  isServerConnected: boolean;
  /** Whether the server has analytics (DATABASE_URL) enabled */
  isAnalyticsAvailable: boolean;
  /** Whether a health check is in progress */
  serverCheckInProgress: boolean;
  /** Error from last connection check */
  serverError: string | null;
}

export interface ServerSlice extends ServerSliceState {
  setServerUrl: (url: string) => void;
  setServerConnected: (connected: boolean) => void;
  setAnalyticsAvailable: (available: boolean) => void;
  setServerCheckInProgress: (inProgress: boolean) => void;
  setServerError: (error: string | null) => void;
  checkServerConnection: () => Promise<void>;
}

// ============================================================================
// Slice Creator
// ============================================================================

/** Read initial URL from env vars */
const initialUrl =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_IFC_SERVER_URL || import.meta.env?.VITE_SERVER_URL)) ||
  '';

const initialState: ServerSliceState = {
  serverUrl: initialUrl,
  isServerConnected: false,
  isAnalyticsAvailable: false,
  serverCheckInProgress: false,
  serverError: null,
};

export const createServerSlice: StateCreator<ServerSlice, [], [], ServerSlice> = (set, get) => ({
  ...initialState,

  setServerUrl: (url: string) => set({ serverUrl: url }),

  setServerConnected: (connected: boolean) => set({ isServerConnected: connected }),

  setAnalyticsAvailable: (available: boolean) => set({ isAnalyticsAvailable: available }),

  setServerCheckInProgress: (inProgress: boolean) => set({ serverCheckInProgress: inProgress }),

  setServerError: (error: string | null) => set({ serverError: error }),

  checkServerConnection: async () => {
    const { serverUrl } = get();
    if (!serverUrl) {
      set({
        isServerConnected: false,
        isAnalyticsAvailable: false,
        serverError: null,
        serverCheckInProgress: false,
      });
      return;
    }

    set({ serverCheckInProgress: true, serverError: null });

    try {
      const response = await fetch(`${serverUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        set({
          isServerConnected: true,
          serverError: null,
        });

        // Check if analytics is available by probing the analytics status endpoint
        // with a dummy key — a 503 means analytics is not configured, 404 means it is
        try {
          const analyticsCheck = await fetch(
            `${serverUrl}/api/v1/analytics/status/__health_check__`,
            { signal: AbortSignal.timeout(3000) },
          );
          // 404 = analytics enabled but model not found (good)
          // 503 = analytics not configured (no DATABASE_URL)
          set({
            isAnalyticsAvailable: analyticsCheck.status !== 503,
          });
        } catch {
          set({ isAnalyticsAvailable: false });
        }
      } else {
        set({
          isServerConnected: false,
          isAnalyticsAvailable: false,
          serverError: `Server returned ${response.status}`,
        });
      }
    } catch (err) {
      set({
        isServerConnected: false,
        isAnalyticsAvailable: false,
        serverError: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      set({ serverCheckInProgress: false });
    }
  },
});

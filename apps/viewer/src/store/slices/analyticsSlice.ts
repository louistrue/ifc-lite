/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Analytics state slice
 *
 * Manages analytics publication status and Superset dashboard integration.
 */

import type { StateCreator } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsSliceState {
  /** Whether analytics panel is visible */
  analyticsPanelVisible: boolean;
  /** Whether the embedded dashboard iframe is visible */
  analyticsEmbedVisible: boolean;
  /** Publication status per cache key */
  analyticsStatus: 'idle' | 'publishing' | 'published' | 'error';
  /** Error message from last publish attempt */
  analyticsError: string | null;
  /** Model ID returned from server after publishing */
  analyticsModelId: string | null;
  /** Superset dashboard ID (null if Superset not configured on server) */
  analyticsDashboardId: number | null;
  /** Superset dashboard URL */
  analyticsDashboardUrl: string | null;
  /** Cache key of the currently published model */
  analyticsPublishedCacheKey: string | null;
  /** Server cache key from the most recent server-parsed model (SHA256 hash) */
  analyticsServerCacheKey: string | null;
}

export interface AnalyticsSlice extends AnalyticsSliceState {
  toggleAnalyticsPanel: () => void;
  setAnalyticsPanelVisible: (visible: boolean) => void;
  setAnalyticsEmbedVisible: (visible: boolean) => void;
  setAnalyticsPublishing: () => void;
  setAnalyticsPublished: (
    modelId: string,
    cacheKey: string,
    dashboardId: number | null,
    dashboardUrl: string | null,
  ) => void;
  setAnalyticsError: (error: string) => void;
  setAnalyticsServerCacheKey: (cacheKey: string) => void;
  resetAnalytics: () => void;
}

// ============================================================================
// Slice Creator
// ============================================================================

const initialState: AnalyticsSliceState = {
  analyticsPanelVisible: false,
  analyticsEmbedVisible: false,
  analyticsStatus: 'idle',
  analyticsError: null,
  analyticsModelId: null,
  analyticsDashboardId: null,
  analyticsDashboardUrl: null,
  analyticsPublishedCacheKey: null,
  analyticsServerCacheKey: null,
};

export const createAnalyticsSlice: StateCreator<AnalyticsSlice, [], [], AnalyticsSlice> = (set) => ({
  ...initialState,

  toggleAnalyticsPanel: () =>
    set((state) => ({
      analyticsPanelVisible: !state.analyticsPanelVisible,
    })),

  setAnalyticsPanelVisible: (visible: boolean) =>
    set({ analyticsPanelVisible: visible }),

  setAnalyticsEmbedVisible: (visible: boolean) =>
    set({ analyticsEmbedVisible: visible }),

  setAnalyticsPublishing: () =>
    set({
      analyticsStatus: 'publishing',
      analyticsError: null,
    }),

  setAnalyticsPublished: (
    modelId: string,
    cacheKey: string,
    dashboardId: number | null,
    dashboardUrl: string | null,
  ) =>
    set({
      analyticsStatus: 'published',
      analyticsModelId: modelId,
      analyticsPublishedCacheKey: cacheKey,
      analyticsDashboardId: dashboardId,
      analyticsDashboardUrl: dashboardUrl,
      analyticsError: null,
    }),

  setAnalyticsError: (error: string) =>
    set({
      analyticsStatus: 'error',
      analyticsError: error,
    }),

  setAnalyticsServerCacheKey: (cacheKey: string) =>
    set({ analyticsServerCacheKey: cacheKey }),

  resetAnalytics: () => set(initialState),
});

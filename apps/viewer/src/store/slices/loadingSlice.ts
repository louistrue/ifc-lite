/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loading state slice
 */

import type { StateCreator } from 'zustand';

export interface LoadingSlice {
  // State
  loading: boolean;
  geometryStreamingActive: boolean;
  progress: { phase: string; percent: number; indeterminate?: boolean } | null;
  geometryProgress: { phase: string; percent: number; indeterminate?: boolean } | null;
  metadataProgress: { phase: string; percent: number; indeterminate?: boolean } | null;
  error: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setGeometryStreamingActive: (active: boolean) => void;
  setProgress: (progress: { phase: string; percent: number; indeterminate?: boolean } | null) => void;
  setGeometryProgress: (progress: { phase: string; percent: number; indeterminate?: boolean } | null) => void;
  setMetadataProgress: (progress: { phase: string; percent: number; indeterminate?: boolean } | null) => void;
  setError: (error: string | null) => void;
}

export const createLoadingSlice: StateCreator<LoadingSlice, [], [], LoadingSlice> = (set) => ({
  // Initial state
  loading: false,
  geometryStreamingActive: false,
  progress: null,
  geometryProgress: null,
  metadataProgress: null,
  error: null,

  // Actions
  setLoading: (loading) => set({ loading }),
  setGeometryStreamingActive: (geometryStreamingActive) => set({ geometryStreamingActive }),
  setProgress: (progress) => set({ progress }),
  setGeometryProgress: (geometryProgress) => set({ geometryProgress }),
  setMetadataProgress: (metadataProgress) => set({ metadataProgress }),
  setError: (error) => set({ error }),
});

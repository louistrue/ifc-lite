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
  progress: { phase: string; percent: number } | null;
  error: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { phase: string; percent: number } | null) => void;
  setError: (error: string | null) => void;
}

export const createLoadingSlice: StateCreator<LoadingSlice, [], [], LoadingSlice> = (set) => ({
  // Initial state
  loading: false,
  progress: null,
  error: null,

  // Actions
  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
});

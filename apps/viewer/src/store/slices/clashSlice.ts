/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clash detection state slice — manages clash results and visual state
 */

import type { StateCreator } from 'zustand';
import type { ClashResult, Clash, ClashMode } from '@ifc-lite/clash';

export type ClashFilterMode = 'all' | 'byClashSet' | 'byTypePair';
export type ClashSortField = 'index' | 'typeA' | 'typeB' | 'distance' | 'nameA' | 'nameB';
export type ClashSortDir = 'asc' | 'desc';

export interface ClashSlice {
  // State
  clashPanelVisible: boolean;
  clashResult: ClashResult | null;
  clashLoading: boolean;
  clashError: string | null;
  clashFilterMode: ClashFilterMode;
  clashFilterValue: string | null;
  clashSearchQuery: string;
  clashSortField: ClashSortField;
  clashSortDir: ClashSortDir;
  clashSelectedIndex: number | null;
  clashMode: ClashMode;
  clashTolerance: number;
  clashClearance: number;

  // Actions
  setClashPanelVisible: (visible: boolean) => void;
  setClashResult: (result: ClashResult | null) => void;
  setClashLoading: (loading: boolean) => void;
  setClashError: (error: string | null) => void;
  setClashFilterMode: (mode: ClashFilterMode) => void;
  setClashFilterValue: (value: string | null) => void;
  setClashSearchQuery: (query: string) => void;
  setClashSortField: (field: ClashSortField) => void;
  setClashSortDir: (dir: ClashSortDir) => void;
  setClashSelectedIndex: (index: number | null) => void;
  setClashMode: (mode: ClashMode) => void;
  setClashTolerance: (tolerance: number) => void;
  setClashClearance: (clearance: number) => void;
  clearClash: () => void;
}

export const createClashSlice: StateCreator<ClashSlice, [], [], ClashSlice> = (set) => ({
  // Initial state
  clashPanelVisible: false,
  clashResult: null,
  clashLoading: false,
  clashError: null,
  clashFilterMode: 'all',
  clashFilterValue: null,
  clashSearchQuery: '',
  clashSortField: 'index',
  clashSortDir: 'asc',
  clashSelectedIndex: null,
  clashMode: 'collision',
  clashTolerance: 0.002,
  clashClearance: 0.05,

  // Actions
  setClashPanelVisible: (clashPanelVisible) => set({ clashPanelVisible }),
  setClashResult: (clashResult) => set({ clashResult }),
  setClashLoading: (clashLoading) => set({ clashLoading }),
  setClashError: (clashError) => set({ clashError }),
  setClashFilterMode: (clashFilterMode) => set({ clashFilterMode }),
  setClashFilterValue: (clashFilterValue) => set({ clashFilterValue }),
  setClashSearchQuery: (clashSearchQuery) => set({ clashSearchQuery }),
  setClashSortField: (clashSortField) => set({ clashSortField }),
  setClashSortDir: (clashSortDir) => set({ clashSortDir }),
  setClashSelectedIndex: (clashSelectedIndex) => set({ clashSelectedIndex }),
  setClashMode: (clashMode) => set({ clashMode }),
  setClashTolerance: (clashTolerance) => set({ clashTolerance }),
  setClashClearance: (clashClearance) => set({ clashClearance }),
  clearClash: () => set({
    clashResult: null,
    clashLoading: false,
    clashError: null,
    clashFilterMode: 'all',
    clashFilterValue: null,
    clashSearchQuery: '',
    clashSelectedIndex: null,
  }),
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Diff state slice — manages IFC diff results and visual state
 */

import type { StateCreator } from 'zustand';
import type { DiffResult, EntityChange } from '@ifc-lite/diff';

export type DiffFilterMode = 'all' | 'added' | 'deleted' | 'changed';
export type DiffSortField = 'type' | 'name' | 'globalId' | 'changes';
export type DiffSortDir = 'asc' | 'desc';

export interface DiffSlice {
  // State
  diffPanelVisible: boolean;
  diffResult: DiffResult | null;
  diffLoading: boolean;
  diffError: string | null;
  diffFilterMode: DiffFilterMode;
  diffSearchQuery: string;
  diffSortField: DiffSortField;
  diffSortDir: DiffSortDir;
  diffSelectedGlobalId: string | null;
  diffFile1Name: string | null;
  diffFile2Name: string | null;

  // Actions
  setDiffPanelVisible: (visible: boolean) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setDiffLoading: (loading: boolean) => void;
  setDiffError: (error: string | null) => void;
  setDiffFilterMode: (mode: DiffFilterMode) => void;
  setDiffSearchQuery: (query: string) => void;
  setDiffSortField: (field: DiffSortField) => void;
  setDiffSortDir: (dir: DiffSortDir) => void;
  setDiffSelectedGlobalId: (globalId: string | null) => void;
  setDiffFileNames: (file1: string, file2: string) => void;
  clearDiff: () => void;
}

export const createDiffSlice: StateCreator<DiffSlice, [], [], DiffSlice> = (set) => ({
  // Initial state
  diffPanelVisible: false,
  diffResult: null,
  diffLoading: false,
  diffError: null,
  diffFilterMode: 'all',
  diffSearchQuery: '',
  diffSortField: 'type',
  diffSortDir: 'asc',
  diffSelectedGlobalId: null,
  diffFile1Name: null,
  diffFile2Name: null,

  // Actions
  setDiffPanelVisible: (diffPanelVisible) => set({ diffPanelVisible }),
  setDiffResult: (diffResult) => set({ diffResult }),
  setDiffLoading: (diffLoading) => set({ diffLoading }),
  setDiffError: (diffError) => set({ diffError }),
  setDiffFilterMode: (diffFilterMode) => set({ diffFilterMode }),
  setDiffSearchQuery: (diffSearchQuery) => set({ diffSearchQuery }),
  setDiffSortField: (diffSortField) => set({ diffSortField }),
  setDiffSortDir: (diffSortDir) => set({ diffSortDir }),
  setDiffSelectedGlobalId: (diffSelectedGlobalId) => set({ diffSelectedGlobalId }),
  setDiffFileNames: (diffFile1Name, diffFile2Name) => set({ diffFile1Name, diffFile2Name }),
  clearDiff: () => set({
    diffResult: null,
    diffLoading: false,
    diffError: null,
    diffFilterMode: 'all',
    diffSearchQuery: '',
    diffSelectedGlobalId: null,
    diffFile1Name: null,
    diffFile2Name: null,
  }),
});

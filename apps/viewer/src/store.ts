/**
 * Zustand store for viewer state
 */

import { create } from 'zustand';
import type { ParseResult } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';

interface ViewerState {
  // Loading state
  loading: boolean;
  progress: { phase: string; percent: number } | null;
  error: string | null;

  // Data
  parseResult: ParseResult | null;
  geometryResult: GeometryResult | null;

  // Selection
  selectedEntityId: number | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { phase: string; percent: number } | null) => void;
  setError: (error: string | null) => void;
  setParseResult: (result: ParseResult | null) => void;
  setGeometryResult: (result: GeometryResult | null) => void;
  setSelectedEntityId: (id: number | null) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  loading: false,
  progress: null,
  error: null,
  parseResult: null,
  geometryResult: null,
  selectedEntityId: null,

  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setParseResult: (parseResult) => set({ parseResult }),
  setGeometryResult: (geometryResult) => set({ geometryResult }),
  setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),
}));

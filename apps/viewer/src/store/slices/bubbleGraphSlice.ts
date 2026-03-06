/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BubbleGraph state slice — persists the relational building graph
 * (storeys, axes, walls, beams, columns, slabs…) that drives both
 * the visual canvas editor and the automatic 2-D floor-plan views.
 */

import type { StateCreator } from 'zustand';

// ─── Node / Edge types ────────────────────────────────────────────────────

export interface BubbleGraphNode {
  id: string;
  type: string;               // 'storey' | 'ax' | 'wall' | 'beam' | 'column' | 'slab' | …
  name: string;
  x: number;                  // canvas position in mm
  y: number;
  z: number;
  properties: Record<string, unknown>;
  locked?: boolean;
  parentId?: string;
}

export interface BubbleGraphEdge {
  id: string;
  from: string;
  to: string;
}

// ─── Slice interface ──────────────────────────────────────────────────────

export interface BubbleGraphSlice {
  bubbleGraphNodes: BubbleGraphNode[];
  bubbleGraphEdges: BubbleGraphEdge[];
  bubbleGraphPanelVisible: boolean;

  setBubbleGraph: (nodes: BubbleGraphNode[], edges: BubbleGraphEdge[]) => void;
  setBubbleGraphPanelVisible: (visible: boolean) => void;
  toggleBubbleGraphPanel: () => void;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createBubbleGraphSlice: StateCreator<BubbleGraphSlice, [], [], BubbleGraphSlice> = (set) => ({
  bubbleGraphNodes: [],
  bubbleGraphEdges: [],
  bubbleGraphPanelVisible: false,

  setBubbleGraph: (nodes, edges) => set({ bubbleGraphNodes: nodes, bubbleGraphEdges: edges }),

  setBubbleGraphPanelVisible: (visible) => set({ bubbleGraphPanelVisible: visible }),

  toggleBubbleGraphPanel: () =>
    set((s) => ({ bubbleGraphPanelVisible: !s.bubbleGraphPanelVisible })),
});

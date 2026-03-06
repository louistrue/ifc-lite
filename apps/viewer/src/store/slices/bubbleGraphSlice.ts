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

/** Global building axis grid — single source of truth for ALL storeys */
export interface BuildingAxes {
  xValues: number[];  // mm
  yValues: number[];  // mm
}

export type StoreyDiscipline = 'architectural' | 'structural' | 'mep';

// ─── Slice interface ──────────────────────────────────────────────────────

export interface BubbleGraphSlice {
  bubbleGraphNodes: BubbleGraphNode[];
  bubbleGraphEdges: BubbleGraphEdge[];
  bubbleGraphPanelVisible: boolean;

  /** Global axis grid shared by all storeys */
  buildingAxes: BuildingAxes;
  /** Currently active storey tab (null = show all) */
  activeStoreyId: string | null;

  setBubbleGraph: (nodes: BubbleGraphNode[], edges: BubbleGraphEdge[]) => void;
  setBubbleGraphPanelVisible: (visible: boolean) => void;
  toggleBubbleGraphPanel: () => void;
  setBuildingAxes: (axes: BuildingAxes) => void;
  setActiveStoreyId: (id: string | null) => void;
}

// ─── Creator ──────────────────────────────────────────────────────────────

export const createBubbleGraphSlice: StateCreator<BubbleGraphSlice, [], [], BubbleGraphSlice> = (set) => ({
  bubbleGraphNodes: [],
  bubbleGraphEdges: [],
  bubbleGraphPanelVisible: false,
  buildingAxes: { xValues: [], yValues: [] },
  activeStoreyId: null,

  setBubbleGraph: (nodes, edges) => set({ bubbleGraphNodes: nodes, bubbleGraphEdges: edges }),
  setBubbleGraphPanelVisible: (visible) => set({ bubbleGraphPanelVisible: visible }),
  toggleBubbleGraphPanel: () =>
    set((s) => ({ bubbleGraphPanelVisible: !s.bubbleGraphPanelVisible })),
  setBuildingAxes: (axes) => set({ buildingAxes: axes }),
  setActiveStoreyId: (id) => set({ activeStoreyId: id }),
});

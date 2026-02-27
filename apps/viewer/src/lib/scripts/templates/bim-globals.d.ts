/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AUTO-GENERATED — do not edit by hand.
 * Run: npx tsx scripts/generate-bim-globals.ts
 *
 * Type declarations for the sandbox `bim` global.
 * Generated from NAMESPACE_SCHEMAS in bridge-schema.ts.
 */

// ── Entity types ────────────────────────────────────────────────────────

interface BimEntity {
  ref: { modelId: string; expressId: number };
  name: string; Name: string;
  type: string; Type: string;
  globalId: string; GlobalId: string;
  description: string; Description: string;
  objectType: string; ObjectType: string;
}

interface BimPropertySet {
  name: string;
  properties: Array<{ name: string; value: string | number | boolean | null }>;
}

interface BimQuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number | null }>;
}

interface BimModelInfo {
  id: string;
  name: string;
  schemaVersion: string;
  entityCount: number;
  fileSize: number;
}

// ── Topology types ────────────────────────────────────────────────────

interface EntityRef {
  modelId: string;
  expressId: number;
}

interface TopologyNode {
  ref: EntityRef;
  name: string;
  type: string;
  area: number | null;
  volume: number | null;
  centroid: [number, number, number] | null;
}

interface TopologyEdge {
  source: EntityRef;
  target: EntityRef;
  weight: number;
  sharedType: string;
}

interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface AdjacencyPair {
  space1: EntityRef;
  space2: EntityRef;
  sharedRefs: EntityRef[];
  sharedTypes: string[];
}

interface CentralityResult {
  ref: EntityRef;
  name: string;
  degree: number;
  closeness: number;
  betweenness: number;
}

interface PathResult {
  path: EntityRef[];
  totalWeight: number;
  hops: number;
}

// ── Namespace declarations ──────────────────────────────────────────────

declare const bim: {
  /** Model operations */
  model: {
    /** List loaded models */
    list(): BimModelInfo[];
    /** Get active model */
    active(): BimModelInfo | null;
    /** Get active model ID */
    activeId(): string | null;
  };
  /** Query entities */
  query: {
    /** Get all entities */
    all(): BimEntity[];
    /** Filter by IFC type e.g. 'IfcWall' */
    byType(...types: string[]): BimEntity[];
    /** Get entity by model ID and express ID */
    entity(modelId: string, expressId: number): BimEntity | null;
    /** Get all IfcPropertySet data for an entity */
    properties(entity: BimEntity): BimPropertySet[];
    /** Get all IfcElementQuantity data for an entity */
    quantities(entity: BimEntity): BimQuantitySet[];
  };
  /** Viewer control */
  viewer: {
    /** Colorize entities e.g. '#ff0000' */
    colorize(entities: BimEntity[], color: string): void;
    /** Batch colorize with [{entities, color}] */
    colorizeAll(batches: Array<{ entities: BimEntity[]; color: string }>): void;
    /** Hide entities */
    hide(entities: BimEntity[]): void;
    /** Show entities */
    show(entities: BimEntity[]): void;
    /** Isolate entities */
    isolate(entities: BimEntity[]): void;
    /** Select entities */
    select(entities: BimEntity[]): void;
    /** Fly camera to entities */
    flyTo(entities: BimEntity[]): void;
    /** Reset all colors */
    resetColors(): void;
    /** Reset all visibility */
    resetVisibility(): void;
  };
  /** Property editing */
  mutate: {
    /** Set a property value */
    setProperty(entity: unknown, psetName: string, propName: string, value: unknown): void;
    /** Delete a property */
    deleteProperty(entity: unknown, psetName: string, propName: string): void;
    /** Undo last mutation */
    undo(modelId: string): void;
    /** Redo undone mutation */
    redo(modelId: string): void;
  };
  /** Lens visualization */
  lens: {
    /** Get built-in lens presets */
    presets(): unknown[];
  };
  /** Data export */
  export: {
    /** Export entities to CSV string */
    csv(entities: BimEntity[], options: { columns: string[]; filename?: string; separator?: string }): string;
    /** Export entities to JSON array */
    json(entities: BimEntity[], columns: string[]): Record<string, unknown>[];
  };
  /** Spatial topology analysis */
  topology: {
    /** Build dual graph from IfcSpace entities and their boundary relationships */
    buildGraph(): TopologyGraph;
    /** Get all pairs of adjacent spaces with shared boundary elements */
    adjacency(): AdjacencyPair[];
    /** Find shortest path between two spaces (Dijkstra) */
    shortestPath(sourceRef: EntityRef, targetRef: EntityRef): PathResult | null;
    /** Compute degree, closeness, and betweenness centrality for all spaces */
    centrality(): CentralityResult[];
    /** Get area, volume, and centroid metrics for all spaces */
    metrics(): TopologyNode[];
    /** Get external boundary elements (building envelope) */
    envelope(): EntityRef[];
    /** Get groups of spaces reachable from each other */
    connectedComponents(): EntityRef[][];
  };
};

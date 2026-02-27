/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.topology — Non-manifold topology analysis for IFC spatial reasoning.
 *
 * Builds a dual graph from IfcSpace entities and their boundary relationships,
 * then exposes graph algorithms (adjacency, shortest path, centrality) for
 * spatial analysis and wayfinding.
 */

import type {
  BimBackend,
  EntityRef,
  TopologyGraph,
  TopologyNode,
  AdjacencyPair,
  CentralityResult,
  PathResult,
} from '../types.js';

/** bim.topology — Spatial topology analysis */
export class TopologyNamespace {
  constructor(private backend: BimBackend) {}

  /**
   * Build the dual graph from IfcSpace entities.
   * Spaces become nodes, shared boundaries (walls/slabs) become edges.
   */
  buildGraph(): TopologyGraph {
    return this.backend.topology.buildGraph();
  }

  /** Get all adjacency pairs (which spaces share boundaries). */
  adjacency(): AdjacencyPair[] {
    return this.backend.topology.adjacency();
  }

  /** Find shortest path between two spaces via Dijkstra. */
  shortestPath(sourceRef: EntityRef, targetRef: EntityRef): PathResult | null {
    return this.backend.topology.shortestPath(sourceRef, targetRef);
  }

  /** Compute degree, closeness, and betweenness centrality for all spaces. */
  centrality(): CentralityResult[] {
    return this.backend.topology.centrality();
  }

  /** Get area/volume/centroid metrics for all spaces. */
  metrics(): TopologyNode[] {
    return this.backend.topology.metrics();
  }

  /** Get entity refs of external boundary elements (building envelope). */
  envelope(): EntityRef[] {
    return this.backend.topology.envelope();
  }

  /** Get connected components — groups of spaces reachable from each other. */
  connectedComponents(): EntityRef[][] {
    return this.backend.topology.connectedComponents();
  }

  /** Get centroid of any entity with mesh geometry (doors, stairs, walls, etc.) */
  entityCentroid(ref: EntityRef): [number, number, number] | null {
    return this.backend.topology.entityCentroid(ref);
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Topology adapter — builds a dual graph from IfcSpace entities and their
 * IfcRelSpaceBoundary relationships, then exposes graph algorithms.
 *
 * Spaces become graph nodes. Two spaces are adjacent (connected by an edge)
 * when they share a bounding element (wall, slab, door, etc.).
 */

import type {
  EntityRef,
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  AdjacencyPair,
  CentralityResult,
  PathResult,
  TopologyBackendMethods,
} from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import { EntityNode } from '@ifc-lite/query';
import { RelationshipType } from '@ifc-lite/data';
import { getAllModelEntries } from './model-compat.js';

// ── Internal graph types ──────────────────────────────────────────────

interface GraphData {
  /** All space nodes indexed by "modelId:expressId" */
  nodeMap: Map<string, TopologyNode>;
  /** Adjacency list: nodeKey → Map<neighborKey, edge> */
  adj: Map<string, Map<string, { weight: number; sharedRefs: EntityRef[]; sharedTypes: string[] }>>;
}

function refKey(ref: EntityRef): string {
  return `${ref.modelId}:${ref.expressId}`;
}

function keyToRef(key: string): EntityRef {
  const idx = key.indexOf(':');
  return { modelId: key.slice(0, idx), expressId: Number(key.slice(idx + 1)) };
}

/** IFC types to search for spaces (IfcSpace + common subtypes) */
const SPACE_TYPES = ['IFCSPACE', 'IFCSPACETYPE'];

// ── Adapter factory ───────────────────────────────────────────────────

export function createTopologyAdapter(store: StoreApi): TopologyBackendMethods {
  /** Build the raw graph data from the current model state. */
  function buildGraphData(): GraphData {
    const state = store.getState();
    const modelEntries = getAllModelEntries(state);

    const nodeMap = new Map<string, TopologyNode>();
    // For each model: space expressId → nodeKey
    const spaceKeys = new Map<string, string>();
    // element expressId → Set of nodeKeys (which spaces this element bounds)
    const elementToSpaces = new Map<string, Set<string>>();
    // element expressId → EntityRef
    const elementRefs = new Map<string, EntityRef>();
    // element expressId → type name
    const elementTypes = new Map<string, string>();

    for (const [modelId, model] of modelEntries) {
      if (!model?.ifcDataStore) continue;
      const ds = model.ifcDataStore;

      // 1. Find all IfcSpace entities
      for (const typeName of SPACE_TYPES) {
        const ids = ds.entityIndex.byType.get(typeName) ?? [];
        for (const expressId of ids) {
          if (expressId === 0) continue;
          const ref: EntityRef = { modelId, expressId };
          const key = refKey(ref);
          const node = new EntityNode(ds, expressId);

          // Extract area/volume from quantities
          let area: number | null = null;
          let volume: number | null = null;
          try {
            const qsets = node.quantities();
            for (const qset of qsets) {
              for (const q of qset.quantities) {
                const lower = q.name.toLowerCase();
                if (lower.includes('area') && !lower.includes('wall') && area === null) area = q.value;
                if (lower.includes('volume') && volume === null) volume = q.value;
              }
            }
          } catch { /* quantities may not be available */ }

          nodeMap.set(key, {
            ref,
            name: node.name || `Space #${expressId}`,
            type: node.type,
            area,
            volume,
            centroid: null,
          });
          spaceKeys.set(`${modelId}:${expressId}`, key);
        }
      }

      // 2. Find boundary elements for each space via IfcRelSpaceBoundary
      for (const [, nodeKey] of spaceKeys) {
        const ref = keyToRef(nodeKey);
        if (ref.modelId !== modelId) continue;

        // IfcRelSpaceBoundary: forward goes from space → bounding elements
        const boundaryElementIds = ds.relationships.getRelated(
          ref.expressId,
          RelationshipType.SpaceBoundary,
          'forward',
        );

        for (const elemId of boundaryElementIds) {
          const elemKey = `${modelId}:${elemId}`;
          if (!elementToSpaces.has(elemKey)) {
            elementToSpaces.set(elemKey, new Set());
          }
          elementToSpaces.get(elemKey)!.add(nodeKey);
          if (!elementRefs.has(elemKey)) {
            elementRefs.set(elemKey, { modelId, expressId: elemId });
            try {
              const elemNode = new EntityNode(ds, elemId);
              elementTypes.set(elemKey, elemNode.type);
            } catch {
              elementTypes.set(elemKey, 'Unknown');
            }
          }
        }
      }
    }

    // 3. Build adjacency: two spaces are adjacent if they share a bounding element
    const adj = new Map<string, Map<string, { weight: number; sharedRefs: EntityRef[]; sharedTypes: string[] }>>();
    for (const key of nodeMap.keys()) {
      adj.set(key, new Map());
    }

    for (const [elemKey, spaceKeySet] of elementToSpaces) {
      const spaces = [...spaceKeySet];
      if (spaces.length < 2) continue;

      const elemRef = elementRefs.get(elemKey)!;
      const elemType = elementTypes.get(elemKey) ?? 'Unknown';

      // Connect all pairs of spaces sharing this element
      for (let i = 0; i < spaces.length; i++) {
        for (let j = i + 1; j < spaces.length; j++) {
          const a = spaces[i];
          const b = spaces[j];
          const adjA = adj.get(a)!;
          const adjB = adj.get(b)!;

          if (!adjA.has(b)) {
            adjA.set(b, { weight: 0, sharedRefs: [], sharedTypes: [] });
            adjB.set(a, { weight: 0, sharedRefs: [], sharedTypes: [] });
          }
          const edgeAB = adjA.get(b)!;
          const edgeBA = adjB.get(a)!;
          edgeAB.sharedRefs.push(elemRef);
          edgeAB.sharedTypes.push(elemType);
          edgeAB.weight += 1;
          edgeBA.sharedRefs.push(elemRef);
          edgeBA.sharedTypes.push(elemType);
          edgeBA.weight += 1;
        }
      }
    }

    // If no space boundaries found, fall back to spatial containment heuristic:
    // spaces on the same storey that share walls are likely adjacent
    if (adj.size > 0 && [...adj.values()].every(m => m.size === 0)) {
      buildAdjacencyFromContainment(store, nodeMap, adj);
    }

    return { nodeMap, adj };
  }

  // ── Public methods ───────────────────────────────────────────────────

  return {
    buildGraph(): TopologyGraph {
      const { nodeMap, adj } = buildGraphData();
      const nodes = [...nodeMap.values()];
      const edges: TopologyEdge[] = [];
      const seen = new Set<string>();

      for (const [sourceKey, neighbors] of adj) {
        for (const [targetKey, data] of neighbors) {
          const edgeId = [sourceKey, targetKey].sort().join('|');
          if (seen.has(edgeId)) continue;
          seen.add(edgeId);

          edges.push({
            source: keyToRef(sourceKey),
            target: keyToRef(targetKey),
            weight: data.weight,
            sharedType: data.sharedTypes[0] ?? 'Unknown',
          });
        }
      }

      return { nodes, edges };
    },

    adjacency(): AdjacencyPair[] {
      const { adj } = buildGraphData();
      const pairs: AdjacencyPair[] = [];
      const seen = new Set<string>();

      for (const [sourceKey, neighbors] of adj) {
        for (const [targetKey, data] of neighbors) {
          const pairId = [sourceKey, targetKey].sort().join('|');
          if (seen.has(pairId)) continue;
          seen.add(pairId);

          pairs.push({
            space1: keyToRef(sourceKey),
            space2: keyToRef(targetKey),
            sharedRefs: data.sharedRefs,
            sharedTypes: data.sharedTypes,
          });
        }
      }

      return pairs;
    },

    shortestPath(sourceRef: EntityRef, targetRef: EntityRef): PathResult | null {
      const { nodeMap, adj } = buildGraphData();
      const srcKey = refKey(sourceRef);
      const tgtKey = refKey(targetRef);
      if (!nodeMap.has(srcKey) || !nodeMap.has(tgtKey)) return null;
      if (srcKey === tgtKey) return { path: [sourceRef], totalWeight: 0, hops: 0 };

      // Dijkstra
      const dist = new Map<string, number>();
      const prev = new Map<string, string>();
      const visited = new Set<string>();

      dist.set(srcKey, 0);
      // Simple priority queue via sorted array (sufficient for building-scale graphs)
      const queue: Array<{ key: string; d: number }> = [{ key: srcKey, d: 0 }];

      while (queue.length > 0) {
        queue.sort((a, b) => a.d - b.d);
        const { key: u } = queue.shift()!;
        if (visited.has(u)) continue;
        visited.add(u);

        if (u === tgtKey) break;

        const neighbors = adj.get(u);
        if (!neighbors) continue;

        for (const [v, data] of neighbors) {
          if (visited.has(v)) continue;
          const alt = (dist.get(u) ?? Infinity) + data.weight;
          if (alt < (dist.get(v) ?? Infinity)) {
            dist.set(v, alt);
            prev.set(v, u);
            queue.push({ key: v, d: alt });
          }
        }
      }

      if (!prev.has(tgtKey) && srcKey !== tgtKey) return null;

      // Reconstruct path
      const path: EntityRef[] = [];
      let cur: string | undefined = tgtKey;
      while (cur !== undefined) {
        path.unshift(keyToRef(cur));
        cur = prev.get(cur);
      }

      return {
        path,
        totalWeight: dist.get(tgtKey) ?? 0,
        hops: path.length - 1,
      };
    },

    centrality(): CentralityResult[] {
      const { nodeMap, adj } = buildGraphData();
      const keys = [...nodeMap.keys()];
      const n = keys.length;
      if (n === 0) return [];

      const degree = new Map<string, number>();
      const closeness = new Map<string, number>();
      const betweenness = new Map<string, number>();

      for (const k of keys) {
        degree.set(k, 0);
        closeness.set(k, 0);
        betweenness.set(k, 0);
      }

      // Degree centrality
      for (const k of keys) {
        degree.set(k, (adj.get(k)?.size ?? 0) / Math.max(n - 1, 1));
      }

      // Brandes algorithm for betweenness + closeness
      for (const s of keys) {
        const stack: string[] = [];
        const pred = new Map<string, string[]>();
        const sigma = new Map<string, number>();
        const dist = new Map<string, number>();
        const delta = new Map<string, number>();

        for (const k of keys) {
          pred.set(k, []);
          sigma.set(k, 0);
          dist.set(k, -1);
          delta.set(k, 0);
        }
        sigma.set(s, 1);
        dist.set(s, 0);

        const queue: string[] = [s];
        let qi = 0;
        while (qi < queue.length) {
          const v = queue[qi++];
          stack.push(v);
          const neighbors = adj.get(v);
          if (!neighbors) continue;

          for (const w of neighbors.keys()) {
            if (dist.get(w)! < 0) {
              dist.set(w, dist.get(v)! + 1);
              queue.push(w);
            }
            if (dist.get(w)! === dist.get(v)! + 1) {
              sigma.set(w, sigma.get(w)! + sigma.get(v)!);
              pred.get(w)!.push(v);
            }
          }
        }

        // Closeness for source s
        let totalDist = 0;
        let reachable = 0;
        for (const k of keys) {
          const d = dist.get(k)!;
          if (d > 0) { totalDist += d; reachable++; }
        }
        if (reachable > 0) {
          closeness.set(s, reachable / totalDist);
        }

        // Accumulation
        while (stack.length > 0) {
          const w = stack.pop()!;
          for (const v of pred.get(w)!) {
            const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
            delta.set(v, delta.get(v)! + contribution);
          }
          if (w !== s) {
            betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
          }
        }
      }

      // Normalize betweenness
      const normFactor = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
      for (const k of keys) {
        betweenness.set(k, betweenness.get(k)! * normFactor);
      }

      return keys.map(k => {
        const node = nodeMap.get(k)!;
        return {
          ref: node.ref,
          name: node.name,
          degree: degree.get(k) ?? 0,
          closeness: closeness.get(k) ?? 0,
          betweenness: betweenness.get(k) ?? 0,
        };
      });
    },

    metrics(): TopologyNode[] {
      const { nodeMap } = buildGraphData();
      return [...nodeMap.values()];
    },

    envelope(): EntityRef[] {
      const { adj } = buildGraphData();
      // Collect all shared boundary elements
      const sharedElements = new Set<string>();
      const allElements = new Map<string, EntityRef>();

      for (const [, neighbors] of adj) {
        for (const [, data] of neighbors) {
          for (const ref of data.sharedRefs) {
            const key = refKey(ref);
            sharedElements.add(key);
            allElements.set(key, ref);
          }
        }
      }

      // Envelope = elements that bound spaces but are NOT shared between spaces
      // (i.e., they face the exterior)
      const state = store.getState();
      const envelope: EntityRef[] = [];
      const modelEntries = getAllModelEntries(state);

      for (const [modelId, model] of modelEntries) {
        if (!model?.ifcDataStore) continue;
        const ds = model.ifcDataStore;

        for (const typeName of SPACE_TYPES) {
          const ids = ds.entityIndex.byType.get(typeName) ?? [];
          for (const spaceId of ids) {
            const boundaryIds = ds.relationships.getRelated(
              spaceId, RelationshipType.SpaceBoundary, 'forward',
            );
            for (const elemId of boundaryIds) {
              const elemKey = `${modelId}:${elemId}`;
              if (!sharedElements.has(elemKey)) {
                if (!allElements.has(elemKey)) {
                  allElements.set(elemKey, { modelId, expressId: elemId });
                  envelope.push({ modelId, expressId: elemId });
                }
              }
            }
          }
        }
      }

      return envelope;
    },

    connectedComponents(): EntityRef[][] {
      const { nodeMap, adj } = buildGraphData();
      const visited = new Set<string>();
      const components: EntityRef[][] = [];

      for (const key of nodeMap.keys()) {
        if (visited.has(key)) continue;
        const component: EntityRef[] = [];
        const queue: string[] = [key];
        visited.add(key);

        while (queue.length > 0) {
          const u = queue.shift()!;
          component.push(keyToRef(u));
          const neighbors = adj.get(u);
          if (!neighbors) continue;
          for (const v of neighbors.keys()) {
            if (!visited.has(v)) {
              visited.add(v);
              queue.push(v);
            }
          }
        }

        components.push(component);
      }

      // Sort: largest component first
      components.sort((a, b) => b.length - a.length);
      return components;
    },
  };
}

// ── Fallback: containment-based adjacency ─────────────────────────────

/**
 * When IfcRelSpaceBoundary isn't present, infer adjacency from spatial containment.
 * Spaces on the same storey that are contained by the same structural element
 * are assumed to potentially be adjacent (connected with weight 1).
 */
function buildAdjacencyFromContainment(
  store: StoreApi,
  nodeMap: Map<string, TopologyNode>,
  adj: Map<string, Map<string, { weight: number; sharedRefs: EntityRef[]; sharedTypes: string[] }>>,
): void {
  const state = store.getState();
  const modelEntries = getAllModelEntries(state);

  // Group spaces by their containing storey
  const storeyToSpaces = new Map<string, string[]>();

  for (const [modelId, model] of modelEntries) {
    if (!model?.ifcDataStore) continue;
    const ds = model.ifcDataStore;

    for (const key of nodeMap.keys()) {
      const ref = keyToRef(key);
      if (ref.modelId !== modelId) continue;

      // Walk up containment: space → storey
      const containers = ds.relationships.getRelated(
        ref.expressId,
        RelationshipType.ContainsElements,
        'inverse',
      );
      for (const containerId of containers) {
        const containerKey = `${modelId}:${containerId}`;
        if (!storeyToSpaces.has(containerKey)) {
          storeyToSpaces.set(containerKey, []);
        }
        storeyToSpaces.get(containerKey)!.push(key);
      }
    }
  }

  // Connect all spaces on the same storey
  for (const spaces of storeyToSpaces.values()) {
    for (let i = 0; i < spaces.length; i++) {
      for (let j = i + 1; j < spaces.length; j++) {
        const a = spaces[i];
        const b = spaces[j];
        if (!adj.get(a)?.has(b)) {
          adj.get(a)!.set(b, { weight: 1, sharedRefs: [], sharedTypes: ['IfcBuildingStorey'] });
          adj.get(b)!.set(a, { weight: 1, sharedRefs: [], sharedTypes: ['IfcBuildingStorey'] });
        }
      }
    }
  }
}

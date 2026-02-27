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

/** IFC types to search for spaces */
const SPACE_TYPES = ['IFCSPACE'];

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

        // Try both directions — parser may store edges either way
        const forwardIds = ds.relationships.getRelated(
          ref.expressId, RelationshipType.SpaceBoundary, 'forward',
        );
        const inverseIds = ds.relationships.getRelated(
          ref.expressId, RelationshipType.SpaceBoundary, 'inverse',
        );

        const boundaryElementIds = forwardIds.length > 0 ? forwardIds : inverseIds;

        for (const elemId of boundaryElementIds) {
          // Skip if the target is itself a space (we want building elements, not spaces)
          if (spaceKeys.has(`${modelId}:${elemId}`)) continue;

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

    // Populate centroids from mesh geometry
    populateCentroids(store, nodeMap);

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
            const fwd = ds.relationships.getRelated(
              spaceId, RelationshipType.SpaceBoundary, 'forward',
            );
            const inv = ds.relationships.getRelated(
              spaceId, RelationshipType.SpaceBoundary, 'inverse',
            );
            const boundaryIds = fwd.length > 0 ? fwd : inv;
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

// ── Centroid computation from mesh geometry ───────────────────────────

/** Populate centroid on each TopologyNode from mesh vertex positions. */
function populateCentroids(
  store: StoreApi,
  nodeMap: Map<string, TopologyNode>,
): void {
  const state = store.getState();

  // Multi-model federation
  if (state.models.size > 0) {
    for (const [modelId, model] of state.models) {
      const geo = model.geometryResult;
      if (!geo?.meshes) continue;
      const offset = model.idOffset;
      for (const mesh of geo.meshes) {
        if (!mesh.positions || mesh.positions.length === 0) continue;
        const originalId = mesh.expressId - offset;
        const key = `${modelId}:${originalId}`;
        const node = nodeMap.get(key);
        if (node && !node.centroid) {
          node.centroid = computeCentroid(mesh.positions);
        }
      }
    }
  }

  // Legacy single-model fallback
  if (state.geometryResult?.meshes) {
    for (const mesh of state.geometryResult.meshes) {
      if (!mesh.positions || mesh.positions.length === 0) continue;
      const key = `default:${mesh.expressId}`;
      const node = nodeMap.get(key);
      if (node && !node.centroid) {
        node.centroid = computeCentroid(mesh.positions);
      }
    }
  }
}

// ── Fallback: geometry-proximity adjacency ────────────────────────────

/** AABB type for bounding box calculations */
interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

/** Proximity threshold in meters — typical wall thickness */
const PROXIMITY_THRESHOLD = 0.5;

/**
 * Compute AABB gap distance between two bounding boxes.
 * Returns 0 when boxes overlap; positive distance otherwise.
 */
function aabbGapDistance(a: AABB, b: AABB): number {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dy = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute AABB gap distance in XY plane only (ignoring Z / height).
 * Used to match spaces to stair footprints regardless of floor level.
 */
function aabbXYGapDistance(a: AABB, b: AABB): number {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dy = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute bounding box from mesh positions.
 */
function computeBounds(positions: Float32Array): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Compute centroid (average vertex position) from mesh positions. */
function computeCentroid(positions: Float32Array): [number, number, number] | null {
  if (positions.length === 0) return null;
  let sumX = 0, sumY = 0, sumZ = 0;
  const vertexCount = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    sumX += positions[i];
    sumY += positions[i + 1];
    sumZ += positions[i + 2];
  }
  return [sumX / vertexCount, sumY / vertexCount, sumZ / vertexCount];
}

/** Compute AABB center (fast fallback when mesh positions are unavailable). */
function aabbCenter(b: AABB): [number, number, number] {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

/**
 * When IfcRelSpaceBoundary isn't present, infer adjacency using geometry
 * proximity. Spaces whose bounding boxes are within wall-thickness distance
 * of each other are connected. Falls back to storey grouping if no mesh
 * geometry is available.
 */
function buildAdjacencyFromContainment(
  store: StoreApi,
  nodeMap: Map<string, TopologyNode>,
  adj: Map<string, Map<string, { weight: number; sharedRefs: EntityRef[]; sharedTypes: string[] }>>,
): void {
  const state = store.getState();
  const modelEntries = getAllModelEntries(state);

  // ── 1. Group spaces by storey ──────────────────────────────────────
  const storeyToSpaces = new Map<string, string[]>();

  for (const [modelId, model] of modelEntries) {
    if (!model?.ifcDataStore) continue;
    const ds = model.ifcDataStore;

    for (const key of nodeMap.keys()) {
      const ref = keyToRef(key);
      if (ref.modelId !== modelId) continue;

      const parents = ds.relationships.getRelated(
        ref.expressId, RelationshipType.Aggregates, 'inverse',
      );
      const containers = parents.length > 0
        ? parents
        : ds.relationships.getRelated(
            ref.expressId, RelationshipType.ContainsElements, 'inverse',
          );

      for (const parentId of containers) {
        const parentKey = `${modelId}:${parentId}`;
        if (!storeyToSpaces.has(parentKey)) {
          storeyToSpaces.set(parentKey, []);
        }
        storeyToSpaces.get(parentKey)!.push(key);
      }
    }
  }

  // ── 2. Build bounding-box map from mesh geometry ───────────────────
  const spaceBounds = new Map<string, AABB>();

  // Try multi-model federation first
  if (state.models.size > 0) {
    for (const [modelId, model] of state.models) {
      const geo = model.geometryResult;
      if (!geo?.meshes) continue;
      const offset = model.idOffset;
      for (const mesh of geo.meshes) {
        if (!mesh.positions || mesh.positions.length === 0) continue;
        const originalId = mesh.expressId - offset;
        const key = `${modelId}:${originalId}`;
        if (nodeMap.has(key)) {
          spaceBounds.set(key, computeBounds(mesh.positions));
        }
      }
    }
  }
  // Legacy single-model fallback
  if (spaceBounds.size === 0 && state.geometryResult?.meshes) {
    for (const mesh of state.geometryResult.meshes) {
      if (!mesh.positions || mesh.positions.length === 0) continue;
      const key = `default:${mesh.expressId}`;
      if (nodeMap.has(key)) {
        spaceBounds.set(key, computeBounds(mesh.positions));
      }
    }
  }

  // ── 3. Find walls/slabs on each storey for shared boundary info ────
  const storeyWalls = new Map<string, Array<{ ref: EntityRef; type: string; bounds: AABB | null }>>();
  const WALL_TYPES = ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCDOOR', 'IFCCURTAINWALL'];

  for (const [modelId, model] of modelEntries) {
    if (!model?.ifcDataStore) continue;
    const ds = model.ifcDataStore;
    const offset = model.idOffset;

    // Build mesh bounds for walls
    const wallBoundsMap = new Map<number, AABB>();
    const geoSource = state.models.size > 0
      ? state.models.get(modelId)?.geometryResult
      : state.geometryResult;
    if (geoSource?.meshes) {
      for (const mesh of geoSource.meshes) {
        if (!mesh.positions || mesh.positions.length === 0) continue;
        const originalId = state.models.size > 0 ? mesh.expressId - offset : mesh.expressId;
        wallBoundsMap.set(originalId, computeBounds(mesh.positions));
      }
    }

    // For each storey, find contained walls
    for (const storeyKey of storeyToSpaces.keys()) {
      const ref = keyToRef(storeyKey);
      if (ref.modelId !== modelId) continue;

      const contained = ds.relationships.getRelated(
        ref.expressId, RelationshipType.ContainsElements, 'forward',
      );

      const walls: Array<{ ref: EntityRef; type: string; bounds: AABB | null }> = [];
      for (const elemId of contained) {
        try {
          const elemNode = new EntityNode(ds, elemId);
          const elemType = elemNode.type.toUpperCase();
          if (WALL_TYPES.some(t => elemType.includes(t.replace('IFC', '')))) {
            walls.push({
              ref: { modelId, expressId: elemId },
              type: elemNode.type,
              bounds: wallBoundsMap.get(elemId) ?? null,
            });
          }
        } catch { /* skip non-entity IDs */ }
      }
      if (walls.length > 0) {
        storeyWalls.set(storeyKey, walls);
      }
    }
  }

  // ── 4. Connect spaces using proximity ──────────────────────────────
  let connectionsFromGeometry = 0;

  for (const [storeyKey, spaces] of storeyToSpaces) {
    const walls = storeyWalls.get(storeyKey) ?? [];

    for (let i = 0; i < spaces.length; i++) {
      for (let j = i + 1; j < spaces.length; j++) {
        const a = spaces[i];
        const b = spaces[j];
        const boundsA = spaceBounds.get(a);
        const boundsB = spaceBounds.get(b);

        if (boundsA && boundsB) {
          const gap = aabbGapDistance(boundsA, boundsB);
          if (gap <= PROXIMITY_THRESHOLD) {
            // Find walls between these two spaces
            const sharedWalls: EntityRef[] = [];
            const sharedTypes: string[] = [];
            for (const wall of walls) {
              if (!wall.bounds) continue;
              // Wall is "between" two spaces if it's close to both
              const gapToA = aabbGapDistance(wall.bounds, boundsA);
              const gapToB = aabbGapDistance(wall.bounds, boundsB);
              if (gapToA <= PROXIMITY_THRESHOLD && gapToB <= PROXIMITY_THRESHOLD) {
                sharedWalls.push(wall.ref);
                sharedTypes.push(wall.type);
              }
            }

            const weight = Math.max(1, sharedWalls.length);
            const types = sharedTypes.length > 0 ? sharedTypes : ['proximity'];
            adj.get(a)!.set(b, { weight, sharedRefs: sharedWalls, sharedTypes: types });
            adj.get(b)!.set(a, { weight, sharedRefs: sharedWalls, sharedTypes: types });
            connectionsFromGeometry++;
          }
        }
      }
    }
  }

  // ── 5. If geometry didn't help, use inter-storey connections only ───
  // (Don't create per-storey complete graphs — they're useless for analysis)
  if (connectionsFromGeometry === 0 && spaceBounds.size === 0) {
    // No geometry available — connect spaces to nearest neighbors by expressId
    // (a rough proxy for spatial order in the IFC file)
    for (const spaces of storeyToSpaces.values()) {
      // Sort by expressId as rough spatial proxy
      spaces.sort((a, b) => {
        const refA = keyToRef(a);
        const refB = keyToRef(b);
        return refA.expressId - refB.expressId;
      });

      // Chain: connect each to the next 1-2 neighbors
      for (let i = 0; i < spaces.length; i++) {
        for (let k = 1; k <= 2 && i + k < spaces.length; k++) {
          const a = spaces[i];
          const b = spaces[i + k];
          if (!adj.get(a)?.has(b)) {
            adj.get(a)!.set(b, { weight: 1, sharedRefs: [], sharedTypes: ['estimated'] });
            adj.get(b)!.set(a, { weight: 1, sharedRefs: [], sharedTypes: ['estimated'] });
          }
        }
      }
    }
  }

  // ── 6. Connect storeys via actual stair geometry ──────────────────────
  // Find IfcStair / IfcStairFlight entities and their bounding boxes,
  // then connect spaces on different floors through stair XY footprint overlap.
  // Falls back to closest vertical pair if no stair geometry is found.
  const STAIR_IFC_TYPES = ['IFCSTAIR', 'IFCSTAIRFLIGHT'];
  const stairEntities: Array<{ ref: EntityRef; bounds: AABB }> = [];

  for (const [modelId, model] of modelEntries) {
    if (!model?.ifcDataStore) continue;
    const ds = model.ifcDataStore;

    // Build mesh bounds lookup for this model
    const offset = state.models.size > 0 ? (state.models.get(modelId)?.idOffset ?? 0) : 0;
    const geoSource = state.models.size > 0
      ? state.models.get(modelId)?.geometryResult
      : state.geometryResult;

    const meshBoundsForModel = new Map<number, AABB>();
    if (geoSource?.meshes) {
      for (const mesh of geoSource.meshes) {
        if (!mesh.positions || mesh.positions.length === 0) continue;
        const originalId = state.models.size > 0 ? mesh.expressId - offset : mesh.expressId;
        meshBoundsForModel.set(originalId, computeBounds(mesh.positions));
      }
    }

    // Find stair entities with geometry
    for (const typeName of STAIR_IFC_TYPES) {
      const ids = ds.entityIndex.byType.get(typeName) ?? [];
      for (const stairId of ids) {
        if (stairId === 0) continue;
        const bounds = meshBoundsForModel.get(stairId);
        if (bounds) {
          stairEntities.push({ ref: { modelId, expressId: stairId }, bounds });
        }
      }
    }
  }

  const storeyKeys = [...storeyToSpaces.keys()];
  let stairConnectionsMade = 0;

  if (stairEntities.length > 0 && storeyKeys.length > 1 && spaceBounds.size > 0) {
    const STAIR_XY_PROXIMITY = 1.0; // meters — max XY gap to stair footprint

    for (let si = 0; si < storeyKeys.length; si++) {
      for (let sj = si + 1; sj < storeyKeys.length; sj++) {
        const spacesI = storeyToSpaces.get(storeyKeys[si])!;
        const spacesJ = storeyToSpaces.get(storeyKeys[sj])!;

        for (const stair of stairEntities) {
          // Find closest space on each floor to this stair's XY footprint
          let bestA = '';
          let bestAGap = Infinity;
          let bestB = '';
          let bestBGap = Infinity;

          for (const a of spacesI) {
            const bA = spaceBounds.get(a);
            if (!bA) continue;
            const gap = aabbXYGapDistance(bA, stair.bounds);
            if (gap < bestAGap) { bestAGap = gap; bestA = a; }
          }

          for (const b of spacesJ) {
            const bB = spaceBounds.get(b);
            if (!bB) continue;
            const gap = aabbXYGapDistance(bB, stair.bounds);
            if (gap < bestBGap) { bestBGap = gap; bestB = b; }
          }

          // Connect if both spaces overlap (or are very close to) the stair footprint
          if (bestA && bestB && bestAGap <= STAIR_XY_PROXIMITY && bestBGap <= STAIR_XY_PROXIMITY
              && !adj.get(bestA)?.has(bestB)) {
            adj.get(bestA)!.set(bestB, { weight: 2, sharedRefs: [stair.ref], sharedTypes: ['IfcStair'] });
            adj.get(bestB)!.set(bestA, { weight: 2, sharedRefs: [stair.ref], sharedTypes: ['IfcStair'] });
            stairConnectionsMade++;
          }
        }
      }
    }
  }

  // Fallback: if no stair geometry found, use closest vertical pair heuristic
  if (stairConnectionsMade === 0 && storeyKeys.length > 1 && spaceBounds.size > 0) {
    for (let si = 0; si < storeyKeys.length; si++) {
      for (let sj = si + 1; sj < storeyKeys.length; sj++) {
        const spacesI = storeyToSpaces.get(storeyKeys[si])!;
        const spacesJ = storeyToSpaces.get(storeyKeys[sj])!;

        let bestGap = Infinity;
        let bestA = '';
        let bestB = '';

        for (const a of spacesI) {
          const bA = spaceBounds.get(a);
          if (!bA) continue;
          for (const b of spacesJ) {
            const bB = spaceBounds.get(b);
            if (!bB) continue;
            const gap = aabbGapDistance(bA, bB);
            if (gap < bestGap) { bestGap = gap; bestA = a; bestB = b; }
          }
        }

        if (bestGap <= 1.0 && bestA && bestB && !adj.get(bestA)?.has(bestB)) {
          adj.get(bestA)!.set(bestB, { weight: 2, sharedRefs: [], sharedTypes: ['vertical'] });
          adj.get(bestB)!.set(bestA, { weight: 2, sharedRefs: [], sharedTypes: ['vertical'] });
        }
      }
    }
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for @ifc-lite/sdk
 *
 * These types define the public API surface of the SDK.
 * External tools (ifc-scripts, ifc-flow) depend on these types.
 */

// ============================================================================
// Entity References
// ============================================================================

/** Reference to a specific entity within a federated model set */
export interface EntityRef {
  modelId: string;
  expressId: number;
}

/** Serialized entity ref for transport (e.g., "arch:42") */
export type EntityRefString = string;

export function entityRefToString(ref: EntityRef): EntityRefString {
  return `${ref.modelId}:${ref.expressId}`;
}

export function stringToEntityRef(s: EntityRefString): EntityRef {
  const idx = s.indexOf(':');
  if (idx < 1) {
    throw new Error(`Invalid EntityRefString: "${s}" — expected "modelId:expressId"`);
  }
  const expressId = Number(s.slice(idx + 1));
  if (!Number.isFinite(expressId) || expressId < 0) {
    throw new Error(`Invalid expressId in EntityRefString: "${s}"`);
  }
  return { modelId: s.slice(0, idx), expressId };
}

// ============================================================================
// Model Types
// ============================================================================

export type SchemaVersion = 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5';

export interface ModelInfo {
  id: string;
  name: string;
  schemaVersion: SchemaVersion;
  entityCount: number;
  fileSize: number;
  loadedAt: number;
}

// ============================================================================
// Entity Data (serializable — crosses sandbox/transport boundary)
// ============================================================================

export interface EntityData {
  ref: EntityRef;
  globalId: string;
  name: string;
  type: string;
  description: string;
  objectType: string;
}

export interface PropertySetData {
  name: string;
  globalId?: string;
  properties: PropertyData[];
}

export interface PropertyData {
  name: string;
  type: number;
  value: string | number | boolean | null;
}

export interface QuantitySetData {
  name: string;
  quantities: QuantityData[];
}

export interface QuantityData {
  name: string;
  type: number;
  value: number;
}

// ============================================================================
// Query Types
// ============================================================================

export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'exists';

export interface QueryFilter {
  psetName: string;
  propName: string;
  operator: ComparisonOp;
  value?: string | number | boolean;
}

export interface QueryDescriptor {
  modelId?: string;
  types?: string[];
  filters?: QueryFilter[];
  limit?: number;
  offset?: number;
}

// ============================================================================
// Viewer Types
// ============================================================================

export type ProjectionMode = 'perspective' | 'orthographic';

export interface CameraState {
  mode: ProjectionMode;
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
}

export interface SectionPlane {
  axis: 'x' | 'y' | 'z';
  position: number;
  enabled: boolean;
  flipped: boolean;
}

// ============================================================================
// Spatial Types
// ============================================================================

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface SpatialPlane {
  normal: [number, number, number];
  distance: number;
}

export interface SpatialFrustum {
  planes: SpatialPlane[];
}

// ============================================================================
// Lens Types (re-export core types for SDK consumers)
// ============================================================================

import type { Lens, LensRule, LensCriteria, RGBAColor } from '@ifc-lite/lens';
export type { Lens, LensRule, LensCriteria, RGBAColor };

// ============================================================================
// Topology Types
// ============================================================================

/** A node in the topology graph (typically an IfcSpace) */
export interface TopologyNode {
  ref: EntityRef;
  name: string;
  type: string;
  area: number | null;
  volume: number | null;
  centroid: [number, number, number] | null;
}

/** An edge in the topology graph (shared boundary between two spaces) */
export interface TopologyEdge {
  source: EntityRef;
  target: EntityRef;
  /** Weight — shared boundary area, or 1.0 if unknown */
  weight: number;
  /** IFC type of the shared boundary element (e.g., 'IfcWall', 'IfcSlab') */
  sharedType: string;
}

/** Full dual graph: spaces as nodes, shared boundaries as edges */
export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

/** A pair of adjacent spaces with the elements between them */
export interface AdjacencyPair {
  space1: EntityRef;
  space2: EntityRef;
  sharedRefs: EntityRef[];
  sharedTypes: string[];
  /** Centroids of shared boundary elements (doors, stairs) — same index as sharedRefs */
  sharedCentroids: ([number, number, number] | null)[];
}

/** Centrality metrics for a single node */
export interface CentralityResult {
  ref: EntityRef;
  name: string;
  /** Number of direct connections / (n-1) */
  degree: number;
  /** (n-1) / sum(shortest distances) */
  closeness: number;
  /** Fraction of shortest paths passing through this node */
  betweenness: number;
}

/** Result of a shortest-path query */
export interface PathResult {
  /** Ordered list of entity refs from source to target */
  path: EntityRef[];
  /** Sum of edge weights along the path */
  totalWeight: number;
  /** Number of hops (edges traversed) */
  hops: number;
}

// ============================================================================
// Mutation Types
// ============================================================================

export interface MutationRecord {
  entityRef: EntityRef;
  psetName: string;
  propName: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  timestamp: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type BimEventType =
  | 'selection:changed'
  | 'visibility:changed'
  | 'model:loaded'
  | 'model:removed'
  | 'mutation:changed'
  | 'lens:changed';

export type BimEventData = {
  'selection:changed': { refs: EntityRef[] };
  'visibility:changed': Record<string, never>;
  'model:loaded': { model: ModelInfo };
  'model:removed': { modelId: string };
  'mutation:changed': { modelId: string; count: number };
  'lens:changed': { lensId: string | null };
};

export type BimEventHandler<T extends BimEventType> = (data: BimEventData[T]) => void;

// ============================================================================
// Transport Protocol
// ============================================================================

export interface SdkRequest {
  id: string;
  namespace: string;
  method: string;
  args: unknown[];
}

export interface SdkResponse {
  id: string;
  result?: unknown;
  error?: { message: string; stack?: string };
}

export interface SdkEvent {
  type: BimEventType;
  data: unknown;
}

// ============================================================================
// Backend Namespace Interfaces (typed method contracts per adapter)
// ============================================================================

export interface ModelBackendMethods {
  list(): ModelInfo[];
  activeId(): string | null;
}

export interface QueryBackendMethods {
  entities(descriptor: QueryDescriptor): EntityData[];
  entityData(ref: EntityRef): EntityData | null;
  properties(ref: EntityRef): PropertySetData[];
  quantities(ref: EntityRef): QuantitySetData[];
  related(ref: EntityRef, relType: string, direction: 'forward' | 'inverse'): EntityRef[];
}

export interface SelectionBackendMethods {
  get(): EntityRef[];
  set(refs: EntityRef[]): void;
}

export interface VisibilityBackendMethods {
  hide(refs: EntityRef[]): void;
  show(refs: EntityRef[]): void;
  isolate(refs: EntityRef[]): void;
  reset(): void;
  /** Force IfcSpace type visibility on (overrides global toggle) */
  showSpaces(): void;
}

/** A colored 3D line segment for path/connection visualization. */
export interface LineSegment3D {
  start: [number, number, number];
  end: [number, number, number];
  color: RGBAColor;
}

export interface ViewerBackendMethods {
  colorize(refs: EntityRef[], color: RGBAColor): void;
  colorizeAll(batches: Array<{ refs: EntityRef[]; color: RGBAColor }>): void;
  resetColors(refs?: EntityRef[]): void;
  flyTo(refs: EntityRef[]): void;
  setSection(section: SectionPlane | null): void;
  getSection(): SectionPlane | null;
  setCamera(state: Partial<CameraState>): void;
  getCamera(): CameraState;
  /** Draw 3D line segments in the viewer (paths, connections, etc.) */
  drawLines(lines: LineSegment3D[]): void;
  /** Clear all drawn lines. */
  clearLines(): void;
}

export interface MutateBackendMethods {
  setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean): void;
  deleteProperty(ref: EntityRef, psetName: string, propName: string): void;
  batchBegin(label: string): void;
  batchEnd(label: string): void;
  undo(modelId: string): boolean;
  redo(modelId: string): boolean;
}

export interface SpatialBackendMethods {
  queryBounds(modelId: string, bounds: AABB): EntityRef[];
  raycast(modelId: string, origin: [number, number, number], direction: [number, number, number]): EntityRef[];
  queryFrustum(modelId: string, frustum: SpatialFrustum): EntityRef[];
}

export interface ExportBackendMethods {
  csv(refs: unknown, options: unknown): string;
  json(refs: unknown, columns: unknown): Record<string, unknown>[];
  download(content: string, filename: string, mimeType: string): void;
}

export interface LensBackendMethods {
  presets(): unknown[];
  create(config: unknown): unknown;
  activate(lensId: string): void;
  deactivate(): void;
  getActive(): string | null;
}

export interface TopologyBackendMethods {
  buildGraph(): TopologyGraph;
  adjacency(): AdjacencyPair[];
  shortestPath(sourceRef: EntityRef, targetRef: EntityRef): PathResult | null;
  centrality(): CentralityResult[];
  metrics(): TopologyNode[];
  envelope(): EntityRef[];
  connectedComponents(): EntityRef[][];
  /** Get centroid of any entity with mesh geometry (doors, stairs, walls, etc.) */
  entityCentroid(ref: EntityRef): [number, number, number] | null;
}

// ============================================================================
// Backend Interface (implemented by local store or remote proxy)
// ============================================================================

/**
 * Abstraction over the viewer's internal state — SDK namespaces use this.
 *
 * Each namespace is a typed property with methods matching the adapter contract.
 * SDK namespace classes call backend.query.entities(...) instead of dispatch().
 *
 * BimHost (wire protocol) uses dispatchToBackend() to route string-based
 * SdkRequests to the typed namespace methods.
 */
export interface BimBackend {
  readonly model: ModelBackendMethods;
  readonly query: QueryBackendMethods;
  readonly selection: SelectionBackendMethods;
  readonly visibility: VisibilityBackendMethods;
  readonly viewer: ViewerBackendMethods;
  readonly mutate: MutateBackendMethods;
  readonly spatial: SpatialBackendMethods;
  readonly export: ExportBackendMethods;
  readonly lens: LensBackendMethods;
  readonly topology: TopologyBackendMethods;

  /** Subscribe to viewer events */
  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void;
}

/**
 * Route a string-based SdkRequest to the appropriate typed method on a BimBackend.
 * Used by BimHost for wire protocol compatibility.
 */
export function dispatchToBackend(backend: BimBackend, namespace: string, method: string, args: unknown[]): unknown {
  const ns = (backend as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[namespace];
  if (!ns || typeof ns !== 'object') {
    throw new Error(`Unknown namespace '${namespace}'`);
  }
  const fn = ns[method];
  if (typeof fn !== 'function') {
    throw new Error(`Unknown method '${namespace}.${method}'`);
  }
  return fn(...args);
}

// ============================================================================
// SDK Context Options
// ============================================================================

export interface BimContextOptions {
  /** Direct backend for local (embedded) mode */
  backend?: BimBackend;

  /** Transport for remote (connected) mode */
  transport?: Transport;
}

export interface Transport {
  send(request: SdkRequest): Promise<SdkResponse>;
  subscribe(handler: (event: SdkEvent) => void): () => void;
  close(): void;
}

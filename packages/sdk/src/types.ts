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
  return { modelId: s.slice(0, idx), expressId: Number(s.slice(idx + 1)) };
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

export type { Lens, LensRule, LensCriteria, RGBAColor } from '@ifc-lite/lens';

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
// Backend Interface (implemented by local store or remote proxy)
// ============================================================================

/**
 * Abstraction over the viewer's internal state — SDK namespaces use this.
 *
 * Uses a generic dispatch pattern: all calls go through `dispatch(namespace, method, args)`.
 * This avoids a fat interface that must be updated every time a new SDK method is added.
 * Type safety is provided at the namespace boundary (each namespace class casts internally).
 *
 * Namespace/method conventions match the SdkRequest protocol:
 *   model.list, model.activeId
 *   query.entities, query.entityData, query.properties, query.quantities, query.related
 *   selection.get, selection.set
 *   visibility.hide, visibility.show, visibility.isolate, visibility.reset
 *   viewer.colorize, viewer.resetColors, viewer.flyTo, viewer.setSection, viewer.getSection, viewer.setCamera, viewer.getCamera
 *   mutate.setProperty, mutate.deleteProperty, mutate.undo, mutate.redo
 *   spatial.queryBounds, spatial.raycast, spatial.queryFrustum
 */
export interface BimBackend {
  /** Dispatch an SDK call to the appropriate handler */
  dispatch(namespace: string, method: string, args: unknown[]): unknown;

  /** Subscribe to viewer events (kept separate — event subscriptions are stateful) */
  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void;
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

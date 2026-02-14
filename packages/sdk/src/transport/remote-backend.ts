/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RemoteBackend — implements BimBackend by proxying all calls over a Transport.
 *
 * Used when the SDK is in a different context than the viewer (cross-tab, iframe, etc).
 * Each method serializes to an SdkRequest and sends it through the transport.
 */

import type {
  BimBackend,
  Transport,
  EntityRef,
  EntityData,
  PropertySetData,
  QuantitySetData,
  QueryDescriptor,
  ModelInfo,
  SectionPlane,
  CameraState,
  BimEventType,
  AABB,
  SpatialFrustum,
} from '../types.js';

let requestCounter = 0;

export class RemoteBackend implements BimBackend {
  constructor(private transport: Transport) {}

  private call(namespace: string, method: string, args: unknown[]): unknown {
    const id = `req-${requestCounter++}`;
    // Note: In a real async implementation, this would return a Promise.
    // For the initial SDK, we use synchronous semantics for the BimBackend
    // interface. A future iteration will make all backend methods async
    // and use the transport's send() to await the response.
    //
    // For now, this throws to indicate remote mode is not yet fully wired.
    throw new Error(
      `RemoteBackend: Cannot call ${namespace}.${method} synchronously. ` +
      `Remote transport requires async implementation. Request ID: ${id}`
    );
  }

  // ── Model ──────────────────────────────────────────────────
  getModels(): ModelInfo[] {
    return this.call('model', 'list', []) as ModelInfo[];
  }

  getActiveModelId(): string | null {
    return this.call('model', 'activeId', []) as string | null;
  }

  // ── Query ──────────────────────────────────────────────────
  queryEntities(descriptor: QueryDescriptor): EntityData[] {
    return this.call('query', 'entities', [descriptor]) as EntityData[];
  }

  getEntityData(ref: EntityRef): EntityData | null {
    return this.call('query', 'entityData', [ref]) as EntityData | null;
  }

  getEntityProperties(ref: EntityRef): PropertySetData[] {
    return this.call('query', 'properties', [ref]) as PropertySetData[];
  }

  getEntityQuantities(ref: EntityRef): QuantitySetData[] {
    return this.call('query', 'quantities', [ref]) as QuantitySetData[];
  }

  getEntityRelated(ref: EntityRef, relType: string, direction: 'forward' | 'inverse'): EntityRef[] {
    return this.call('query', 'related', [ref, relType, direction]) as EntityRef[];
  }

  // ── Selection ──────────────────────────────────────────────
  getSelection(): EntityRef[] {
    return this.call('selection', 'get', []) as EntityRef[];
  }

  setSelection(refs: EntityRef[]): void {
    this.call('selection', 'set', [refs]);
  }

  // ── Visibility ─────────────────────────────────────────────
  hideEntities(refs: EntityRef[]): void {
    this.call('visibility', 'hide', [refs]);
  }

  showEntities(refs: EntityRef[]): void {
    this.call('visibility', 'show', [refs]);
  }

  isolateEntities(refs: EntityRef[]): void {
    this.call('visibility', 'isolate', [refs]);
  }

  resetVisibility(): void {
    this.call('visibility', 'reset', []);
  }

  // ── Viewer ─────────────────────────────────────────────────
  colorize(refs: EntityRef[], color: [number, number, number, number]): void {
    this.call('viewer', 'colorize', [refs, color]);
  }

  resetColors(refs?: EntityRef[]): void {
    this.call('viewer', 'resetColors', [refs]);
  }

  flyTo(refs: EntityRef[]): void {
    this.call('viewer', 'flyTo', [refs]);
  }

  setSection(section: SectionPlane | null): void {
    this.call('viewer', 'setSection', [section]);
  }

  getSection(): SectionPlane | null {
    return this.call('viewer', 'getSection', []) as SectionPlane | null;
  }

  setCamera(state: Partial<CameraState>): void {
    this.call('viewer', 'setCamera', [state]);
  }

  getCamera(): CameraState {
    return this.call('viewer', 'getCamera', []) as CameraState;
  }

  // ── Mutation ───────────────────────────────────────────────
  setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean): void {
    this.call('mutate', 'setProperty', [ref, psetName, propName, value]);
  }

  deleteProperty(ref: EntityRef, psetName: string, propName: string): void {
    this.call('mutate', 'deleteProperty', [ref, psetName, propName]);
  }

  undo(modelId: string): boolean {
    return this.call('mutate', 'undo', [modelId]) as boolean;
  }

  redo(modelId: string): boolean {
    return this.call('mutate', 'redo', [modelId]) as boolean;
  }

  // ── Spatial ────────────────────────────────────────────────
  queryBounds(modelId: string, bounds: AABB): EntityRef[] {
    return this.call('spatial', 'queryBounds', [modelId, bounds]) as EntityRef[];
  }

  spatialRaycast(modelId: string, origin: [number, number, number], direction: [number, number, number]): EntityRef[] {
    return this.call('spatial', 'raycast', [modelId, origin, direction]) as EntityRef[];
  }

  queryFrustum(modelId: string, frustum: SpatialFrustum): EntityRef[] {
    return this.call('spatial', 'queryFrustum', [modelId, frustum]) as EntityRef[];
  }

  // ── Events ─────────────────────────────────────────────────
  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void {
    return this.transport.subscribe((sdkEvent) => {
      if (sdkEvent.type === event) {
        handler(sdkEvent.data);
      }
    });
  }
}

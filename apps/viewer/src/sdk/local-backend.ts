/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LocalBackend — implements BimBackend by reading/writing the Zustand store directly.
 *
 * This is the viewer's internal backend: zero serialization overhead.
 * The viewer creates a LocalBackend and passes it to createBimContext().
 *
 * All methods read/write the same store that the viewer UI uses,
 * so SDK operations are immediately visible in the viewer.
 */

import type {
  BimBackend,
  EntityRef,
  EntityData,
  PropertySetData,
  QuantitySetData,
  QueryDescriptor,
  ModelInfo,
  SectionPlane,
  CameraState,
  BimEventType,
} from '@ifc-lite/sdk';
import type { ViewerState } from '../store/index.js';
import { EntityNode } from '@ifc-lite/query';
import { RelationshipType } from '@ifc-lite/data';

type StoreApi = {
  getState: () => ViewerState;
  subscribe: (listener: (state: ViewerState, prevState: ViewerState) => void) => () => void;
};

/** Map SDK axis names ('x','y','z') to store axis names ('side','down','front') */
const AXIS_TO_STORE: Record<string, 'down' | 'front' | 'side'> = {
  x: 'side',
  y: 'down',
  z: 'front',
};
const STORE_TO_AXIS: Record<string, 'x' | 'y' | 'z'> = {
  side: 'x',
  down: 'y',
  front: 'z',
};

/** Map relationship type strings to RelationshipType enum values */
const REL_TYPE_MAP: Record<string, RelationshipType> = {
  ContainsElements: RelationshipType.ContainsElements,
  Aggregates: RelationshipType.Aggregates,
  DefinesByType: RelationshipType.DefinesByType,
  VoidsElement: RelationshipType.VoidsElement,
  FillsElement: RelationshipType.FillsElement,
};

export class LocalBackend implements BimBackend {
  constructor(private store: StoreApi) {}

  // ── Model ──────────────────────────────────────────────────

  getModels(): ModelInfo[] {
    const state = this.store.getState();
    const result: ModelInfo[] = [];
    for (const [, model] of state.models) {
      result.push({
        id: model.id,
        name: model.name,
        schemaVersion: model.schemaVersion,
        entityCount: model.ifcDataStore?.entities?.count ?? 0,
        fileSize: model.fileSize,
        loadedAt: model.loadedAt,
      });
    }
    return result;
  }

  getActiveModelId(): string | null {
    return this.store.getState().activeModelId;
  }

  // ── Query ──────────────────────────────────────────────────

  queryEntities(descriptor: QueryDescriptor): EntityData[] {
    const state = this.store.getState();
    const results: EntityData[] = [];

    // Determine which models to query
    const modelEntries = descriptor.modelId
      ? [[descriptor.modelId, state.models.get(descriptor.modelId)] as const].filter(([, m]) => m)
      : [...state.models.entries()];

    for (const [modelId, model] of modelEntries) {
      if (!model?.ifcDataStore) continue;

      // If type filter is set, use the indexed getByType for efficiency
      // Otherwise iterate all entities
      let entityIds: number[];
      if (descriptor.types && descriptor.types.length > 0) {
        entityIds = [];
        for (const type of descriptor.types) {
          const typeIds = model.ifcDataStore.entityIndex.byType.get(type) ?? [];
          for (const id of typeIds) entityIds.push(id);
        }
      } else {
        entityIds = Array.from(model.ifcDataStore.entities.expressId.slice(0, model.ifcDataStore.entities.count));
      }
      for (const expressId of entityIds) {
        if (expressId === 0) continue;
        const node = new EntityNode(model.ifcDataStore, expressId);
        results.push({
          ref: { modelId, expressId },
          globalId: node.globalId,
          name: node.name,
          type: node.type,
          description: node.description,
          objectType: node.objectType,
        });
      }
    }

    // Apply property filters (post-query filtering)
    let filtered = results;
    if (descriptor.filters) {
      for (const filter of descriptor.filters) {
        filtered = filtered.filter(entity => {
          const props = this.getEntityProperties(entity.ref);
          const pset = props.find(p => p.name === filter.psetName);
          if (!pset) return filter.operator === 'exists' ? false : false;
          const prop = pset.properties.find(p => p.name === filter.propName);
          if (!prop) return filter.operator === 'exists' ? false : false;
          if (filter.operator === 'exists') return true;

          const val = prop.value;
          switch (filter.operator) {
            case '=': return String(val) === String(filter.value);
            case '!=': return String(val) !== String(filter.value);
            case '>': return Number(val) > Number(filter.value);
            case '<': return Number(val) < Number(filter.value);
            case '>=': return Number(val) >= Number(filter.value);
            case '<=': return Number(val) <= Number(filter.value);
            case 'contains': return String(val).includes(String(filter.value));
            default: return false;
          }
        });
      }
    }

    // Apply offset and limit
    if (descriptor.offset) filtered = filtered.slice(descriptor.offset);
    if (descriptor.limit) filtered = filtered.slice(0, descriptor.limit);

    return filtered;
  }

  getEntityData(ref: EntityRef): EntityData | null {
    const state = this.store.getState();
    const model = state.models.get(ref.modelId);
    if (!model?.ifcDataStore) return null;

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return {
      ref,
      globalId: node.globalId,
      name: node.name,
      type: node.type,
      description: node.description,
      objectType: node.objectType,
    };
  }

  getEntityProperties(ref: EntityRef): PropertySetData[] {
    const state = this.store.getState();
    const model = state.models.get(ref.modelId);
    if (!model?.ifcDataStore) return [];

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return node.properties().map((pset: { name: string; globalId?: string; properties: Array<{ name: string; type: number; value: string | number | boolean | null }> }) => ({
      name: pset.name,
      globalId: pset.globalId,
      properties: pset.properties.map((p: { name: string; type: number; value: string | number | boolean | null }) => ({
        name: p.name,
        type: p.type,
        value: p.value,
      })),
    }));
  }

  getEntityQuantities(ref: EntityRef): QuantitySetData[] {
    const state = this.store.getState();
    const model = state.models.get(ref.modelId);
    if (!model?.ifcDataStore) return [];

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    return node.quantities().map(qset => ({
      name: qset.name,
      quantities: qset.quantities.map(q => ({
        name: q.name,
        type: q.type,
        value: q.value,
      })),
    }));
  }

  getEntityRelated(ref: EntityRef, relType: string, direction: 'forward' | 'inverse'): EntityRef[] {
    const state = this.store.getState();
    const model = state.models.get(ref.modelId);
    if (!model?.ifcDataStore) return [];

    const relEnum = REL_TYPE_MAP[relType];
    if (relEnum === undefined) return [];

    const targets = model.ifcDataStore.relationships.getRelated(ref.expressId, relEnum, direction);
    return targets.map((expressId: number) => ({ modelId: ref.modelId, expressId }));
  }

  // ── Selection ──────────────────────────────────────────────

  getSelection(): EntityRef[] {
    const state = this.store.getState();
    return state.selectedEntities ?? [];
  }

  setSelection(refs: EntityRef[]): void {
    const state = this.store.getState();
    if (refs.length === 0) {
      state.clearEntitySelection?.();
    } else if (refs.length === 1) {
      state.setSelectedEntity?.(refs[0]);
    } else {
      // Multi-select
      state.clearEntitySelection?.();
      for (const ref of refs) {
        state.addEntityToSelection?.(ref);
      }
    }
  }

  // ── Visibility ─────────────────────────────────────────────

  hideEntities(refs: EntityRef[]): void {
    const state = this.store.getState();
    for (const ref of refs) {
      state.hideEntityInModel?.(ref.modelId, ref.expressId);
    }
  }

  showEntities(refs: EntityRef[]): void {
    const state = this.store.getState();
    for (const ref of refs) {
      state.showEntityInModel?.(ref.modelId, ref.expressId);
    }
  }

  isolateEntities(refs: EntityRef[]): void {
    const state = this.store.getState();
    // Use the legacy isolateEntities for global IDs
    const globalIds: number[] = [];
    for (const ref of refs) {
      const model = state.models.get(ref.modelId);
      if (model) {
        globalIds.push(ref.expressId + model.idOffset);
      }
    }
    if (globalIds.length > 0) {
      state.isolateEntities?.(globalIds);
    }
  }

  resetVisibility(): void {
    const state = this.store.getState();
    state.showAllInAllModels?.();
  }

  // ── Viewer ─────────────────────────────────────────────────

  colorize(refs: EntityRef[], color: [number, number, number, number]): void {
    const state = this.store.getState();
    // Build color map: globalId → rgba
    const colorMap = new Map<number, [number, number, number, number]>();
    for (const ref of refs) {
      const model = state.models.get(ref.modelId);
      if (model) {
        const globalId = ref.expressId + model.idOffset;
        colorMap.set(globalId, color);
      }
    }
    state.setPendingColorUpdates(colorMap);
  }

  resetColors(_refs?: EntityRef[]): void {
    const state = this.store.getState();
    state.clearPendingColorUpdates();
  }

  flyTo(_refs: EntityRef[]): void {
    // flyTo requires renderer access — the viewer's useBimHost hook
    // will wire this to the renderer's fitToView when available.
    // For now, this is a no-op in the local backend.
  }

  setSection(section: SectionPlane | null): void {
    const state = this.store.getState();
    if (section) {
      state.setSectionPlaneAxis?.(AXIS_TO_STORE[section.axis] ?? 'down');
      state.setSectionPlanePosition?.(section.position);
      // Toggle section plane if current enabled state doesn't match desired
      if (state.sectionPlane?.enabled !== section.enabled) {
        state.toggleSectionPlane?.();
      }
    } else {
      // Disable section plane if currently enabled
      if (state.sectionPlane?.enabled) {
        state.toggleSectionPlane?.();
      }
    }
  }

  getSection(): SectionPlane | null {
    const state = this.store.getState();
    if (!state.sectionPlane?.enabled) return null;
    return {
      axis: STORE_TO_AXIS[state.sectionPlane.axis] ?? 'y',
      position: state.sectionPlane.position,
      enabled: state.sectionPlane.enabled,
      flipped: state.sectionPlane.flipped,
    };
  }

  setCamera(cameraState: Partial<CameraState>): void {
    const state = this.store.getState();
    if (cameraState.mode) {
      state.setProjectionMode?.(cameraState.mode);
    }
  }

  getCamera(): CameraState {
    const state = this.store.getState();
    return {
      mode: state.projectionMode ?? 'perspective',
    };
  }

  // ── Mutation ───────────────────────────────────────────────

  setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean): void {
    const state = this.store.getState();
    state.setProperty?.(ref.modelId, ref.expressId, psetName, propName, value);
  }

  deleteProperty(ref: EntityRef, psetName: string, propName: string): void {
    const state = this.store.getState();
    state.deleteProperty?.(ref.modelId, ref.expressId, psetName, propName);
  }

  undo(modelId: string): boolean {
    const state = this.store.getState();
    if (state.canUndo?.(modelId)) {
      state.undo?.(modelId);
      return true;
    }
    return false;
  }

  redo(modelId: string): boolean {
    const state = this.store.getState();
    if (state.canRedo?.(modelId)) {
      state.redo?.(modelId);
      return true;
    }
    return false;
  }

  // ── Events ─────────────────────────────────────────────────

  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void {
    switch (event) {
      case 'selection:changed':
        return this.store.subscribe((state, prev) => {
          if (state.selectedEntities !== prev.selectedEntities) {
            handler({ refs: state.selectedEntities ?? [] });
          }
        });

      case 'model:loaded':
        return this.store.subscribe((state, prev) => {
          if (state.models.size > prev.models.size) {
            // Find the new model
            for (const [id, model] of state.models) {
              if (!prev.models.has(id)) {
                handler({
                  model: {
                    id: model.id,
                    name: model.name,
                    schemaVersion: model.schemaVersion,
                    entityCount: model.ifcDataStore?.entities?.count ?? 0,
                    fileSize: model.fileSize,
                    loadedAt: model.loadedAt,
                  },
                });
              }
            }
          }
        });

      case 'model:removed':
        return this.store.subscribe((state, prev) => {
          if (state.models.size < prev.models.size) {
            for (const id of prev.models.keys()) {
              if (!state.models.has(id)) {
                handler({ modelId: id });
              }
            }
          }
        });

      default:
        // Return a no-op unsubscribe for unimplemented events
        return () => {};
    }
  }
}

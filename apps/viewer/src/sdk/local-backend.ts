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
import { EntityNode, IfcQuery } from '@ifc-lite/query';
import { RelationshipType } from '@ifc-lite/data';

type StoreApi = {
  getState: () => ViewerState;
  subscribe: (listener: (state: ViewerState, prevState: ViewerState) => void) => () => void;
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
      const query = new IfcQuery(model.ifcDataStore);

      // Apply type filter
      let entityQuery = descriptor.types && descriptor.types.length > 0
        ? query.ofType(...descriptor.types)
        : query.all();

      // Execute and convert to EntityData
      const ids = entityQuery.ids();
      for (const expressId of ids) {
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
    return node.properties().map(pset => ({
      name: pset.name,
      globalId: pset.globalId,
      properties: pset.properties.map(p => ({
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
    // Group by model
    const byModel = new Map<string, Set<number>>();
    for (const ref of refs) {
      let set = byModel.get(ref.modelId);
      if (!set) { set = new Set(); byModel.set(ref.modelId, set); }
      set.add(ref.expressId);
    }
    for (const [modelId, ids] of byModel) {
      state.isolateEntitiesInModel?.(modelId, ids);
    }
  }

  resetVisibility(): void {
    const state = this.store.getState();
    state.resetVisibility?.();
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
      state.setSectionPlaneAxis?.(section.axis);
      state.setSectionPlanePosition?.(section.position);
      state.setSectionPlaneEnabled?.(section.enabled);
    } else {
      state.setSectionPlaneEnabled?.(false);
    }
  }

  getSection(): SectionPlane | null {
    const state = this.store.getState();
    if (!state.sectionPlane?.enabled) return null;
    return {
      axis: state.sectionPlane.axis,
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

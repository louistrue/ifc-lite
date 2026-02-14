/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  EntityRef,
  EntityData,
  PropertySetData,
  QuantitySetData,
  QueryDescriptor,
} from '@ifc-lite/sdk';
import type { NamespaceAdapter, StoreApi } from './types.js';
import { EntityNode } from '@ifc-lite/query';
import { RelationshipType } from '@ifc-lite/data';
import { getModelForRef, getAllModelEntries } from './model-compat.js';

const REL_TYPE_MAP: Record<string, RelationshipType> = {
  ContainsElements: RelationshipType.ContainsElements,
  Aggregates: RelationshipType.Aggregates,
  DefinesByType: RelationshipType.DefinesByType,
  VoidsElement: RelationshipType.VoidsElement,
  FillsElement: RelationshipType.FillsElement,
};

export function createQueryAdapter(store: StoreApi): NamespaceAdapter {
  function getEntityData(ref: EntityRef): EntityData | null {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
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

  function getProperties(ref: EntityRef): PropertySetData[] {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
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

  function getQuantities(ref: EntityRef): QuantitySetData[] {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
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

  function queryEntities(descriptor: QueryDescriptor): EntityData[] {
    const state = store.getState();
    const results: EntityData[] = [];

    const modelEntries = descriptor.modelId
      ? [[descriptor.modelId, getModelForRef(state, descriptor.modelId)] as const].filter(([, m]) => m)
      : getAllModelEntries(state);

    for (const [modelId, model] of modelEntries) {
      if (!model?.ifcDataStore) continue;

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

    // Apply property filters
    let filtered = results;
    if (descriptor.filters && descriptor.filters.length > 0) {
      // Cache properties per entity to avoid O(n²) re-extraction per filter
      const propsCache = new Map<string, PropertySetData[]>();
      const getCachedProps = (ref: EntityRef): PropertySetData[] => {
        const key = `${ref.modelId}:${ref.expressId}`;
        let cached = propsCache.get(key);
        if (!cached) {
          cached = getProperties(ref);
          propsCache.set(key, cached);
        }
        return cached;
      };

      for (const filter of descriptor.filters) {
        filtered = filtered.filter(entity => {
          const props = getCachedProps(entity.ref);
          const pset = props.find(p => p.name === filter.psetName);
          if (!pset) return false;
          const prop = pset.properties.find(p => p.name === filter.propName);
          if (!prop) return false;
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

    if (descriptor.offset) filtered = filtered.slice(descriptor.offset);
    if (descriptor.limit) filtered = filtered.slice(0, descriptor.limit);

    return filtered;
  }

  return {
    dispatch(method: string, args: unknown[]): unknown {
      switch (method) {
        case 'entities':
          return queryEntities(args[0] as QueryDescriptor);
        case 'entityData':
          return getEntityData(args[0] as EntityRef);
        case 'properties':
          return getProperties(args[0] as EntityRef);
        case 'quantities':
          return getQuantities(args[0] as EntityRef);
        case 'related': {
          const ref = args[0] as EntityRef;
          const relType = args[1] as string;
          const direction = args[2] as 'forward' | 'inverse';
          const state = store.getState();
          const model = getModelForRef(state, ref.modelId);
          if (!model?.ifcDataStore) return [];
          const relEnum = REL_TYPE_MAP[relType];
          if (relEnum === undefined) return [];
          const targets = model.ifcDataStore.relationships.getRelated(ref.expressId, relEnum, direction);
          return targets.map((expressId: number) => ({ modelId: ref.modelId, expressId }));
        }
        default:
          throw new Error(`Unknown query method: ${method}`);
      }
    },
  };
}

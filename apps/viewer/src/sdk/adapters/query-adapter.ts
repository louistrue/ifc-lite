/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  EntityRef,
  EntityData,
  PropertySetData,
  QuantitySetData,
  ComputedQuantities,
  QueryDescriptor,
  QueryBackendMethods,
} from '@ifc-lite/sdk';
import type { StoreApi } from './types.js';
import type { MeshData } from '@ifc-lite/geometry';
import { EntityNode } from '@ifc-lite/query';
import { RelationshipType, IfcTypeEnum, IfcTypeEnumFromString } from '@ifc-lite/data';
import { getModelForRef, getAllModelEntries } from './model-compat.js';

// ── Geometry-based quantity computation ──────────────────────────────
// These mirror the Rust Mesh::volume() / Mesh::surface_area() algorithms.

/** Compute volume using the signed tetrahedron (divergence theorem) method. */
function computeVolume(positions: Float32Array, indices: Uint32Array): number {
  let sum = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    if (i0 + 2 >= positions.length || i1 + 2 >= positions.length || i2 + 2 >= positions.length) continue;

    // v0 × v1 · v2
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // cross(a, b) = (ay*bz - az*by, az*bx - ax*bz, ax*by - ay*bx)
    const crossX = ay * bz - az * by;
    const crossY = az * bx - ax * bz;
    const crossZ = ax * by - ay * bx;

    sum += crossX * cx + crossY * cy + crossZ * cz;
  }
  return Math.abs(sum / 6);
}

/** Compute total surface area by summing all triangle areas. */
function computeSurfaceArea(positions: Float32Array, indices: Uint32Array): number {
  let sum = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    if (i0 + 2 >= positions.length || i1 + 2 >= positions.length || i2 + 2 >= positions.length) continue;

    // edge1 = v1 - v0, edge2 = v2 - v0
    const e1x = positions[i1] - positions[i0];
    const e1y = positions[i1 + 1] - positions[i0 + 1];
    const e1z = positions[i1 + 2] - positions[i0 + 2];
    const e2x = positions[i2] - positions[i0];
    const e2y = positions[i2 + 1] - positions[i0 + 1];
    const e2z = positions[i2 + 2] - positions[i0 + 2];

    // |cross(e1, e2)| / 2
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    sum += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }
  return sum;
}

/** Find the mesh for a given expressId across all geometry stores. */
function findMeshForEntity(store: StoreApi, ref: EntityRef): MeshData | null {
  const state = store.getState();

  // Federation mode: check models Map
  const model = state.models.get(ref.modelId);
  if (model?.geometryResult) {
    const mesh = model.geometryResult.meshes.find(
      (m: MeshData) => m.expressId === ref.expressId,
    );
    if (mesh) return mesh;
  }

  // Legacy single-model mode
  if (state.geometryResult) {
    const mesh = state.geometryResult.meshes.find(
      (m: MeshData) => m.expressId === ref.expressId,
    );
    if (mesh) return mesh;
  }

  return null;
}

/** Map IFC relationship entity names to internal RelationshipType enum.
 * Keys use proper IFC schema names (e.g. IfcRelAggregates, not "Aggregates"). */
const REL_TYPE_MAP: Record<string, RelationshipType> = {
  IfcRelContainedInSpatialStructure: RelationshipType.ContainsElements,
  IfcRelAggregates: RelationshipType.Aggregates,
  IfcRelDefinesByType: RelationshipType.DefinesByType,
  IfcRelVoidsElement: RelationshipType.VoidsElement,
  IfcRelFillsElement: RelationshipType.FillsElement,
};

/**
 * IFC4 subtype map — maps parent types to their StandardCase/ElementedCase subtypes.
 * In IFC4, many element types have *StandardCase subtypes that the parser stores
 * as the full type name. This map lets byType('IfcWall') also find IfcWallStandardCase.
 *
 * Keys and values are UPPERCASE because entityIndex.byType uses UPPERCASE keys
 * (raw STEP type names, e.g. IFCWALLSTANDARDCASE).
 */
const IFC_SUBTYPES: Record<string, string[]> = {
  IFCWALL: ['IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE'],
  IFCBEAM: ['IFCBEAMSTANDARDCASE'],
  IFCCOLUMN: ['IFCCOLUMNSTANDARDCASE'],
  IFCDOOR: ['IFCDOORSTANDARDCASE'],
  IFCWINDOW: ['IFCWINDOWSTANDARDCASE'],
  IFCSLAB: ['IFCSLABSTANDARDCASE', 'IFCSLABELEMENTEDCASE'],
  IFCMEMBER: ['IFCMEMBERSTANDARDCASE'],
  IFCPLATE: ['IFCPLATESTANDARDCASE'],
  IFCOPENINGELEMENT: ['IFCOPENINGSTANDARDCASE'],
};

/**
 * Expand a type list to include known IFC subtypes.
 * Converts PascalCase input (e.g. 'IfcWall') to UPPERCASE for entityIndex lookup.
 */
function expandTypes(types: string[]): string[] {
  const result: string[] = [];
  for (const type of types) {
    const upper = type.toUpperCase();
    result.push(upper);
    const subtypes = IFC_SUBTYPES[upper];
    if (subtypes) {
      for (const sub of subtypes) result.push(sub);
    }
  }
  return result;
}

/**
 * Check if a type name represents a product/spatial entity.
 *
 * Uses IfcTypeEnum as a whitelist — only known IFC types pass.
 * Excludes relationships, properties, quantities, element quantities,
 * and type objects (IfcWallType, IfcDoorType, etc.).
 *
 * Type names from entityIndex.byType are UPPERCASE (e.g. IFCWALLSTANDARDCASE).
 */
function isProductType(type: string): boolean {
  const enumVal = IfcTypeEnumFromString(type);
  // Unknown = not a recognized product/spatial type (geometry definitions, placements, etc.)
  if (enumVal === IfcTypeEnum.Unknown) return false;
  // Exclude relationships, properties, quantities
  const upper = type.toUpperCase();
  if (upper.startsWith('IFCREL')) return false;
  if (upper.startsWith('IFCPROPERTY')) return false;
  if (upper.startsWith('IFCQUANTITY')) return false;
  if (upper === 'IFCELEMENTQUANTITY') return false;
  // Exclude type objects (IfcWallType, IfcDoorType, etc.) — metadata, not instances
  if (upper.endsWith('TYPE')) return false;
  return true;
}

export function createQueryAdapter(store: StoreApi): QueryBackendMethods {
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
    const base = node.properties().map((pset: { name: string; globalId?: string; properties: Array<{ name: string; type: number; value: string | number | boolean | null }> }) => ({
      name: pset.name,
      globalId: pset.globalId,
      properties: pset.properties.map((p: { name: string; type: number; value: string | number | boolean | null }) => ({
        name: p.name,
        type: p.type,
        value: p.value,
      })),
    }));

    // Merge mutations (non-Qto sets)
    const mutationView = state.mutationViews?.get(ref.modelId);
    if (!mutationView) return base;
    const merged = mutationView.getForEntity(ref.expressId);
    if (merged.length === 0) return base;

    // Add mutated psets that don't exist in base (skip Qto_ — those go to quantities)
    const baseNames = new Set(base.map(p => p.name));
    for (const pset of merged) {
      if (pset.name.startsWith('Qto_')) continue;
      if (!baseNames.has(pset.name)) {
        base.push({
          name: pset.name,
          globalId: pset.globalId,
          properties: pset.properties.map((p: { name: string; type: number; value: unknown }) => ({
            name: p.name,
            type: p.type,
            value: p.value as string | number | boolean | null,
          })),
        });
      }
    }
    return base;
  }

  function getQuantities(ref: EntityRef): QuantitySetData[] {
    const state = store.getState();
    const model = getModelForRef(state, ref.modelId);
    if (!model?.ifcDataStore) return [];

    const node = new EntityNode(model.ifcDataStore, ref.expressId);
    const base = node.quantities().map(qset => ({
      name: qset.name,
      quantities: qset.quantities.map(q => ({
        name: q.name,
        type: q.type,
        value: q.value,
      })),
    }));

    // Merge mutated Qto sets so CSV export picks up computed quantities
    const mutationView = state.mutationViews?.get(ref.modelId);
    if (!mutationView) return base;
    const merged = mutationView.getForEntity(ref.expressId);
    const mutatedQtos = merged.filter((p: { name: string }) => p.name.startsWith('Qto_'));
    if (mutatedQtos.length === 0) return base;

    const inferType = (name: string): number => {
      const n = name.toLowerCase();
      if (n.includes('volume')) return 2;
      if (n.includes('area')) return 1;
      if (n.includes('weight')) return 4;
      if (n.includes('count')) return 3;
      return 0;
    };

    const seen = new Set(base.map(q => q.name));
    for (const mp of mutatedQtos) {
      if (seen.has(mp.name)) {
        // Merge new quantities into existing base set
        const existing = base.find(q => q.name === mp.name)!;
        const existingNames = new Set(existing.quantities.map(q => q.name));
        for (const p of mp.properties) {
          if (!existingNames.has(p.name) && typeof p.value === 'number') {
            existing.quantities.push({ name: p.name, type: inferType(p.name), value: p.value });
          }
        }
      } else {
        // Add entirely new Qto set
        base.push({
          name: mp.name,
          quantities: mp.properties
            .filter((p: { value: unknown }) => typeof p.value === 'number')
            .map((p: { name: string; value: unknown }) => ({ name: p.name, type: inferType(p.name), value: p.value as number })),
        });
      }
    }
    return base;
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
        // Expand types to include IFC4 subtypes (e.g., IfcWall → IfcWallStandardCase)
        entityIds = [];
        for (const type of expandTypes(descriptor.types)) {
          const typeIds = model.ifcDataStore.entityIndex.byType.get(type) ?? [];
          for (const id of typeIds) entityIds.push(id);
        }
      } else {
        // No type filter — return product entities only (skip relationships, property defs)
        entityIds = [];
        for (const [typeName, ids] of model.ifcDataStore.entityIndex.byType) {
          if (isProductType(typeName)) {
            for (const id of ids) entityIds.push(id);
          }
        }
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

    if (descriptor.offset != null && descriptor.offset > 0) filtered = filtered.slice(descriptor.offset);
    if (descriptor.limit != null && descriptor.limit > 0) filtered = filtered.slice(0, descriptor.limit);

    return filtered;
  }

  function getComputedQuantities(ref: EntityRef): ComputedQuantities | null {
    const mesh = findMeshForEntity(store, ref);
    if (!mesh || mesh.positions.length < 9) return null;

    const volume = computeVolume(mesh.positions, mesh.indices);
    const surfaceArea = computeSurfaceArea(mesh.positions, mesh.indices);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    return {
      volume,
      surfaceArea,
      bboxDx: maxX - minX,
      bboxDy: maxY - minY,
      bboxDz: maxZ - minZ,
    };
  }

  return {
    entities: queryEntities,
    entityData: getEntityData,
    properties: getProperties,
    quantities: getQuantities,
    computedQuantities: getComputedQuantities,
    related(ref: EntityRef, relType: string, direction: 'forward' | 'inverse') {
      const state = store.getState();
      const model = getModelForRef(state, ref.modelId);
      if (!model?.ifcDataStore) return [];
      const relEnum = REL_TYPE_MAP[relType];
      if (relEnum === undefined) return [];
      const targets = model.ifcDataStore.relationships.getRelated(ref.expressId, relEnum, direction);
      return targets.map((expressId: number) => ({ modelId: ref.modelId, expressId }));
    },
  };
}

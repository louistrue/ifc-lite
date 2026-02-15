/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  BimBackend,
  EntityRef,
  EntityData,
  PropertySetData,
  QuantitySetData,
  QueryDescriptor,
  QueryFilter,
  ComparisonOp,
} from '../types.js';

/**
 * Lightweight entity proxy — returned by queries.
 * Property/quantity access is lazy (calls backend on demand).
 */
export class EntityProxy {
  private _properties: PropertySetData[] | null = null;
  private _quantities: QuantitySetData[] | null = null;
  private _data: EntityData;
  private backend: BimBackend;

  constructor(data: EntityData, backend: BimBackend) {
    this._data = data;
    this.backend = backend;
  }

  get ref(): EntityRef { return this._data.ref; }
  get modelId(): string { return this._data.ref.modelId; }
  get expressId(): number { return this._data.ref.expressId; }

  // IFC schema attribute names (PascalCase per IFC EXPRESS specification)
  get GlobalId(): string { return this._data.globalId; }
  get Name(): string { return this._data.name; }
  get Type(): string { return this._data.type; }
  get Description(): string { return this._data.description; }
  get ObjectType(): string { return this._data.objectType; }

  // camelCase aliases for backward compatibility
  get globalId(): string { return this._data.globalId; }
  get name(): string { return this._data.name; }
  get type(): string { return this._data.type; }
  get description(): string { return this._data.description; }
  get objectType(): string { return this._data.objectType; }

  /** Get all property sets (cached after first call) */
  properties(): PropertySetData[] {
    if (!this._properties) {
      this._properties = this.backend.dispatch('query', 'properties', [this.ref]) as PropertySetData[];
    }
    return this._properties;
  }

  /** Get a single property value */
  property(psetName: string, propName: string): string | number | boolean | null {
    const psets = this.properties();
    const pset = psets.find(p => p.name === psetName);
    if (!pset) return null;
    const prop = pset.properties.find(p => p.name === propName);
    return prop?.value ?? null;
  }

  /** Get all quantity sets (cached after first call) */
  quantities(): QuantitySetData[] {
    if (!this._quantities) {
      this._quantities = this.backend.dispatch('query', 'quantities', [this.ref]) as QuantitySetData[];
    }
    return this._quantities;
  }

  /** Get a single quantity value */
  quantity(qsetName: string, quantityName: string): number | null {
    const qsets = this.quantities();
    const qset = qsets.find(q => q.name === qsetName);
    if (!qset) return null;
    const qty = qset.quantities.find(q => q.name === quantityName);
    return qty?.value ?? null;
  }

  /** IfcRelContainedInSpatialStructure (inverse) — what spatial element contains this entity */
  containedIn(): EntityProxy | null {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelContainedInSpatialStructure', 'inverse']) as EntityRef[];
    if (refs.length === 0) return null;
    const data = this.backend.dispatch('query', 'entityData', [refs[0]]) as EntityData | null;
    return data ? new EntityProxy(data, this.backend) : null;
  }

  /** IfcRelContainedInSpatialStructure (forward) — elements contained in this spatial element */
  contains(): EntityProxy[] {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelContainedInSpatialStructure', 'forward']) as EntityRef[];
    return this.refsToProxies(refs);
  }

  /** IfcRelAggregates (inverse) — the whole that this entity is a part of */
  decomposedBy(): EntityProxy | null {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelAggregates', 'inverse']) as EntityRef[];
    if (refs.length === 0) return null;
    const data = this.backend.dispatch('query', 'entityData', [refs[0]]) as EntityData | null;
    return data ? new EntityProxy(data, this.backend) : null;
  }

  /** IfcRelAggregates (forward) — parts that this entity aggregates */
  decomposes(): EntityProxy[] {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelAggregates', 'forward']) as EntityRef[];
    return this.refsToProxies(refs);
  }

  /** IfcRelDefinesByType (forward) — the type object defining this entity */
  definingType(): EntityProxy | null {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelDefinesByType', 'forward']) as EntityRef[];
    if (refs.length === 0) return null;
    const data = this.backend.dispatch('query', 'entityData', [refs[0]]) as EntityData | null;
    return data ? new EntityProxy(data, this.backend) : null;
  }

  /** IfcRelVoidsElement (forward) — openings that void this element */
  voids(): EntityProxy[] {
    const refs = this.backend.dispatch('query', 'related', [this.ref, 'IfcRelVoidsElement', 'forward']) as EntityRef[];
    return this.refsToProxies(refs);
  }

  /** Navigate up to the building storey */
  storey(): EntityProxy | null {
    let current: EntityProxy | null = this;  // eslint-disable-line @typescript-eslint/no-this-alias
    const visited = new Set<string>();
    while (current) {
      const key = `${current.modelId}:${current.expressId}`;
      if (visited.has(key)) break;
      visited.add(key);
      if (current.type === 'IfcBuildingStorey') return current;
      current = current.containedIn() ?? current.decomposedBy();
    }
    return null;
  }

  private refsToProxies(refs: EntityRef[]): EntityProxy[] {
    const result: EntityProxy[] = [];
    for (const ref of refs) {
      const data = this.backend.dispatch('query', 'entityData', [ref]) as EntityData | null;
      if (data) result.push(new EntityProxy(data, this.backend));
    }
    return result;
  }
}

/**
 * Chainable query builder — collects filters, executes on terminal call.
 *
 * Usage:
 *   bim.query().byType('IfcWall').where('Pset_WallCommon', 'IsExternal', '=', true).toArray()
 */
export class QueryBuilder {
  private descriptor: QueryDescriptor = {};
  private backend: BimBackend;

  constructor(backend: BimBackend) {
    this.backend = backend;
  }

  /** Scope query to a specific model */
  model(modelId: string): this {
    this.descriptor.modelId = modelId;
    return this;
  }

  /** Filter by IFC class type(s) */
  byType(...types: string[]): this {
    this.descriptor.types = [...(this.descriptor.types ?? []), ...types];
    return this;
  }

  /** Filter by property value */
  where(psetName: string, propName: string, operator?: ComparisonOp, value?: string | number | boolean): this {
    const filter: QueryFilter = {
      psetName,
      propName,
      operator: operator ?? 'exists',
      value,
    };
    this.descriptor.filters = [...(this.descriptor.filters ?? []), filter];
    return this;
  }

  /** Limit result count */
  limit(n: number): this {
    this.descriptor.limit = n;
    return this;
  }

  /** Skip first n results */
  offset(n: number): this {
    this.descriptor.offset = n;
    return this;
  }

  // ── Terminal operations ────────────────────────────────────

  /** Execute and return EntityProxy array */
  toArray(): EntityProxy[] {
    const entities = this.backend.dispatch('query', 'entities', [this.descriptor]) as EntityData[];
    return entities.map(e => new EntityProxy(e, this.backend));
  }

  /** Execute and return first match or null */
  first(): EntityProxy | null {
    const saved = this.descriptor.limit;
    this.descriptor.limit = 1;
    const result = this.toArray();
    this.descriptor.limit = saved;
    return result[0] ?? null;
  }

  /** Execute and return count */
  count(): number {
    // TODO: Add dedicated 'count' backend method to avoid fetching full entity data
    return (this.backend.dispatch('query', 'entities', [this.descriptor]) as EntityData[]).length;
  }

  /** Execute and return just EntityRef[] (no property data) */
  refs(): EntityRef[] {
    // TODO: Add dedicated 'refs' backend method to avoid fetching full entity data
    return (this.backend.dispatch('query', 'entities', [this.descriptor]) as EntityData[]).map(e => e.ref);
  }
}

/** bim.query — Chainable entity queries */
export class QueryNamespace {
  constructor(private backend: BimBackend) {}

  /** Start a new query chain */
  create(): QueryBuilder {
    return new QueryBuilder(this.backend);
  }

  /** Get a single entity by ref */
  entity(ref: EntityRef): EntityProxy | null {
    const data = this.backend.dispatch('query', 'entityData', [ref]) as EntityData | null;
    return data ? new EntityProxy(data, this.backend) : null;
  }
}

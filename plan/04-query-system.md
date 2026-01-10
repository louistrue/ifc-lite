# IFC-Lite: Part 4 - Query System

## 4.1 Unified Query Interface

```typescript
/**
 * Main query interface - provides multiple access patterns.
 */
class IfcQuery {
  private store: IfcDataStore;
  private duckdb: DuckDBIntegration | null = null;
  
  constructor(store: IfcDataStore) {
    this.store = store;
  }

  // ═══════════════════════════════════════════════════════════════
  // FLUENT API - Type-safe query builder
  // ═══════════════════════════════════════════════════════════════
  
  walls(): EntityQuery { return this.ofType('IfcWall', 'IfcWallStandardCase'); }
  doors(): EntityQuery { return this.ofType('IfcDoor'); }
  windows(): EntityQuery { return this.ofType('IfcWindow'); }
  slabs(): EntityQuery { return this.ofType('IfcSlab'); }
  columns(): EntityQuery { return this.ofType('IfcColumn'); }
  beams(): EntityQuery { return this.ofType('IfcBeam'); }
  spaces(): EntityQuery { return this.ofType('IfcSpace'); }
  
  ofType(...types: string[]): EntityQuery {
    const typeEnums = types.map(t => IfcTypeEnumFromString(t));
    return new EntityQuery(this.store, typeEnums);
  }
  
  all(): EntityQuery {
    return new EntityQuery(this.store, null);
  }
  
  byId(expressId: number): EntityQuery {
    return new EntityQuery(this.store, null, [expressId]);
  }

  // ═══════════════════════════════════════════════════════════════
  // SQL API - Full SQL power via DuckDB-WASM
  // ═══════════════════════════════════════════════════════════════
  
  async sql(query: string): Promise<SQLResult> {
    await this.ensureDuckDB();
    return this.duckdb!.query(query);
  }

  // ═══════════════════════════════════════════════════════════════
  // GRAPH API - Relationship traversal
  // ═══════════════════════════════════════════════════════════════
  
  entity(expressId: number): EntityNode {
    return new EntityNode(this.store, expressId);
  }

  // ═══════════════════════════════════════════════════════════════
  // SPATIAL API - Geometry-based queries
  // ═══════════════════════════════════════════════════════════════
  
  inBounds(aabb: AABB): EntityQuery {
    const ids = this.store.spatialIndex.queryAABB(aabb);
    return new EntityQuery(this.store, null, ids);
  }
  
  onStorey(storeyId: number): EntityQuery {
    const ids = this.store.spatialHierarchy.byStorey.get(storeyId) ?? [];
    return new EntityQuery(this.store, null, ids);
  }
  
  raycast(origin: Vec3, direction: Vec3): RaycastHit[] {
    return this.store.spatialIndex.raycast(origin, direction);
  }

  // ═══════════════════════════════════════════════════════════════
  // SHORTCUTS
  // ═══════════════════════════════════════════════════════════════
  
  get hierarchy(): SpatialHierarchy { return this.store.spatialHierarchy; }
  get project(): EntityNode { return this.entity(this.store.spatialHierarchy.project.expressId); }
  get buildings(): EntityNode[] {
    return [...this.store.spatialHierarchy.byBuilding.keys()].map(id => this.entity(id));
  }
  get storeys(): EntityNode[] {
    return [...this.store.spatialHierarchy.byStorey.keys()]
      .sort((a, b) => {
        const elevA = this.store.spatialHierarchy.storeyElevations.get(a) ?? 0;
        const elevB = this.store.spatialHierarchy.storeyElevations.get(b) ?? 0;
        return elevA - elevB;
      })
      .map(id => this.entity(id));
  }
}
```

---

## 4.2 Fluent Query Builder

```typescript
/**
 * Fluent query builder for entities.
 */
class EntityQuery {
  private store: IfcDataStore;
  private typeFilter: IfcTypeEnum[] | null;
  private idFilter: number[] | null;
  private predicates: QueryPredicate[] = [];
  private includeFlags: IncludeFlags = {};
  private limitCount: number | null = null;
  private offsetCount: number = 0;
  
  constructor(store: IfcDataStore, types: IfcTypeEnum[] | null, ids: number[] | null = null) {
    this.store = store;
    this.typeFilter = types;
    this.idFilter = ids;
  }

  // ═══════════════════════════════════════════════════════════════
  // FILTERING
  // ═══════════════════════════════════════════════════════════════
  
  where(predicate: (e: EntityAccessor) => boolean): this {
    this.predicates.push({ type: 'function', fn: predicate });
    return this;
  }
  
  whereProperty(psetName: string, propName: string, operator: ComparisonOperator, value: PropertyValue): this {
    this.predicates.push({ type: 'property', psetName, propName, operator, value });
    return this;
  }
  
  whereName(pattern: string | RegExp): this {
    this.predicates.push({ type: 'name', pattern });
    return this;
  }
  
  withGeometryOnly(): this {
    this.predicates.push({ type: 'hasGeometry' });
    return this;
  }
  
  onStorey(storeyId: number): this {
    this.predicates.push({ type: 'storey', storeyId });
    return this;
  }
  
  inBounds(aabb: AABB): this {
    this.predicates.push({ type: 'bounds', aabb });
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // INCLUDES (eager loading)
  // ═══════════════════════════════════════════════════════════════
  
  includeGeometry(): this { this.includeFlags.geometry = true; return this; }
  includeProperties(): this { this.includeFlags.properties = true; return this; }
  includeQuantities(): this { this.includeFlags.quantities = true; return this; }
  includeMaterials(): this { this.includeFlags.materials = true; return this; }
  includeAll(): this {
    this.includeFlags = { geometry: true, properties: true, quantities: true, materials: true };
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGINATION
  // ═══════════════════════════════════════════════════════════════
  
  limit(count: number): this { this.limitCount = count; return this; }
  offset(count: number): this { this.offsetCount = count; return this; }
  page(pageNumber: number, pageSize: number): this {
    this.offsetCount = pageNumber * pageSize;
    this.limitCount = pageSize;
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION
  // ═══════════════════════════════════════════════════════════════
  
  async execute(): Promise<QueryResultEntity[]> {
    let ids = this.getCandidateIds();
    ids = await this.applyPredicates(ids);
    if (this.offsetCount > 0) ids = ids.slice(this.offsetCount);
    if (this.limitCount !== null) ids = ids.slice(0, this.limitCount);
    return this.materializeResults(ids);
  }
  
  async ids(): Promise<number[]> {
    let ids = this.getCandidateIds();
    ids = await this.applyPredicates(ids);
    if (this.offsetCount > 0) ids = ids.slice(this.offsetCount);
    if (this.limitCount !== null) ids = ids.slice(0, this.limitCount);
    return ids;
  }
  
  async count(): Promise<number> {
    let ids = this.getCandidateIds();
    ids = await this.applyPredicates(ids);
    return ids.length;
  }
  
  async first(): Promise<QueryResultEntity | null> {
    const results = await this.limit(1).execute();
    return results[0] ?? null;
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════
  
  async toJSON(): Promise<object[]> {
    return (await this.execute()).map(r => r.toJSON());
  }
  
  async toCSV(): Promise<string> {
    return resultsToCSV(await this.includeProperties().execute());
  }

  // ═══════════════════════════════════════════════════════════════
  // GEOMETRY
  // ═══════════════════════════════════════════════════════════════
  
  async geometry(): Promise<CombinedGeometry> {
    return this.store.geometry.getCombined(await this.ids());
  }
  
  async bounds(): Promise<AABB> {
    return this.store.geometry.getCombinedBounds(await this.ids());
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════
  
  private getCandidateIds(): number[] {
    if (this.idFilter) return [...this.idFilter];
    if (this.typeFilter) {
      const ids: number[] = [];
      for (const typeEnum of this.typeFilter) {
        ids.push(...(this.store.entityIndex.byType.get(typeEnum) ?? []));
      }
      return ids;
    }
    return [...this.store.entityIndex.byId.keys()];
  }
  
  private async applyPredicates(ids: number[]): Promise<number[]> {
    for (const predicate of this.predicates) {
      ids = await this.applyPredicate(ids, predicate);
    }
    return ids;
  }
  
  private async applyPredicate(ids: number[], predicate: QueryPredicate): Promise<number[]> {
    switch (predicate.type) {
      case 'property':
        return this.applyPropertyPredicate(ids, predicate);
      case 'hasGeometry':
        return ids.filter(id => this.store.entities.hasGeometry(id));
      case 'storey':
        const storeyElements = new Set(this.store.spatialHierarchy.byStorey.get(predicate.storeyId) ?? []);
        return ids.filter(id => storeyElements.has(id));
      case 'bounds':
        const boundsIds = new Set(this.store.spatialIndex.queryAABB(predicate.aabb));
        return ids.filter(id => boundsIds.has(id));
      default:
        return ids;
    }
  }
  
  private applyPropertyPredicate(ids: number[], pred: PropertyPredicate): number[] {
    const { psetName, propName, operator, value } = pred;
    const propTable = this.store.properties;
    const psetIdx = this.store.strings.indexOf(psetName);
    const propIdx = this.store.strings.indexOf(propName);
    if (psetIdx < 0 || propIdx < 0) return [];
    
    const matchingEntities = new Set<number>();
    const idsSet = new Set(ids);
    
    for (let i = 0; i < propTable.count; i++) {
      if (propTable.psetName[i] !== psetIdx) continue;
      if (propTable.propName[i] !== propIdx) continue;
      const entityId = propTable.entityId[i];
      if (!idsSet.has(entityId)) continue;
      
      const propValue = this.getPropertyValue(propTable, i);
      if (this.compareValues(propValue, operator, value)) {
        matchingEntities.add(entityId);
      }
    }
    
    return ids.filter(id => matchingEntities.has(id));
  }
  
  private materializeResults(ids: number[]): QueryResultEntity[] {
    return ids.map(id => {
      const entity = new QueryResultEntity(this.store, id);
      if (this.includeFlags.properties) entity.loadProperties();
      if (this.includeFlags.quantities) entity.loadQuantities();
      if (this.includeFlags.geometry) entity.loadGeometry();
      if (this.includeFlags.materials) entity.loadMaterials();
      return entity;
    });
  }
}

type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith';
```

---

## 4.3 Query Result Entity

```typescript
class QueryResultEntity {
  private store: IfcDataStore;
  readonly expressId: number;
  private _properties?: PropertySet[];
  private _quantities?: QuantitySet[];
  private _geometry?: ColumnarMesh | null;
  private _materials?: Material[];
  
  constructor(store: IfcDataStore, expressId: number) {
    this.store = store;
    this.expressId = expressId;
  }
  
  get globalId(): string { return this.store.entities.getGlobalId(this.expressId); }
  get name(): string { return this.store.entities.getName(this.expressId); }
  get type(): string { return this.store.entities.getTypeName(this.expressId); }
  
  get properties(): PropertySet[] {
    if (!this._properties) this.loadProperties();
    return this._properties!;
  }
  
  get geometry(): ColumnarMesh | null {
    if (this._geometry === undefined) this.loadGeometry();
    return this._geometry ?? null;
  }
  
  getProperty(psetName: string, propName: string): PropertyValue | null {
    const pset = this.properties.find(p => p.name === psetName);
    return pset?.properties.find(p => p.name === propName)?.value ?? null;
  }
  
  asNode(): EntityNode { return new EntityNode(this.store, this.expressId); }
  
  toJSON(): object {
    return {
      expressId: this.expressId,
      globalId: this.globalId,
      name: this.name,
      type: this.type,
      properties: this._properties,
    };
  }
  
  loadProperties(): void { this._properties = this.store.properties.getForEntity(this.expressId); }
  loadQuantities(): void { this._quantities = this.store.quantities.getForEntity(this.expressId); }
  loadGeometry(): void { this._geometry = this.store.geometry.getMesh(this.expressId); }
  loadMaterials(): void { /* ... */ }
}
```

---

## 4.4 Graph Traversal

```typescript
class EntityNode {
  private store: IfcDataStore;
  readonly expressId: number;
  
  constructor(store: IfcDataStore, expressId: number) {
    this.store = store;
    this.expressId = expressId;
  }
  
  get globalId(): string { return this.store.entities.getGlobalId(this.expressId); }
  get name(): string { return this.store.entities.getName(this.expressId); }
  get type(): string { return this.store.entities.getTypeName(this.expressId); }

  // Spatial containment
  contains(): EntityNode[] { return this.getRelated(RelationshipType.ContainsElements, 'forward'); }
  containedIn(): EntityNode | null { return this.getRelated(RelationshipType.ContainsElements, 'inverse')[0] ?? null; }
  
  // Aggregation
  decomposes(): EntityNode[] { return this.getRelated(RelationshipType.Aggregates, 'forward'); }
  decomposedBy(): EntityNode | null { return this.getRelated(RelationshipType.Aggregates, 'inverse')[0] ?? null; }
  
  // Types
  definingType(): EntityNode | null { return this.getRelated(RelationshipType.DefinesByType, 'forward')[0] ?? null; }
  instances(): EntityNode[] { return this.getRelated(RelationshipType.DefinesByType, 'inverse'); }
  
  // Openings
  voids(): EntityNode[] { return this.getRelated(RelationshipType.VoidsElement, 'forward'); }
  filledBy(): EntityNode[] { return this.getRelated(RelationshipType.FillsElement, 'inverse'); }

  // Multi-hop traversal
  traverse(relType: RelationshipType, depth: number, direction: 'forward' | 'inverse' = 'forward'): EntityNode[] {
    const visited = new Set<number>();
    const result: EntityNode[] = [];
    
    const visit = (nodeId: number, currentDepth: number) => {
      if (currentDepth > depth || visited.has(nodeId)) return;
      visited.add(nodeId);
      if (nodeId !== this.expressId) result.push(new EntityNode(this.store, nodeId));
      
      const edges = direction === 'forward'
        ? this.store.graph.forward.getEdges(nodeId, relType)
        : this.store.graph.inverse.getEdges(nodeId, relType);
      for (const edge of edges) visit(edge.target, currentDepth + 1);
    };
    
    visit(this.expressId, 0);
    return result;
  }

  // Spatial shortcuts
  building(): EntityNode | null {
    let current: EntityNode | null = this;
    while (current) {
      if (current.type === 'IfcBuilding') return current;
      current = current.containedIn() ?? current.decomposedBy();
    }
    return null;
  }
  
  storey(): EntityNode | null {
    let current: EntityNode | null = this;
    while (current) {
      if (current.type === 'IfcBuildingStorey') return current;
      current = current.containedIn() ?? current.decomposedBy();
    }
    return null;
  }

  // Data access
  properties(): PropertySet[] { return this.store.properties.getForEntity(this.expressId); }
  property(psetName: string, propName: string): PropertyValue | null {
    const pset = this.properties().find(p => p.name === psetName);
    return pset?.properties.find(p => p.name === propName)?.value ?? null;
  }
  geometry(): ColumnarMesh | null { return this.store.geometry.getMesh(this.expressId); }
  bounds(): AABB | null { return this.store.geometry.getBounds(this.expressId); }
  
  private getRelated(relType: RelationshipType, direction: 'forward' | 'inverse'): EntityNode[] {
    const edges = direction === 'forward'
      ? this.store.graph.forward.getEdges(this.expressId, relType)
      : this.store.graph.inverse.getEdges(this.expressId, relType);
    return edges.map(e => new EntityNode(this.store, e.target));
  }
}
```

---

## 4.5 SQL Integration (DuckDB-WASM)

```typescript
class DuckDBIntegration {
  private db: AsyncDuckDB;
  private conn: AsyncDuckDBConnection;
  
  async init(store: IfcDataStore): Promise<void> {
    const duckdb = await import('@duckdb/duckdb-wasm');
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    
    const worker = new Worker(bundle.mainWorker!);
    this.db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.conn = await this.db.connect();
    
    await this.registerTables(store);
    await this.createViews();
  }
  
  private async registerTables(store: IfcDataStore): Promise<void> {
    await this.conn.insertArrowTable(columnarToArrow({
      express_id: store.entities.expressId,
      global_id: Array.from(store.entities.globalId).map(i => store.strings.get(i)),
      name: Array.from(store.entities.name).map(i => store.strings.get(i)),
      type: Array.from(store.entities.typeEnum).map(i => IfcTypeEnumToString(i)),
    }), { name: 'entities' });
    
    await this.conn.insertArrowTable(columnarToArrow({
      entity_id: store.properties.entityId,
      pset_name: Array.from(store.properties.psetName).map(i => store.strings.get(i)),
      prop_name: Array.from(store.properties.propName).map(i => store.strings.get(i)),
      value_real: store.properties.valueReal,
    }), { name: 'properties' });
  }
  
  private async createViews(): Promise<void> {
    await this.conn.query(`CREATE VIEW walls AS SELECT * FROM entities WHERE type IN ('IfcWall', 'IfcWallStandardCase')`);
    await this.conn.query(`CREATE VIEW doors AS SELECT * FROM entities WHERE type = 'IfcDoor'`);
  }
  
  async query(sql: string): Promise<SQLResult> {
    return new SQLResult(await this.conn.query(sql));
  }
}
```

### Example SQL Queries

```sql
-- Walls with fire rating >= 60
SELECT e.express_id, e.name, p.value_real as fire_rating
FROM walls e
JOIN properties p ON p.entity_id = e.express_id
WHERE p.pset_name = 'Pset_WallCommon' AND p.prop_name = 'FireRating' AND p.value_real >= 60;

-- Area by type per storey
SELECT s.name as storey, e.type, SUM(q.value) as total_area
FROM entities e
JOIN entities s ON s.express_id = e.storey_id
JOIN quantities q ON q.entity_id = e.express_id AND q.quantity_name = 'NetArea'
GROUP BY s.name, e.type ORDER BY s.name;

-- Missing properties
SELECT e.express_id, e.name FROM walls e
LEFT JOIN properties p ON p.entity_id = e.express_id AND p.prop_name = 'FireRating'
WHERE p.entity_id IS NULL;
```

---

*Continue to Part 5: Export Formats*

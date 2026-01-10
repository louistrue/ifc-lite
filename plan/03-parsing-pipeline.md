# IFC-Lite: Part 3 - Parsing Pipeline

## 3.1 Parser Architecture Overview

```typescript
/**
 * Main parser class - orchestrates the parsing pipeline.
 */
class IfcParser {
  private tokenizer: StepTokenizer;
  private decoder: EntityDecoder;
  private builders: {
    entities: EntityTableBuilder;
    properties: PropertyTableBuilder;
    quantities: QuantityTableBuilder;
    graph: RelationshipGraphBuilder;
    geometry: GeometryStoreBuilder;
    strings: StringTableImpl;
  };

  /**
   * Parse IFC file into complete data store.
   */
  async parse(
    input: ArrayBuffer | ReadableStream<Uint8Array>,
    options: ParseOptions = {}
  ): Promise<IfcDataStore> {
    const startTime = performance.now();
    
    // Handle streaming vs buffer input
    const buffer = input instanceof ArrayBuffer 
      ? new Uint8Array(input)
      : await this.bufferStream(input);
    
    // Initialize builders
    this.initBuilders(options);
    
    // Phase 1: Scan for entity index (~50ms for 10MB)
    const entityIndex = await this.scan(buffer, options);
    options.onProgress?.({ phase: 'scan', percent: 100 });
    
    // Phase 2: Parallel extraction (~500ms for 10MB)
    const [entities, properties, quantities, graph, geometry] = await Promise.all([
      this.extractEntities(buffer, entityIndex, options),
      this.extractProperties(buffer, entityIndex, options),
      this.extractQuantities(buffer, entityIndex, options),
      this.extractRelationships(buffer, entityIndex, options),
      options.skipGeometry ? null : this.extractGeometry(buffer, entityIndex, options),
    ]);
    
    // Phase 3: Build derived structures (~100ms)
    const spatialIndex = geometry ? BVH.build(geometry) : null;
    const spatialHierarchy = this.buildSpatialHierarchy(entities, graph);
    const typeIndex = this.buildTypeIndex(entities, graph);
    
    const parseTime = performance.now() - startTime;
    
    return {
      source: options.retainSource ? buffer : new Uint8Array(0),
      entityIndex,
      entities,
      properties,
      quantities,
      materials: this.extractMaterials(buffer, entityIndex),
      classifications: this.extractClassifications(buffer, entityIndex),
      strings: this.builders.strings,
      graph,
      geometry,
      spatialIndex,
      spatialHierarchy,
      typeIndex,
      fileSize: buffer.length,
      schemaVersion: this.detectSchema(buffer),
      entityCount: entityIndex.byId.size,
      parseTime,
    };
  }
}

interface ParseOptions {
  // Performance options
  skipGeometry?: boolean;         // Skip geometry extraction (data-only parse)
  skipQuantities?: boolean;       // Skip quantity extraction
  retainSource?: boolean;         // Keep source buffer for lazy parsing
  useWasm?: boolean;              // Use WASM accelerators if available
  
  // Filter options
  includeTypes?: IfcTypeEnum[];   // Only parse these types
  excludeTypes?: IfcTypeEnum[];   // Exclude these types
  
  // Geometry options
  geometryOptions?: {
    curveSegments?: number;       // Segments for curved surfaces (default: 16)
    precision?: number;           // Coordinate precision (default: 6 decimals)
    generateUVs?: boolean;        // Generate texture coordinates
    computeNormals?: boolean;     // Recompute normals (default: true)
  };
  
  // Progress callback
  onProgress?: (progress: ParseProgress) => void;
}

interface ParseProgress {
  phase: 'scan' | 'entities' | 'properties' | 'relationships' | 'geometry' | 'index';
  percent: number;
  entitiesProcessed?: number;
  totalEntities?: number;
  currentType?: string;
}
```

---

## 3.2 Phase 1: Entity Index Scan

```typescript
/**
 * Fast scan to build entity index.
 * Single pass, ~50ms for 10MB.
 */
private async scan(
  buffer: Uint8Array,
  options: ParseOptions
): Promise<EntityIndex> {
  const index: EntityIndex = {
    byId: new Map(),
    byType: new Map(),
    inverseRefs: new Map(),
  };
  
  // Use WASM tokenizer if available for ~3x speedup
  const tokenizer = options.useWasm && WasmStepTokenizer.isAvailable()
    ? new WasmStepTokenizer(buffer)
    : new StepTokenizer(buffer);
  
  let scanned = 0;
  for (const ref of tokenizer.scanEntities()) {
    // Apply type filters
    if (options.includeTypes && !options.includeTypes.includes(ref.typeEnum)) {
      continue;
    }
    if (options.excludeTypes && options.excludeTypes.includes(ref.typeEnum)) {
      continue;
    }
    
    index.byId.set(ref.expressId, ref);
    
    // Build type index
    let typeList = index.byType.get(ref.typeEnum);
    if (!typeList) {
      typeList = [];
      index.byType.set(ref.typeEnum, typeList);
    }
    typeList.push(ref.expressId);
    
    // Progress
    scanned++;
    if (scanned % 10000 === 0) {
      options.onProgress?.({
        phase: 'scan',
        percent: Math.min(95, (tokenizer.position / buffer.length) * 100),
        entitiesProcessed: scanned,
      });
    }
  }
  
  // Build inverse references (quick second pass)
  await this.buildInverseRefs(buffer, index);
  
  return index;
}

/**
 * High-performance STEP tokenizer.
 * Uses Uint8Array directly, minimal string allocation.
 */
class StepTokenizer {
  private buffer: Uint8Array;
  private pos: number = 0;
  private dataStart: number = 0;
  
  // ASCII codes
  private static readonly HASH = 35;        // '#'
  private static readonly SEMICOLON = 59;   // ';'
  private static readonly EQUALS = 61;      // '='
  private static readonly LPAREN = 40;      // '('
  private static readonly NEWLINE = 10;     // '\n'
  private static readonly SPACE = 32;       // ' '
  
  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.findDataSection();
  }
  
  get position(): number {
    return this.pos;
  }
  
  /**
   * Find DATA section start.
   */
  private findDataSection(): void {
    // Look for "DATA;" marker
    const dataMarker = [68, 65, 84, 65, 59]; // "DATA;"
    for (let i = 0; i < this.buffer.length - 5; i++) {
      if (this.buffer[i] === dataMarker[0] &&
          this.buffer[i+1] === dataMarker[1] &&
          this.buffer[i+2] === dataMarker[2] &&
          this.buffer[i+3] === dataMarker[3] &&
          this.buffer[i+4] === dataMarker[4]) {
        this.dataStart = i + 5;
        this.pos = this.dataStart;
        return;
      }
    }
    throw new Error('DATA section not found in IFC file');
  }
  
  /**
   * Scan all entities, yielding EntityRef for each.
   */
  *scanEntities(): Generator<EntityRef> {
    let lineNumber = 1;
    
    while (this.pos < this.buffer.length) {
      // Skip whitespace
      while (this.pos < this.buffer.length && 
             (this.buffer[this.pos] === StepTokenizer.SPACE ||
              this.buffer[this.pos] === StepTokenizer.NEWLINE)) {
        if (this.buffer[this.pos] === StepTokenizer.NEWLINE) lineNumber++;
        this.pos++;
      }
      
      // Check for ENDSEC
      if (this.buffer[this.pos] === 69) { // 'E'
        if (this.matchesEndSec()) break;
      }
      
      // Look for '#'
      if (this.buffer[this.pos] !== StepTokenizer.HASH) {
        this.pos++;
        continue;
      }
      
      const entityStart = this.pos;
      this.pos++; // Skip '#'
      
      // Parse entity ID
      const idStart = this.pos;
      while (this.pos < this.buffer.length &&
             this.buffer[this.pos] >= 48 && this.buffer[this.pos] <= 57) {
        this.pos++;
      }
      const expressId = this.parseIntFast(idStart, this.pos);
      
      // Skip '='
      while (this.pos < this.buffer.length && this.buffer[this.pos] !== StepTokenizer.EQUALS) {
        this.pos++;
      }
      this.pos++;
      
      // Skip whitespace
      while (this.pos < this.buffer.length && this.buffer[this.pos] === StepTokenizer.SPACE) {
        this.pos++;
      }
      
      // Parse type name
      const typeStart = this.pos;
      while (this.pos < this.buffer.length && this.buffer[this.pos] !== StepTokenizer.LPAREN) {
        this.pos++;
      }
      const typeEnum = this.parseTypeEnum(typeStart, this.pos);
      
      // Find end of entity (';')
      let depth = 0;
      while (this.pos < this.buffer.length) {
        const c = this.buffer[this.pos];
        if (c === StepTokenizer.LPAREN) depth++;
        else if (c === 41) depth--; // ')'
        else if (c === StepTokenizer.SEMICOLON && depth === 0) break;
        else if (c === StepTokenizer.NEWLINE) lineNumber++;
        this.pos++;
      }
      this.pos++; // Skip ';'
      
      yield {
        expressId,
        typeEnum,
        byteOffset: entityStart,
        byteLength: this.pos - entityStart,
        lineNumber,
      };
    }
  }
  
  /**
   * Fast integer parsing without string allocation.
   */
  private parseIntFast(start: number, end: number): number {
    let result = 0;
    for (let i = start; i < end; i++) {
      result = result * 10 + (this.buffer[i] - 48);
    }
    return result;
  }
  
  /**
   * Parse type name to enum.
   */
  private parseTypeEnum(start: number, end: number): IfcTypeEnum {
    // Fast path: check length and first few characters
    const len = end - start;
    const first = this.buffer[start];
    
    // Most common types first (frequency-ordered)
    if (len === 7 && first === 73) { // 'I'
      if (this.matchesString(start, 'IFCWALL')) return IfcTypeEnum.IfcWall;
      if (this.matchesString(start, 'IFCSLAB')) return IfcTypeEnum.IfcSlab;
      if (this.matchesString(start, 'IFCDOOR')) return IfcTypeEnum.IfcDoor;
      if (this.matchesString(start, 'IFCBEAM')) return IfcTypeEnum.IfcBeam;
    }
    
    // Fall back to full lookup
    const typeStr = String.fromCharCode(...this.buffer.subarray(start, end));
    return IfcTypeEnumFromString(typeStr);
  }
  
  private matchesString(start: number, str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      if (this.buffer[start + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  }
  
  private matchesEndSec(): boolean {
    return this.matchesString(this.pos, 'ENDSEC');
  }
}
```

---

## 3.3 Phase 2: Data Extraction

### Entity Extraction

```typescript
/**
 * Extract entity metadata into columnar format.
 */
private async extractEntities(
  buffer: Uint8Array,
  index: EntityIndex,
  options: ParseOptions
): Promise<EntityTable> {
  const count = index.byId.size;
  const builder = new EntityTableBuilder(count, this.builders.strings);
  
  // Process in type order for cache efficiency
  const priorityTypes = [
    // Spatial structure first
    IfcTypeEnum.IfcProject,
    IfcTypeEnum.IfcSite,
    IfcTypeEnum.IfcBuilding,
    IfcTypeEnum.IfcBuildingStorey,
    IfcTypeEnum.IfcSpace,
    // Then types (for type resolution)
    IfcTypeEnum.IfcWallType,
    IfcTypeEnum.IfcDoorType,
    IfcTypeEnum.IfcWindowType,
    IfcTypeEnum.IfcSlabType,
    // Then instances
    ...BUILDING_ELEMENT_TYPES,
  ];
  
  let processed = 0;
  
  // Process priority types first
  for (const typeEnum of priorityTypes) {
    const ids = index.byType.get(typeEnum) ?? [];
    for (const id of ids) {
      const ref = index.byId.get(id)!;
      const entity = this.decoder.decodeEntityBasic(buffer, ref);
      builder.add(entity);
      
      processed++;
      if (processed % 5000 === 0) {
        options.onProgress?.({
          phase: 'entities',
          percent: (processed / count) * 100,
          entitiesProcessed: processed,
          totalEntities: count,
        });
      }
    }
  }
  
  // Process remaining types
  for (const [typeEnum, ids] of index.byType) {
    if (priorityTypes.includes(typeEnum)) continue;
    
    for (const id of ids) {
      const ref = index.byId.get(id)!;
      const entity = this.decoder.decodeEntityBasic(buffer, ref);
      builder.add(entity);
      processed++;
    }
  }
  
  return builder.build();
}

/**
 * Entity table builder for efficient columnar construction.
 */
class EntityTableBuilder {
  private count: number = 0;
  private capacity: number;
  private strings: StringTableImpl;
  
  // Pre-allocated arrays
  expressId: Uint32Array;
  typeEnum: Uint16Array;
  globalId: Uint32Array;
  name: Uint32Array;
  description: Uint32Array;
  objectType: Uint32Array;
  flags: Uint8Array;
  containedInStorey: Int32Array;
  definedByType: Int32Array;
  geometryIndex: Int32Array;
  
  // Type ranges (built during construction)
  private typeStarts: Map<IfcTypeEnum, number> = new Map();
  private typeCounts: Map<IfcTypeEnum, number> = new Map();
  
  constructor(capacity: number, strings: StringTableImpl) {
    this.capacity = capacity;
    this.strings = strings;
    
    this.expressId = new Uint32Array(capacity);
    this.typeEnum = new Uint16Array(capacity);
    this.globalId = new Uint32Array(capacity);
    this.name = new Uint32Array(capacity);
    this.description = new Uint32Array(capacity);
    this.objectType = new Uint32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.containedInStorey = new Int32Array(capacity).fill(-1);
    this.definedByType = new Int32Array(capacity).fill(-1);
    this.geometryIndex = new Int32Array(capacity).fill(-1);
  }
  
  add(entity: DecodedEntityBasic): void {
    const i = this.count++;
    
    this.expressId[i] = entity.expressId;
    this.typeEnum[i] = entity.typeEnum;
    this.globalId[i] = this.strings.intern(entity.globalId);
    this.name[i] = this.strings.intern(entity.name ?? '');
    this.description[i] = this.strings.intern(entity.description ?? '');
    this.objectType[i] = this.strings.intern(entity.objectType ?? '');
    
    // Set flags
    let flags = 0;
    if (entity.hasGeometry) flags |= EntityFlags.HAS_GEOMETRY;
    if (entity.isType) flags |= EntityFlags.IS_TYPE;
    this.flags[i] = flags;
    
    // Track type ranges
    const type = entity.typeEnum;
    if (!this.typeStarts.has(type)) {
      this.typeStarts.set(type, i);
      this.typeCounts.set(type, 0);
    }
    this.typeCounts.set(type, this.typeCounts.get(type)! + 1);
  }
  
  build(): EntityTable {
    // Trim arrays to actual size
    const trim = <T extends TypedArray>(arr: T): T => {
      return arr.subarray(0, this.count) as T;
    };
    
    // Build type ranges
    const typeRanges = new Map<IfcTypeEnum, { start: number; end: number }>();
    for (const [type, start] of this.typeStarts) {
      const count = this.typeCounts.get(type)!;
      typeRanges.set(type, { start, end: start + count });
    }
    
    return {
      count: this.count,
      expressId: trim(this.expressId),
      typeEnum: trim(this.typeEnum),
      globalId: trim(this.globalId),
      name: trim(this.name),
      description: trim(this.description),
      objectType: trim(this.objectType),
      flags: trim(this.flags),
      containedInStorey: trim(this.containedInStorey),
      definedByType: trim(this.definedByType),
      geometryIndex: trim(this.geometryIndex),
      typeRanges,
      
      // Methods
      getGlobalId: (id) => this.strings.get(this.globalId[this.indexOfId(id)]),
      getName: (id) => this.strings.get(this.name[this.indexOfId(id)]),
      getTypeName: (id) => IfcTypeEnumToString(this.typeEnum[this.indexOfId(id)]),
      hasGeometry: (id) => (this.flags[this.indexOfId(id)] & EntityFlags.HAS_GEOMETRY) !== 0,
      getByType: (type) => {
        const range = typeRanges.get(type);
        if (!range) return [];
        const ids: number[] = [];
        for (let i = range.start; i < range.end; i++) {
          ids.push(this.expressId[i]);
        }
        return ids;
      },
    };
  }
  
  private indexOfId(expressId: number): number {
    // Binary search since expressIds are sorted within types
    // For now, linear scan (TODO: optimize)
    for (let i = 0; i < this.count; i++) {
      if (this.expressId[i] === expressId) return i;
    }
    return -1;
  }
}
```

### Property Extraction

```typescript
/**
 * Extract properties into columnar format.
 */
private async extractProperties(
  buffer: Uint8Array,
  index: EntityIndex,
  options: ParseOptions
): Promise<PropertyTable> {
  const builder = new PropertyTableBuilder(this.builders.strings);
  
  // Step 1: Get all property sets
  const psetIds = index.byType.get(IfcTypeEnum.IfcPropertySet) ?? [];
  
  // Step 2: Get all IfcRelDefinesByProperties
  const relDefIds = index.byType.get(IfcTypeEnum.IfcRelDefinesByProperties) ?? [];
  
  // Step 3: Build pset → entities mapping
  const psetToEntities = new Map<number, number[]>();
  for (const relId of relDefIds) {
    const ref = index.byId.get(relId)!;
    const rel = this.decoder.decodeRelDefinesByProperties(buffer, ref);
    
    for (const entityId of rel.relatedObjects) {
      const list = psetToEntities.get(rel.relatingPropertyDefinition) ?? [];
      list.push(entityId);
      psetToEntities.set(rel.relatingPropertyDefinition, list);
    }
  }
  
  // Step 4: Extract property values
  let processed = 0;
  for (const psetId of psetIds) {
    const ref = index.byId.get(psetId)!;
    const pset = this.decoder.decodePropertySet(buffer, ref, index);
    const entityIds = psetToEntities.get(psetId) ?? [];
    
    // Add each property for each related entity
    for (const prop of pset.hasProperties) {
      for (const entityId of entityIds) {
        builder.add({
          entityId,
          psetName: pset.name,
          psetGlobalId: pset.globalId,
          propName: prop.name,
          propType: prop.type,
          value: prop.value,
          unitId: prop.unitId,
        });
      }
    }
    
    processed++;
    if (processed % 1000 === 0) {
      options.onProgress?.({
        phase: 'properties',
        percent: (processed / psetIds.length) * 100,
      });
    }
  }
  
  return builder.build();
}

/**
 * Property table builder.
 */
class PropertyTableBuilder {
  private strings: StringTableImpl;
  private rows: PropertyRow[] = [];
  
  constructor(strings: StringTableImpl) {
    this.strings = strings;
  }
  
  add(row: PropertyRow): void {
    this.rows.push(row);
  }
  
  build(): PropertyTable {
    const count = this.rows.length;
    
    // Allocate columnar arrays
    const entityId = new Uint32Array(count);
    const psetName = new Uint32Array(count);
    const psetGlobalId = new Uint32Array(count);
    const propName = new Uint32Array(count);
    const propType = new Uint8Array(count);
    const valueString = new Uint32Array(count);
    const valueReal = new Float64Array(count);
    const valueInt = new Int32Array(count);
    const valueBool = new Uint8Array(count).fill(255); // 255 = null
    const unitId = new Int32Array(count).fill(-1);
    
    // Build indices
    const entityIndex = new Map<number, number[]>();
    const psetIndex = new Map<number, number[]>();
    const propIndex = new Map<number, number[]>();
    
    // Fill arrays
    for (let i = 0; i < count; i++) {
      const row = this.rows[i];
      
      entityId[i] = row.entityId;
      psetName[i] = this.strings.intern(row.psetName);
      psetGlobalId[i] = this.strings.intern(row.psetGlobalId);
      propName[i] = this.strings.intern(row.propName);
      propType[i] = row.propType;
      
      // Store value based on type
      switch (row.propType) {
        case PropertyValueType.String:
        case PropertyValueType.Label:
        case PropertyValueType.Identifier:
        case PropertyValueType.Text:
        case PropertyValueType.Enum:
          valueString[i] = this.strings.intern(row.value as string);
          break;
        case PropertyValueType.Real:
          valueReal[i] = row.value as number;
          break;
        case PropertyValueType.Integer:
          valueInt[i] = row.value as number;
          break;
        case PropertyValueType.Boolean:
        case PropertyValueType.Logical:
          valueBool[i] = row.value === true ? 1 : row.value === false ? 0 : 255;
          break;
        case PropertyValueType.List:
          valueString[i] = this.strings.intern(JSON.stringify(row.value));
          break;
      }
      
      if (row.unitId !== undefined) {
        unitId[i] = row.unitId;
      }
      
      // Build indices
      addToIndex(entityIndex, row.entityId, i);
      addToIndex(psetIndex, psetName[i], i);
      addToIndex(propIndex, propName[i], i);
    }
    
    return {
      count,
      entityId,
      psetName,
      psetGlobalId,
      propName,
      propType,
      valueString,
      valueReal,
      valueInt,
      valueBool,
      unitId,
      entityIndex,
      psetIndex,
      propIndex,
      
      // Methods implemented below
      getForEntity: (id) => this.getForEntityImpl(id, /* ... */),
      getPropertyValue: (id, pset, prop) => this.getPropertyValueImpl(/* ... */),
      findByProperty: (prop, value) => this.findByPropertyImpl(/* ... */),
    };
  }
}

function addToIndex(index: Map<number, number[]>, key: number, value: number): void {
  let list = index.get(key);
  if (!list) {
    list = [];
    index.set(key, list);
  }
  list.push(value);
}
```

### Relationship Extraction

```typescript
/**
 * Extract relationships into graph structure.
 */
private async extractRelationships(
  buffer: Uint8Array,
  index: EntityIndex,
  options: ParseOptions
): Promise<RelationshipGraph> {
  const builder = new RelationshipGraphBuilder();
  
  // Define relationship types to extract
  const relTypes: Array<{ ifcType: IfcTypeEnum; edgeType: RelationshipType }> = [
    { ifcType: IfcTypeEnum.IfcRelContainedInSpatialStructure, edgeType: RelationshipType.ContainsElements },
    { ifcType: IfcTypeEnum.IfcRelAggregates, edgeType: RelationshipType.Aggregates },
    { ifcType: IfcTypeEnum.IfcRelDefinesByProperties, edgeType: RelationshipType.DefinesByProperties },
    { ifcType: IfcTypeEnum.IfcRelDefinesByType, edgeType: RelationshipType.DefinesByType },
    { ifcType: IfcTypeEnum.IfcRelAssociatesMaterial, edgeType: RelationshipType.AssociatesMaterial },
    { ifcType: IfcTypeEnum.IfcRelAssociatesClassification, edgeType: RelationshipType.AssociatesClassification },
    { ifcType: IfcTypeEnum.IfcRelVoidsElement, edgeType: RelationshipType.VoidsElement },
    { ifcType: IfcTypeEnum.IfcRelFillsElement, edgeType: RelationshipType.FillsElement },
    { ifcType: IfcTypeEnum.IfcRelConnectsPathElements, edgeType: RelationshipType.ConnectsPathElements },
    { ifcType: IfcTypeEnum.IfcRelSpaceBoundary, edgeType: RelationshipType.SpaceBoundary },
  ];
  
  for (const { ifcType, edgeType } of relTypes) {
    const ids = index.byType.get(ifcType) ?? [];
    
    for (const id of ids) {
      const ref = index.byId.get(id)!;
      const rel = this.decoder.decodeRelationship(buffer, ref);
      
      // Add edges
      for (const targetId of rel.relatedObjects) {
        builder.addEdge(rel.relatingObject, targetId, edgeType, id);
      }
    }
    
    options.onProgress?.({
      phase: 'relationships',
      percent: (relTypes.indexOf({ ifcType, edgeType }) / relTypes.length) * 100,
    });
  }
  
  return builder.build();
}

/**
 * Relationship graph builder using CSR format.
 */
class RelationshipGraphBuilder {
  private edges: Array<{ source: number; target: number; type: RelationshipType; relId: number }> = [];
  
  addEdge(source: number, target: number, type: RelationshipType, relId: number): void {
    this.edges.push({ source, target, type, relId });
  }
  
  build(): RelationshipGraph {
    // Sort edges by source for CSR format
    const forwardEdges = [...this.edges].sort((a, b) => a.source - b.source);
    const inverseEdges = [...this.edges].sort((a, b) => a.target - b.target);
    
    return {
      forward: this.buildEdges(forwardEdges, 'source', 'target'),
      inverse: this.buildEdges(inverseEdges, 'target', 'source'),
      relationships: this.buildRelationshipTable(),
      
      getRelated: (entityId, relType, direction) => {
        const edges = direction === 'forward' 
          ? this.forward.getEdges(entityId, relType)
          : this.inverse.getEdges(entityId, relType);
        return edges.map(e => e.target);
      },
      
      hasRelationship: (sourceId, targetId, relType) => {
        const edges = this.forward.getEdges(sourceId, relType);
        return edges.some(e => e.target === targetId);
      },
      
      getRelationshipsBetween: (sourceId, targetId) => {
        const edges = this.forward.getEdges(sourceId);
        return edges
          .filter(e => e.target === targetId)
          .map(e => ({
            relationshipId: e.relationshipId,
            type: e.type,
            typeName: RelationshipTypeToString(e.type),
          }));
      },
    };
  }
  
  private buildEdges(
    sortedEdges: typeof this.edges,
    keyField: 'source' | 'target',
    valueField: 'source' | 'target'
  ): RelationshipEdges {
    const offsets = new Map<number, number>();
    const counts = new Map<number, number>();
    
    const edgeTargets = new Uint32Array(sortedEdges.length);
    const edgeTypes = new Uint16Array(sortedEdges.length);
    const edgeRelIds = new Uint32Array(sortedEdges.length);
    
    let currentKey = -1;
    for (let i = 0; i < sortedEdges.length; i++) {
      const edge = sortedEdges[i];
      const key = edge[keyField];
      
      if (key !== currentKey) {
        offsets.set(key, i);
        currentKey = key;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      
      edgeTargets[i] = edge[valueField];
      edgeTypes[i] = edge.type;
      edgeRelIds[i] = edge.relId;
    }
    
    return {
      offsets,
      counts,
      edgeTargets,
      edgeTypes,
      edgeRelIds,
      
      getEdges(entityId: number, type?: RelationshipType): Edge[] {
        const offset = offsets.get(entityId);
        if (offset === undefined) return [];
        
        const count = counts.get(entityId)!;
        const edges: Edge[] = [];
        
        for (let i = offset; i < offset + count; i++) {
          if (type === undefined || edgeTypes[i] === type) {
            edges.push({
              target: edgeTargets[i],
              type: edgeTypes[i],
              relationshipId: edgeRelIds[i],
            });
          }
        }
        
        return edges;
      },
      
      getTargets(entityId: number, type?: RelationshipType): number[] {
        return this.getEdges(entityId, type).map(e => e.target);
      },
      
      hasAnyEdges(entityId: number): boolean {
        return offsets.has(entityId);
      },
    };
  }
}
```

---

## 3.4 Streaming Parser Variant

```typescript
/**
 * Streaming parser for progressive loading.
 * Emits data as it becomes available.
 */
class StreamingIfcParser {
  /**
   * Parse with streaming output.
   */
  async *parse(
    stream: ReadableStream<Uint8Array>,
    options: StreamingParseOptions = {}
  ): AsyncGenerator<ParseEvent> {
    const buffer = new DynamicBuffer();
    const tokenizer = new StreamingStepTokenizer();
    
    // Phase 1: Scan
    yield { type: 'phase', phase: 'scan', message: 'Building entity index...' };
    
    const reader = stream.getReader();
    const entityIndex: EntityIndex = {
      byId: new Map(),
      byType: new Map(),
      inverseRefs: new Map(),
    };
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer.append(value);
      
      for (const ref of tokenizer.feed(value)) {
        entityIndex.byId.set(ref.expressId, ref);
        
        let typeList = entityIndex.byType.get(ref.typeEnum);
        if (!typeList) {
          typeList = [];
          entityIndex.byType.set(ref.typeEnum, typeList);
        }
        typeList.push(ref.expressId);
      }
      
      yield {
        type: 'progress',
        phase: 'scan',
        bytesProcessed: buffer.length,
      };
    }
    
    yield { type: 'index-ready', entityIndex, entityCount: entityIndex.byId.size };
    
    // Phase 2: Stream geometry first (for visual feedback)
    if (!options.skipGeometry) {
      yield { type: 'phase', phase: 'geometry', message: 'Processing geometry...' };
      
      const geometryIds = this.findEntitiesWithGeometry(entityIndex);
      let processed = 0;
      
      for (const entityId of geometryIds) {
        const ref = entityIndex.byId.get(entityId)!;
        
        try {
          const mesh = await this.processGeometry(buffer.data, ref, entityIndex);
          if (mesh) {
            yield { type: 'mesh', expressId: entityId, mesh };
          }
        } catch (e) {
          yield { type: 'warning', message: `Failed to process geometry for #${entityId}: ${e}` };
        }
        
        processed++;
        if (processed % 100 === 0) {
          yield {
            type: 'progress',
            phase: 'geometry',
            entitiesProcessed: processed,
            totalEntities: geometryIds.length,
            percent: (processed / geometryIds.length) * 100,
          };
        }
      }
    }
    
    // Phase 3: Extract properties
    yield { type: 'phase', phase: 'properties', message: 'Extracting properties...' };
    
    const properties = await this.extractPropertiesFromBuffer(buffer.data, entityIndex);
    yield { type: 'properties-ready', properties };
    
    // Phase 4: Build graph
    yield { type: 'phase', phase: 'graph', message: 'Building relationship graph...' };
    
    const graph = await this.extractRelationshipsFromBuffer(buffer.data, entityIndex);
    yield { type: 'graph-ready', graph };
    
    // Complete
    yield { type: 'complete' };
  }
}

type ParseEvent =
  | { type: 'phase'; phase: string; message: string }
  | { type: 'progress'; phase: string; bytesProcessed?: number; entitiesProcessed?: number; totalEntities?: number; percent?: number }
  | { type: 'index-ready'; entityIndex: EntityIndex; entityCount: number }
  | { type: 'mesh'; expressId: number; mesh: ColumnarMesh }
  | { type: 'instance'; prototypeId: number; expressId: number; transform: Float32Array }
  | { type: 'properties-ready'; properties: PropertyTable }
  | { type: 'graph-ready'; graph: RelationshipGraph }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'complete' };

/**
 * Usage example:
 */
async function loadWithStreaming(url: string) {
  const response = await fetch(url);
  const parser = new StreamingIfcParser();
  
  for await (const event of parser.parse(response.body!)) {
    switch (event.type) {
      case 'mesh':
        // Add to scene immediately
        renderer.addMesh(event.expressId, event.mesh);
        break;
        
      case 'progress':
        updateProgressBar(event.percent ?? 0);
        break;
        
      case 'properties-ready':
        // Properties now available for queries
        dataStore.setProperties(event.properties);
        break;
        
      case 'complete':
        console.log('Loading complete');
        break;
    }
  }
}
```

---

## Related Specifications

For additional details on critical parsing challenges, see:

- **[Part 8: Critical Solutions](08-critical-solutions.md)** - Error handling, streaming dependencies, unit conversion
- **[Part 9: Geometry Pipeline Details](09-geometry-pipeline-details.md)** - Profile processing, curve discretization

---

*Continue to Part 4: Query System*

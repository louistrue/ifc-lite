# IFC-Lite: Part 7 - API Reference

## 7.1 Quick Reference

### Installation

```bash
npm install @ifc-lite/core @ifc-lite/parser @ifc-lite/geometry @ifc-lite/query
```

### Basic Usage

```typescript
import { IfcParser, IfcQuery } from '@ifc-lite/core';

// Parse IFC file
const parser = new IfcParser();
const store = await parser.parse(arrayBuffer);

// Query model
const model = new IfcQuery(store);
const walls = await model.walls().execute();
```

---

## 7.2 Core Classes

### IfcParser

```typescript
class IfcParser {
  // Parse complete IFC file
  parse(input: ArrayBuffer | ReadableStream<Uint8Array>, options?: ParseOptions): Promise<IfcDataStore>;
  
  // Scan only (build index, no data extraction)
  scan(buffer: Uint8Array): Promise<EntityIndex>;
  
  // Get single entity on demand
  getEntity<T>(id: number): T;
}

interface ParseOptions {
  skipGeometry?: boolean;      // Skip geometry extraction
  skipQuantities?: boolean;    // Skip quantity extraction
  retainSource?: boolean;      // Keep source for lazy parsing
  useWasm?: boolean;           // Use WASM accelerators
  onProgress?: (p: ParseProgress) => void;
}
```

### IfcQuery

```typescript
class IfcQuery {
  constructor(store: IfcDataStore);
  
  // Fluent API shortcuts
  walls(): EntityQuery;
  doors(): EntityQuery;
  windows(): EntityQuery;
  slabs(): EntityQuery;
  columns(): EntityQuery;
  beams(): EntityQuery;
  spaces(): EntityQuery;
  
  // Generic type query
  ofType(...types: string[]): EntityQuery;
  all(): EntityQuery;
  byId(expressId: number): EntityQuery;
  byIds(expressIds: number[]): EntityQuery;
  
  // SQL
  sql(query: string): Promise<SQLResult>;
  sqlArrow(query: string): Promise<ArrowTable>;
  
  // Graph
  entity(expressId: number): EntityNode;
  entities(expressIds: number[]): EntityNodeSet;
  
  // Spatial
  inBounds(aabb: AABB): EntityQuery;
  onStorey(storeyId: number): EntityQuery;
  raycast(origin: Vec3, direction: Vec3): RaycastHit[];
  
  // Shortcuts
  readonly hierarchy: SpatialHierarchy;
  readonly project: EntityNode;
  readonly buildings: EntityNode[];
  readonly storeys: EntityNode[];
}
```

### EntityQuery

```typescript
class EntityQuery {
  // Filtering
  where(predicate: (e: EntityAccessor) => boolean): this;
  whereProperty(psetName: string, propName: string, op: ComparisonOperator, value: PropertyValue): this;
  whereQuantity(qsetName: string, quantName: string, op: ComparisonOperator, value: number): this;
  whereName(pattern: string | RegExp): this;
  withGeometryOnly(): this;
  onStorey(storeyId: number): this;
  inBounds(aabb: AABB): this;
  
  // Includes
  includeGeometry(): this;
  includeProperties(): this;
  includeQuantities(): this;
  includeMaterials(): this;
  includeType(): this;
  includeContainer(): this;
  includeAll(): this;
  
  // Pagination
  limit(count: number): this;
  offset(count: number): this;
  page(pageNumber: number, pageSize: number): this;
  sortBy(field: SortField, order?: 'asc' | 'desc'): this;
  
  // Execution
  execute(): Promise<QueryResultEntity[]>;
  ids(): Promise<number[]>;
  count(): Promise<number>;
  exists(): Promise<boolean>;
  first(): Promise<QueryResultEntity | null>;
  
  // Export
  toArrow(): Promise<ArrowTable>;
  toParquet(): Promise<Uint8Array>;
  toJSON(): Promise<object[]>;
  toCSV(): Promise<string>;
  
  // Geometry
  geometry(): Promise<CombinedGeometry>;
  bounds(): Promise<AABB>;
}

type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'matches';
```

### EntityNode

```typescript
class EntityNode {
  readonly expressId: number;
  readonly globalId: string;
  readonly name: string;
  readonly type: string;
  readonly hasGeometry: boolean;
  
  // Relationships
  contains(): EntityNode[];
  containedIn(): EntityNode | null;
  decomposes(): EntityNode[];
  decomposedBy(): EntityNode | null;
  materials(): EntityNode[];
  definingType(): EntityNode | null;
  instances(): EntityNode[];
  propertySets(): EntityNode[];
  voids(): EntityNode[];
  filledBy(): EntityNode[];
  
  // Multi-hop
  traverse(relType: RelationshipType | RelationshipType[], depth: number, direction?: 'forward' | 'inverse' | 'both'): EntityNode[];
  pathTo(targetId: number): EntityNode[] | null;
  
  // Spatial
  building(): EntityNode | null;
  storey(): EntityNode | null;
  space(): EntityNode | null;
  siblings(): EntityNode[];
  
  // Data
  properties(): PropertySet[];
  property(psetName: string, propName: string): PropertyValue | null;
  quantities(): QuantitySet[];
  quantity(qsetName: string, quantName: string): number | null;
  geometry(): ColumnarMesh | null;
  bounds(): AABB | null;
  
  toResult(): QueryResultEntity;
}
```

---

## 7.3 Data Structures

### IfcDataStore

```typescript
interface IfcDataStore {
  readonly fileSize: number;
  readonly schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  readonly entityCount: number;
  readonly parseTime: number;
  
  readonly source: Uint8Array;
  readonly entityIndex: EntityIndex;
  readonly entities: EntityTable;
  readonly properties: PropertyTable;
  readonly quantities: QuantityTable;
  readonly strings: StringTable;
  readonly graph: RelationshipGraph;
  readonly geometry: GeometryStore;
  readonly spatialIndex: BVH;
  readonly spatialHierarchy: SpatialHierarchy;
  readonly typeIndex: TypeIndex;
}
```

### Geometry Types

```typescript
interface ColumnarMesh {
  expressId: number;
  positions: Float32Array;   // [x,y,z, x,y,z, ...]
  normals: Float32Array;     // [nx,ny,nz, ...]
  indices: Uint32Array;      // Triangle indices
  uvs?: Float32Array;
  bounds: AABB;
  materialIndex: number;
}

interface CombinedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  ranges: MeshRange[];
  bounds: AABB;
}

interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}
```

### Property Types

```typescript
interface PropertySet {
  name: string;
  globalId: string;
  properties: Property[];
}

interface Property {
  name: string;
  type: PropertyValueType;
  value: PropertyValue;
  unit?: string;
}

type PropertyValue = string | number | boolean | null | PropertyValue[];

interface QuantitySet {
  name: string;
  quantities: Quantity[];
}

interface Quantity {
  name: string;
  type: QuantityType;
  value: number;
  unit?: string;
}
```

---

## 7.4 Export Classes

### ParquetExporter

```typescript
class ParquetExporter {
  constructor(store: IfcDataStore);
  
  // Export full .bos archive
  exportBOS(): Promise<Uint8Array>;
  
  // Export individual tables
  exportTable(tableName: string): Promise<Uint8Array>;
}
```

### GLTFExporter

```typescript
class GLTFExporter {
  constructor(store: IfcDataStore);
  
  // Export to binary GLB
  exportGLB(options?: GLTFExportOptions): Promise<Uint8Array>;
  
  // Export to JSON + bin
  exportGLTF(options?: GLTFExportOptions): Promise<{ json: string; bin: Uint8Array }>;
}

interface GLTFExportOptions {
  useInstancing?: boolean;
  useDraco?: boolean;
  includeMetadata?: boolean;
}
```

### CSVExporter

```typescript
class CSVExporter {
  static exportEntities(results: QueryResultEntity[]): string;
  static exportProperties(results: QueryResultEntity[], psetName?: string): string;
  static exportQuantities(results: QueryResultEntity[]): string;
}
```

---

## 7.5 Streaming API

```typescript
class StreamingIfcParser {
  parse(stream: ReadableStream<Uint8Array>, options?: StreamingParseOptions): AsyncGenerator<ParseEvent>;
}

type ParseEvent =
  | { type: 'phase'; phase: string; message: string }
  | { type: 'progress'; phase: string; percent?: number }
  | { type: 'index-ready'; entityIndex: EntityIndex; entityCount: number }
  | { type: 'mesh'; expressId: number; mesh: ColumnarMesh }
  | { type: 'properties-ready'; properties: PropertyTable }
  | { type: 'graph-ready'; graph: RelationshipGraph }
  | { type: 'complete' };

// Usage
const parser = new StreamingIfcParser();
for await (const event of parser.parse(response.body!)) {
  if (event.type === 'mesh') {
    renderer.addMesh(event.expressId, event.mesh);
  }
}
```

---

## 7.6 Type Enumerations

### IfcTypeEnum (subset)

```typescript
const enum IfcTypeEnum {
  IfcProject = 1,
  IfcSite = 2,
  IfcBuilding = 3,
  IfcBuildingStorey = 4,
  IfcSpace = 5,
  IfcWall = 10,
  IfcWallStandardCase = 11,
  IfcDoor = 12,
  IfcWindow = 13,
  IfcSlab = 14,
  IfcColumn = 15,
  IfcBeam = 16,
  // ... 800+ types
}
```

### RelationshipType

```typescript
const enum RelationshipType {
  ContainsElements = 1,
  Aggregates = 2,
  DefinesByProperties = 10,
  DefinesByType = 11,
  AssociatesMaterial = 20,
  AssociatesClassification = 30,
  VoidsElement = 42,
  FillsElement = 41,
  // ... more
}
```

### PropertyValueType

```typescript
const enum PropertyValueType {
  String = 0,
  Real = 1,
  Integer = 2,
  Boolean = 3,
  Logical = 4,
  Label = 5,
  Identifier = 6,
  Text = 7,
  Enum = 8,
  Reference = 9,
  List = 10,
}
```

---

## 7.7 Common Patterns

### Load and Query

```typescript
import { IfcParser, IfcQuery } from '@ifc-lite/core';

async function analyzeModel(file: File) {
  const buffer = await file.arrayBuffer();
  const parser = new IfcParser();
  const store = await parser.parse(buffer);
  const model = new IfcQuery(store);
  
  // Find all external walls with fire rating
  const externalFireWalls = await model.walls()
    .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
    .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)
    .includeProperties()
    .execute();
  
  console.log(`Found ${externalFireWalls.length} fire-rated external walls`);
  
  return externalFireWalls;
}
```

### Export to Multiple Formats

```typescript
import { ParquetExporter, GLTFExporter, CSVExporter } from '@ifc-lite/export';

async function exportModel(store: IfcDataStore) {
  // Parquet for analytics
  const parquet = new ParquetExporter(store);
  const bos = await parquet.exportBOS();
  saveFile('model.bos', bos);
  
  // glTF for visualization
  const gltf = new GLTFExporter(store);
  const glb = await gltf.exportGLB();
  saveFile('model.glb', glb);
  
  // CSV for spreadsheets
  const model = new IfcQuery(store);
  const doors = await model.doors().includeProperties().execute();
  const csv = CSVExporter.exportProperties(doors, 'Pset_DoorCommon');
  saveFile('doors.csv', csv);
}
```

### Progressive Loading

```typescript
async function loadWithProgress(url: string, onProgress: (p: number) => void) {
  const response = await fetch(url);
  const parser = new StreamingIfcParser();
  
  const meshes: ColumnarMesh[] = [];
  
  for await (const event of parser.parse(response.body!)) {
    switch (event.type) {
      case 'progress':
        onProgress(event.percent ?? 0);
        break;
      case 'mesh':
        meshes.push(event.mesh);
        // Render immediately
        renderer.addMesh(event.mesh);
        break;
      case 'complete':
        console.log(`Loaded ${meshes.length} meshes`);
        break;
    }
  }
}
```

### SQL Analytics

```typescript
async function generateReport(model: IfcQuery) {
  // Element count by type
  const typeCounts = await model.sql(`
    SELECT type, COUNT(*) as count
    FROM entities
    WHERE has_geometry = true
    GROUP BY type
    ORDER BY count DESC
  `);
  
  // Total area by storey
  const areaByStorey = await model.sql(`
    SELECT 
      h.storey_name,
      SUM(q.value) as total_area
    FROM quantities q
    JOIN spatial_hierarchy h ON h.element_id = q.entity_id
    WHERE q.quantity_name = 'NetArea'
    GROUP BY h.storey_name
    ORDER BY h.storey_name
  `);
  
  return { typeCounts, areaByStorey };
}
```

---

## 7.8 Bundle Imports

### Full Bundle

```typescript
// Everything
import { IfcParser, IfcQuery, ParquetExporter, GLTFExporter } from '@ifc-lite/core';
```

### Minimal Bundle

```typescript
// Parser only (~25KB)
import { IfcParser } from '@ifc-lite/parser';

// Add geometry (~35KB)
import { GeometryProcessor } from '@ifc-lite/geometry';

// Add queries (~30KB)
import { IfcQuery } from '@ifc-lite/query';
```

### Optional Features

```typescript
// CSG operations (~300KB, lazy loaded)
const { ManifoldCSG } = await import('@ifc-lite/csg');

// DuckDB SQL (~4MB, lazy loaded)
const { DuckDBIntegration } = await import('@ifc-lite/integrations/duckdb');

// WASM accelerators (~80KB)
const { WasmParser } = await import('@ifc-lite/wasm');
```

---

*End of IFC-Lite Technical Specification*

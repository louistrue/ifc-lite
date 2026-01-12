# TypeScript API Reference

Complete API documentation for the TypeScript packages.

## @ifc-lite/parser

### IfcParser

Main class for parsing IFC files.

```typescript
class IfcParser {
  constructor(options?: ParserOptions);

  // Parse from ArrayBuffer
  parse(buffer: ArrayBuffer, options?: ParseOptions): Promise<ParseResult>;

  // Stream parse for large files
  parseStreaming(buffer: ArrayBuffer, options?: StreamOptions): Promise<ParseResult>;

  // Get parser version
  readonly version: string;
}
```

#### ParserOptions

```typescript
interface ParserOptions {
  // Use WASM parser (default: true if available)
  useWasm?: boolean;

  // Worker configuration
  useWorker?: boolean;
  workerUrl?: string;
}
```

#### ParseOptions

```typescript
interface ParseOptions {
  // Progress callback
  onProgress?: (progress: Progress) => void;

  // Geometry quality: 'FAST' | 'BALANCED' | 'HIGH'
  geometryQuality?: GeometryQuality;

  // Skip geometry processing
  skipGeometry?: boolean;

  // Auto-shift large coordinates
  autoOriginShift?: boolean;

  // Custom origin point
  customOrigin?: Vector3;

  // Memory limit in MB
  memoryLimit?: number;

  // Entity type filters
  includeTypes?: string[];
  excludeTypes?: string[];
}
```

#### StreamOptions

```typescript
interface StreamOptions extends ParseOptions {
  // Entities per batch
  batchSize?: number;

  // Batch callback
  onBatch?: (batch: EntityBatch) => Promise<void>;

  // Error handler (for non-fatal errors)
  onError?: (error: ParseError) => void;
}
```

### ParseResult

Result object returned from parsing.

```typescript
interface ParseResult {
  // File metadata
  readonly header: IfcHeader;
  readonly schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';

  // Entity data
  readonly entities: Entity[];
  readonly entityCount: number;

  // Geometry data
  readonly geometry: GeometryResult;

  // Relationships
  readonly relationships: RelationshipGraph;

  // Coordinate info
  readonly coordinateShift?: Vector3;

  // Helper methods
  getEntity(expressId: number): Entity | undefined;
  getProperties(expressId: number): PropertyMap;
  getPropertySets(expressId: number): PropertySetMap;
  getQuantities(expressId: number): QuantityMap;
  getRelated(expressId: number, relType: string): Entity[];
}
```

### Entity

```typescript
interface Entity {
  readonly expressId: number;
  readonly type: string;
  readonly globalId: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly hasGeometry: boolean;
}
```

---

## @ifc-lite/geometry

### IfcLiteBridge

Bridge to the Rust/WASM geometry processor.

```typescript
class IfcLiteBridge {
  // Initialize WASM module
  static init(wasmUrl?: string): Promise<IfcLiteBridge>;

  // Process geometry
  processGeometry(
    entities: Entity[],
    options?: GeometryOptions
  ): Promise<GeometryResult>;

  // Get mesh for entity
  getMesh(expressId: number): Mesh | undefined;

  // Dispose resources
  dispose(): void;
}
```

#### GeometryOptions

```typescript
interface GeometryOptions {
  quality?: 'FAST' | 'BALANCED' | 'HIGH';
  autoOriginShift?: boolean;
  customOrigin?: Vector3;
}
```

### GeometryResult

```typescript
interface GeometryResult {
  readonly meshes: Mesh[];
  readonly bounds: BoundingBox;
  readonly triangleCount: number;
  readonly vertexCount: number;

  getMesh(expressId: number): Mesh | undefined;
  getStatistics(): GeometryStats;
}
```

### Mesh

```typescript
interface Mesh {
  readonly expressId: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly uvs?: Float32Array;
  readonly color: [number, number, number, number];
  readonly transform: Matrix4;
  readonly bounds: BoundingBox;
}
```

---

## @ifc-lite/renderer

### Renderer

WebGPU-based 3D renderer.

```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement, options?: RendererOptions);

  // Initialize WebGPU
  init(): Promise<void>;

  // Load geometry
  loadGeometry(geometry: GeometryResult): Promise<void>;
  addMesh(mesh: Mesh): Promise<void>;
  addMeshes(meshes: Mesh[]): Promise<void>;

  // Rendering
  render(): void;
  startRenderLoop(): void;
  stopRenderLoop(): void;

  // Camera controls
  setCamera(options: CameraOptions): void;
  fitToView(): void;
  fitToEntities(expressIds: number[]): void;
  setViewPreset(preset: ViewPreset): void;
  animateTo(options: AnimateOptions): Promise<void>;

  // Selection
  pick(x: number, y: number): Promise<PickResult | null>;
  select(expressIds: number | number[]): void;
  clearSelection(): void;
  getSelection(): number[];

  // Visibility
  hide(expressIds: number[]): void;
  show(expressIds: number[]): void;
  isolate(expressIds: number[]): void;
  showAll(): void;
  hideByType(type: string): void;

  // Section planes
  addSectionPlane(options: SectionPlaneOptions): SectionPlane;
  updateSectionPlane(id: string, options: Partial<SectionPlaneOptions>): void;
  removeSectionPlane(id: string): void;

  // Colors
  setColor(expressId: number, color: Color): void;
  setColorByType(type: string, color: Color): void;
  resetColors(): void;

  // Statistics
  getStats(): RenderStats;

  // Cleanup
  dispose(): void;
}
```

#### RendererOptions

```typescript
interface RendererOptions {
  antialias?: boolean;
  sampleCount?: 1 | 4;
  backgroundColor?: Color;
  powerPreference?: 'low-power' | 'high-performance';
  enablePicking?: boolean;
  enableShadows?: boolean;
  enableSectionPlanes?: boolean;
}
```

#### CameraOptions

```typescript
interface CameraOptions {
  position?: Vector3;
  target?: Vector3;
  up?: Vector3;
  fov?: number;
  near?: number;
  far?: number;
  orbitSpeed?: number;
  panSpeed?: number;
  zoomSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
}
```

#### ViewPreset

```typescript
type ViewPreset =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'iso'
  | 'iso-back';
```

---

## @ifc-lite/query

### IfcQuery

Fluent query builder.

```typescript
class IfcQuery {
  constructor(parseResult: ParseResult);

  // Enable SQL queries
  enableSQL(): Promise<void>;

  // Type shortcuts
  walls(): IfcQuery;
  doors(): IfcQuery;
  windows(): IfcQuery;
  slabs(): IfcQuery;
  roofs(): IfcQuery;
  columns(): IfcQuery;
  beams(): IfcQuery;
  spaces(): IfcQuery;
  storeys(): IfcQuery;
  all(): IfcQuery;

  // Type filter
  ofType(type: string): IfcQuery;
  ofTypes(types: string[]): IfcQuery;

  // Property filters
  whereProperty(
    psetName: string,
    propName: string,
    operator: Operator,
    value: any
  ): IfcQuery;

  whereQuantity(
    name: string,
    operator: Operator,
    value: number
  ): IfcQuery;

  // Spatial queries
  storey(name: string): IfcQuery;
  building(name: string): IfcQuery;
  contains(): IfcQuery;
  containedIn(): IfcQuery;
  allContained(): IfcQuery;

  // Entity navigation
  entity(expressId: number): EntityQuery;

  // Selection
  select(fields: string[]): IfcQuery;

  // Output
  toArray(): Entity[];
  first(): Entity | undefined;
  count(): number;

  // SQL
  sql(query: string): Promise<any[]>;
}

type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN';
```

### EntityQuery

Query operations on a single entity.

```typescript
class EntityQuery {
  // Relationships
  contains(): IfcQuery;
  containedIn(): EntityQuery;
  materials(): IfcQuery;
  propertySets(): PropertySet[];
  related(relType: string): IfcQuery;

  // Navigation
  storey(): EntityQuery;
  building(): EntityQuery;
  site(): EntityQuery;

  // Output
  entity(): Entity;
}
```

---

## @ifc-lite/data

### EntityTable

Columnar entity storage.

```typescript
class EntityTable {
  readonly count: number;
  readonly expressIds: Uint32Array;
  readonly typeEnums: Uint16Array;
  readonly globalIdIndices: Uint32Array;
  readonly nameIndices: Uint32Array;
  readonly flags: Uint8Array;

  get(index: number): EntityRow;
  findByExpressId(id: number): number;
  filter(predicate: (row: EntityRow) => boolean): number[];
}
```

### StringTable

Deduplicated string storage.

```typescript
class StringTable {
  readonly count: number;

  get(index: number): string;
  intern(value: string): number;
  has(value: string): boolean;
}
```

### RelationshipGraph

CSR-format graph for relationships.

```typescript
class RelationshipGraph {
  // Get related entities
  getRelated(expressId: number, relType?: string): number[];

  // Get container
  getContainer(expressId: number): number | null;

  // Get contained elements
  getContained(expressId: number): number[];

  // Get all descendants
  getAllContained(expressId: number): number[];

  // Build spatial hierarchy
  getSpatialHierarchy(): HierarchyNode;
}
```

---

## @ifc-lite/export

### GltfExporter

```typescript
class GltfExporter {
  export(
    parseResult: ParseResult,
    options?: GltfExportOptions
  ): Promise<GltfResult>;
}

interface GltfExportOptions {
  format: 'gltf' | 'glb';
  includeProperties?: boolean;
  embedImages?: boolean;
  useDraco?: boolean;
  yUp?: boolean;
  entityFilter?: (entity: Entity) => boolean;
}
```

### ParquetExporter

```typescript
class ParquetExporter {
  exportEntities(parseResult: ParseResult): Promise<Uint8Array>;
  exportProperties(parseResult: ParseResult): Promise<Uint8Array>;
  exportQuantities(parseResult: ParseResult): Promise<Uint8Array>;
  exportAll(parseResult: ParseResult): Promise<ParquetBundle>;
}
```

### CsvExporter

```typescript
class CsvExporter {
  exportEntities(
    parseResult: ParseResult,
    options?: CsvOptions
  ): Promise<string>;

  exportPropertiesPivot(
    parseResult: ParseResult,
    options?: PivotOptions
  ): Promise<string>;
}
```

---

## Common Types

### Vector3

```typescript
interface Vector3 {
  x: number;
  y: number;
  z: number;
}
```

### Color

```typescript
type Color = [number, number, number, number]; // RGBA, 0-1
```

### BoundingBox

```typescript
interface BoundingBox {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: Vector3;
}
```

### Matrix4

```typescript
type Matrix4 = Float32Array; // 16 elements, column-major
```

### Progress

```typescript
interface Progress {
  percent: number;
  entitiesProcessed?: number;
  totalEntities?: number;
  stage?: string;
}
```

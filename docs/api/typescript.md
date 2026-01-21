# TypeScript API Reference

Complete API documentation for the TypeScript packages.

## @ifc-lite/parser

### IfcParser

Main class for parsing IFC files.

```typescript
class IfcParser {
  constructor(options?: ParserOptions);

  // Parse from ArrayBuffer (returns entities as objects)
  parse(buffer: ArrayBuffer, options?: ParseOptions): Promise<ParseResult>;

  // Columnar parse (returns IfcDataStore - recommended)
  parseColumnar(buffer: ArrayBuffer, options?: ParseOptions): Promise<IfcDataStore>;
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

### parseAuto

Standalone function that auto-detects parser based on environment.

```typescript
import { parseAuto } from '@ifc-lite/parser';

// Auto-selects best parser for current environment
const store = await parseAuto(buffer);
```

### ParseResult

Result object returned from `parse()` method.

```typescript
interface ParseResult {
  // Entity data as Map
  readonly entities: Map<number, any>;
  readonly entityCount: number;

  // Property sets
  readonly propertySets: Map<number, any>;

  // Relationships
  readonly relationships: any[];

  // Entity index
  readonly entityIndex: EntityIndex;

  // File info
  readonly fileSize: number;
}
```

### IfcDataStore

Result object returned from `parseColumnar()` method (recommended).

```typescript
interface IfcDataStore {
  // Entity index for fast lookups
  readonly entityIndex: EntityIndex;

  // Schema version: 'IFC2X3' | 'IFC4' | 'IFC4X3'
  readonly schemaVersion: string;

  // Statistics
  readonly entityCount: number;
  readonly parseTime: number;

  // Length unit scale (e.g., 0.001 for mm files)
  readonly lengthUnitScale: number;

  // Spatial hierarchy
  readonly spatialHierarchy: SpatialHierarchy;
}

interface EntityIndex {
  // Lookup by expressId
  byId: Map<number, EntityRef>;

  // Lookup by type (e.g., 'IFCWALL' -> [expressId1, expressId2, ...])
  byType: Map<string, number[]>;
}
```

### On-Demand Property Extraction

Properties are extracted lazily for memory efficiency.

```typescript
import { 
  extractPropertiesOnDemand, 
  extractQuantitiesOnDemand,
  extractEntityAttributesOnDemand 
} from '@ifc-lite/parser';

// Extract properties for a single entity
const props = extractPropertiesOnDemand(store, expressId, buffer);
// Returns: { 'Pset_WallCommon': { LoadBearing: true, ... }, ... }

// Extract quantities for a single entity
const quantities = extractQuantitiesOnDemand(store, expressId, buffer);
// Returns: { Volume: { value: 1.5, unit: 'm³' }, ... }

// Extract entity attributes
const attrs = extractEntityAttributesOnDemand(store, expressId, buffer);
// Returns: { Name: 'Wall 1', GlobalId: '...' }
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

### GeometryProcessor

Main class for extracting geometry from IFC files.

```typescript
class GeometryProcessor {
  constructor();

  // Initialize WASM (required before processing)
  init(): Promise<void>;

  // Check if initialized
  isInitialized(): boolean;

  // Process IFC buffer and extract geometry
  process(buffer: Uint8Array): Promise<GeometryResult>;

  // Stream geometry for large files
  processStreaming(
    buffer: Uint8Array,
    entityIndex?: Map<number, any>,
    batchSize?: number
  ): AsyncGenerator<StreamEvent>;

  // Coordinate handling
  getCoordinateInfo(): CoordinateInfo | null;
}
```

#### StreamEvent

```typescript
type StreamEvent =
  | { type: 'start' }
  | { type: 'batch'; meshes: MeshData[]; progress: number }
  | { type: 'complete'; totalMeshes: number; coordinateInfo: CoordinateInfo };
```

### GeometryResult

```typescript
interface GeometryResult {
  readonly meshes: MeshData[];
  readonly coordinateInfo?: CoordinateInfo;
}

interface CoordinateInfo {
  shift?: { x: number; y: number; z: number };
  bounds: BoundingBox;
}
```

### MeshData

Raw geometry data (Float32Arrays, not GPU buffers).

```typescript
interface MeshData {
  readonly expressId: number;
  readonly positions: Float32Array;  // [x, y, z, x, y, z, ...]
  readonly normals: Float32Array;    // [nx, ny, nz, ...]
  readonly indices: Uint32Array;     // Triangle indices
  readonly color: [number, number, number, number];  // RGBA (0-1)
}
```

---

## @ifc-lite/spatial

Spatial indexing utilities for efficient geometry queries and frustum culling.

### buildSpatialIndex

Builds a BVH (Bounding Volume Hierarchy) spatial index from geometry meshes.

```typescript
import { buildSpatialIndex } from '@ifc-lite/spatial';
import type { MeshData } from '@ifc-lite/geometry';

function buildSpatialIndex(meshes: MeshData[]): SpatialIndex;
```

**Parameters:**
- `meshes: MeshData[]` - Array of mesh data objects from `GeometryProcessor.process()`

**Returns:**
- `SpatialIndex` - BVH spatial index implementing the SpatialIndex interface

**Example:**

```typescript
import { GeometryProcessor } from '@ifc-lite/geometry';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import { Renderer } from '@ifc-lite/renderer';

const geometry = new GeometryProcessor();
await geometry.init();
const result = await geometry.process(new Uint8Array(buffer));

// Build spatial index for frustum culling
const spatialIndex = buildSpatialIndex(result.meshes);

const renderer = new Renderer(canvas);
await renderer.init();
renderer.loadGeometry(result);

// Render with frustum culling
renderer.render({
  enableFrustumCulling: true,
  spatialIndex
});
```

### SpatialIndex

Interface for spatial queries.

```typescript
interface SpatialIndex {
  /**
   * Query AABB - returns expressIds of meshes intersecting bounds
   */
  queryAABB(bounds: AABB): number[];

  /**
   * Raycast - returns expressIds of meshes hit by ray
   */
  raycast(origin: [number, number, number], direction: [number, number, number]): number[];

  /**
   * Query frustum - returns expressIds of meshes visible in frustum
   */
  queryFrustum(frustum: Frustum): number[];
}
```

### Types

```typescript
interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

interface Frustum {
  planes: Plane[];
}

interface Plane {
  normal: [number, number, number];
  distance: number;
}
```

---

## @ifc-lite/renderer

### Renderer

WebGPU-based 3D renderer.

```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement);

  // Initialize WebGPU
  init(): Promise<void>;

  // Load geometry (main entry point for IFC geometry)
  loadGeometry(geometry: GeometryResult | MeshData[]): void;
  
  // Add meshes incrementally (for streaming)
  addMeshes(meshes: MeshData[], isStreaming?: boolean): void;

  // Rendering
  render(options?: RenderOptions): void;

  // Camera controls
  fitToView(): void;
  getCamera(): Camera;

  // Selection (GPU picking)
  pick(x: number, y: number, options?: PickOptions): Promise<number | null>;

  // Visibility (pass to render() options)
  // hiddenIds?: Set<number>;
  // isolatedIds?: Set<number> | null;

  // Scene access
  getScene(): Scene;
  getPipeline(): RenderPipeline | null;
  getGPUDevice(): GPUDevice | null;
  isReady(): boolean;

  // Resize handling
  resize(width: number, height: number): void;
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

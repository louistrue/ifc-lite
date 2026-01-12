# IFC-Lite: Part 2 - Core Data Structures

## 2.1 Hybrid Data Store

```typescript
/**
 * Central data store combining multiple access patterns.
 * Optimized for different query types while sharing underlying data.
 */
interface IfcDataStore {
  // === METADATA ===
  readonly fileSize: number;
  readonly schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  readonly entityCount: number;
  readonly parseTime: number;

  // === LAYER 1: RAW ACCESS ===
  readonly source: Uint8Array;
  readonly entityIndex: EntityIndex;

  // === LAYER 2: COLUMNAR TABLES ===
  readonly entities: EntityTable;
  readonly properties: PropertyTable;
  readonly quantities: QuantityTable;
  readonly materials: MaterialTable;
  readonly classifications: ClassificationTable;
  readonly strings: StringTable;

  // === LAYER 3: RELATIONSHIP GRAPH ===
  readonly graph: RelationshipGraph;

  // === LAYER 4: GEOMETRY ===
  readonly geometry: GeometryStore;
  readonly spatialIndex: BVH;

  // === LAYER 5: DERIVED INDICES ===
  readonly spatialHierarchy: SpatialHierarchy;
  readonly typeIndex: TypeIndex;
}
```

---

## 2.2 Entity Index (Layer 1)

```typescript
/**
 * Lightweight index for O(1) entity lookup.
 * Built during initial scan, enables lazy parsing.
 */
interface EntityIndex {
  // Fast lookup by EXPRESS ID
  byId: Map<number, EntityRef>;
  
  // Fast iteration by type
  byType: Map<IfcTypeEnum, number[]>;
  
  // Inverse references (who points to this entity?)
  inverseRefs: Map<number, InverseRef[]>;
}

interface EntityRef {
  expressId: number;
  typeEnum: IfcTypeEnum;       // Numeric enum for fast comparison
  byteOffset: number;          // Position in source buffer
  byteLength: number;          // Length of entity text
  lineNumber: number;          // For error reporting
}

interface InverseRef {
  sourceId: number;            // Entity that references this one
  attributeIndex: number;      // Which attribute contains the reference
}

/**
 * Type enumeration for fast comparison (vs string matching).
 * Generated from IFC schema.
 */
const enum IfcTypeEnum {
  // Spatial structure
  IfcProject = 1,
  IfcSite = 2,
  IfcBuilding = 3,
  IfcBuildingStorey = 4,
  IfcSpace = 5,
  
  // Building elements
  IfcWall = 10,
  IfcWallStandardCase = 11,
  IfcDoor = 12,
  IfcWindow = 13,
  IfcSlab = 14,
  IfcColumn = 15,
  IfcBeam = 16,
  IfcStair = 17,
  IfcRamp = 18,
  IfcRoof = 19,
  IfcCovering = 20,
  IfcCurtainWall = 21,
  IfcRailing = 22,
  
  // Openings
  IfcOpeningElement = 30,
  
  // MEP
  IfcDistributionElement = 40,
  IfcFlowTerminal = 41,
  IfcFlowSegment = 42,
  IfcFlowFitting = 43,
  
  // Relationships
  IfcRelContainedInSpatialStructure = 100,
  IfcRelAggregates = 101,
  IfcRelDefinesByProperties = 102,
  IfcRelDefinesByType = 103,
  IfcRelAssociatesMaterial = 104,
  IfcRelAssociatesClassification = 105,
  IfcRelVoidsElement = 106,
  IfcRelFillsElement = 107,
  IfcRelConnectsPathElements = 108,
  IfcRelSpaceBoundary = 109,
  
  // Property definitions
  IfcPropertySet = 200,
  IfcPropertySingleValue = 201,
  IfcPropertyEnumeratedValue = 202,
  IfcPropertyBoundedValue = 203,
  IfcPropertyListValue = 204,
  IfcElementQuantity = 210,
  IfcQuantityLength = 211,
  IfcQuantityArea = 212,
  IfcQuantityVolume = 213,
  IfcQuantityCount = 214,
  IfcQuantityWeight = 215,
  
  // Types
  IfcWallType = 300,
  IfcDoorType = 301,
  IfcWindowType = 302,
  IfcSlabType = 303,
  IfcColumnType = 304,
  IfcBeamType = 305,
  
  // Geometry representations
  IfcExtrudedAreaSolid = 400,
  IfcRevolvedAreaSolid = 401,
  IfcFacetedBrep = 402,
  IfcTriangulatedFaceSet = 403,
  IfcPolygonalFaceSet = 404,
  IfcBooleanResult = 405,
  IfcBooleanClippingResult = 406,
  IfcMappedItem = 407,
  IfcRepresentationMap = 408,
  
  // Profiles
  IfcRectangleProfileDef = 500,
  IfcCircleProfileDef = 501,
  IfcArbitraryClosedProfileDef = 502,
  IfcArbitraryProfileDefWithVoids = 503,
  IfcIShapeProfileDef = 504,
  IfcLShapeProfileDef = 505,
  
  // Materials
  IfcMaterial = 600,
  IfcMaterialLayer = 601,
  IfcMaterialLayerSet = 602,
  IfcMaterialLayerSetUsage = 603,
  IfcMaterialConstituentSet = 604,
  
  // ... ~800 more types
  Unknown = 9999,
}

// Lookup tables for type conversion
const TYPE_STRING_TO_ENUM = new Map<string, IfcTypeEnum>([
  ['IFCPROJECT', IfcTypeEnum.IfcProject],
  ['IFCSITE', IfcTypeEnum.IfcSite],
  ['IFCBUILDING', IfcTypeEnum.IfcBuilding],
  // ... all mappings
]);

const TYPE_ENUM_TO_STRING = new Map<IfcTypeEnum, string>([
  [IfcTypeEnum.IfcProject, 'IfcProject'],
  [IfcTypeEnum.IfcSite, 'IfcSite'],
  [IfcTypeEnum.IfcBuilding, 'IfcBuilding'],
  // ... all mappings
]);

function IfcTypeEnumFromString(str: string): IfcTypeEnum {
  return TYPE_STRING_TO_ENUM.get(str.toUpperCase()) ?? IfcTypeEnum.Unknown;
}

function IfcTypeEnumToString(type: IfcTypeEnum): string {
  return TYPE_ENUM_TO_STRING.get(type) ?? 'Unknown';
}
```

---

## 2.3 Columnar Tables (Layer 2)

### Entity Table

```typescript
/**
 * Entity table - core information about every IFC entity.
 * Columnar layout for cache-efficient bulk operations.
 */
interface EntityTable {
  // Parallel arrays - same index = same entity
  readonly count: number;
  
  // Core identifiers
  expressId: Uint32Array;           // EXPRESS ID (#123)
  typeEnum: Uint16Array;            // IfcTypeEnum value
  globalId: Uint32Array;            // Index into StringTable
  name: Uint32Array;                // Index into StringTable
  description: Uint32Array;         // Index into StringTable
  objectType: Uint32Array;          // Index into StringTable
  
  // Flags packed into single byte
  flags: Uint8Array;
  // Bit 0: hasGeometry
  // Bit 1: hasProperties
  // Bit 2: hasQuantities
  // Bit 3: isType (vs instance)
  // Bit 4: isExternal
  // Bit 5: hasOpenings
  // Bit 6: isFilling
  // Bit 7: reserved
  
  // Relationships (indices, not IDs - for fast lookup)
  containedInStorey: Int32Array;    // -1 if none
  definedByType: Int32Array;        // -1 if none
  
  // Geometry reference (index into GeometryStore)
  geometryIndex: Int32Array;        // -1 if no geometry
  
  // Fast type filtering - precomputed ranges for sorted-by-type layout
  typeRanges: Map<IfcTypeEnum, { start: number; end: number }>;
  
  // Methods
  getGlobalId(expressId: number): string;
  getName(expressId: number): string;
  getTypeName(expressId: number): string;
  hasGeometry(expressId: number): boolean;
  getByType(type: IfcTypeEnum): number[]; // Returns expressIds
}

// Flag helpers
const EntityFlags = {
  HAS_GEOMETRY:    0b00000001,
  HAS_PROPERTIES:  0b00000010,
  HAS_QUANTITIES:  0b00000100,
  IS_TYPE:         0b00001000,
  IS_EXTERNAL:     0b00010000,
  HAS_OPENINGS:    0b00100000,
  IS_FILLING:      0b01000000,
} as const;

function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}
```

### Property Table

```typescript
/**
 * Property table - all property values in columnar format.
 * Optimized for filtering and aggregation.
 */
interface PropertyTable {
  readonly count: number;
  
  // Which entity owns this property
  entityId: Uint32Array;
  
  // Property set info
  psetName: Uint32Array;            // Index into StringTable
  psetGlobalId: Uint32Array;        // Index into StringTable
  
  // Property info
  propName: Uint32Array;            // Index into StringTable
  propType: Uint8Array;             // PropertyValueType enum
  
  // Values (only one is valid per row, based on propType)
  valueString: Uint32Array;         // Index into StringTable
  valueReal: Float64Array;
  valueInt: Int32Array;
  valueBool: Uint8Array;            // 0 = false, 1 = true, 255 = null
  
  // Unit reference (for real/int values)
  unitId: Int32Array;               // -1 if no unit
  
  // === INDICES FOR FAST LOOKUP ===
  
  // entityId → row indices (for getting all properties of an entity)
  entityIndex: Map<number, number[]>;
  
  // psetName string index → row indices (for finding all "Pset_WallCommon")
  psetIndex: Map<number, number[]>;
  
  // propName string index → row indices (for finding all "FireRating")
  propIndex: Map<number, number[]>;
  
  // === METHODS ===
  
  getForEntity(expressId: number): PropertySet[];
  getPropertyValue(expressId: number, psetName: string, propName: string): PropertyValue | null;
  findByProperty(propName: string, value: PropertyValue): number[]; // Returns expressIds
}

const enum PropertyValueType {
  String = 0,
  Real = 1,
  Integer = 2,
  Boolean = 3,
  Logical = 4,          // TRUE, FALSE, UNKNOWN
  Label = 5,
  Identifier = 6,
  Text = 7,
  Enum = 8,
  Reference = 9,        // Reference to another entity
  List = 10,            // Stored as JSON in valueString
}

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
```

### Quantity Table

```typescript
/**
 * Quantity table - similar to properties but for quantities.
 * Separated for performance (quantities are always numeric).
 */
interface QuantityTable {
  readonly count: number;
  
  entityId: Uint32Array;
  qsetName: Uint32Array;            // Index into StringTable
  quantityName: Uint32Array;        // Index into StringTable
  quantityType: Uint8Array;         // QuantityType enum
  value: Float64Array;              // Always numeric
  unitId: Int32Array;               // Unit reference
  formula: Uint32Array;             // Index into StringTable (-1 if none)
  
  // Indices
  entityIndex: Map<number, number[]>;
  qsetIndex: Map<number, number[]>;
  quantityIndex: Map<number, number[]>;
  
  // Methods
  getForEntity(expressId: number): QuantitySet[];
  getQuantityValue(expressId: number, qsetName: string, quantName: string): number | null;
  sumByType(quantityName: string, elementType?: IfcTypeEnum): number;
}

const enum QuantityType {
  Length = 0,
  Area = 1,
  Volume = 2,
  Count = 3,
  Weight = 4,
  Time = 5,
}

interface QuantitySet {
  name: string;
  quantities: Quantity[];
}

interface Quantity {
  name: string;
  type: QuantityType;
  value: number;
  unit?: string;
  formula?: string;
}
```

### String Table

```typescript
/**
 * String table - deduplicated string storage.
 * Reduces memory by storing each unique string once.
 */
interface StringTable {
  readonly count: number;
  
  // All unique strings (indexed array)
  strings: string[];
  
  // Reverse lookup: string → index
  index: Map<string, number>;
  
  // Special indices
  readonly NULL_INDEX: number;      // -1 or special value for null/empty
  
  // Methods
  get(index: number): string;
  intern(value: string): number;
  has(value: string): boolean;
  indexOf(value: string): number;   // Returns -1 if not found
}

/**
 * String table implementation with memory-efficient storage.
 */
class StringTableImpl implements StringTable {
  strings: string[] = [''];  // Index 0 = empty string
  index: Map<string, number> = new Map([['', 0]]);
  
  readonly NULL_INDEX = -1;
  
  get count(): number {
    return this.strings.length;
  }
  
  get(idx: number): string {
    if (idx < 0 || idx >= this.strings.length) return '';
    return this.strings[idx];
  }
  
  intern(value: string): number {
    if (value === null || value === undefined) return this.NULL_INDEX;
    
    const existing = this.index.get(value);
    if (existing !== undefined) return existing;
    
    const newIndex = this.strings.length;
    this.strings.push(value);
    this.index.set(value, newIndex);
    return newIndex;
  }
  
  has(value: string): boolean {
    return this.index.has(value);
  }
  
  indexOf(value: string): number {
    return this.index.get(value) ?? -1;
  }
}
```

---

## 2.4 Relationship Graph (Layer 3)

```typescript
/**
 * Bidirectional relationship graph.
 * Enables fast traversal in both directions.
 */
interface RelationshipGraph {
  // Forward edges: from source to targets
  forward: RelationshipEdges;
  
  // Inverse edges: from target to sources
  inverse: RelationshipEdges;
  
  // Relationship metadata
  relationships: RelationshipTable;
  
  // Methods
  getRelated(entityId: number, relType: RelationshipType, direction: 'forward' | 'inverse'): number[];
  hasRelationship(sourceId: number, targetId: number, relType?: RelationshipType): boolean;
  getRelationshipsBetween(sourceId: number, targetId: number): RelationshipInfo[];
}

/**
 * Compact edge storage using CSR (Compressed Sparse Row) format.
 */
interface RelationshipEdges {
  // For each entity, stores range of edges in the edges array
  offsets: Map<number, number>;     // entityId → start index in edges
  counts: Map<number, number>;      // entityId → number of edges
  
  // All edges, grouped by source entity
  edgeTargets: Uint32Array;         // Target entity IDs
  edgeTypes: Uint16Array;           // RelationshipType enum
  edgeRelIds: Uint32Array;          // Original IfcRel* entity ID
  
  // Methods
  getEdges(entityId: number, type?: RelationshipType): Edge[];
  getTargets(entityId: number, type?: RelationshipType): number[];
  hasAnyEdges(entityId: number): boolean;
}

interface Edge {
  target: number;
  type: RelationshipType;
  relationshipId: number;
}

const enum RelationshipType {
  // Spatial containment
  ContainsElements = 1,           // IfcRelContainedInSpatialStructure
  Aggregates = 2,                 // IfcRelAggregates
  
  // Properties & quantities
  DefinesByProperties = 10,       // IfcRelDefinesByProperties
  DefinesByType = 11,             // IfcRelDefinesByType
  
  // Materials
  AssociatesMaterial = 20,        // IfcRelAssociatesMaterial
  
  // Classifications
  AssociatesClassification = 30,  // IfcRelAssociatesClassification
  
  // Connections
  ConnectsPathElements = 40,      // IfcRelConnectsPathElements
  FillsElement = 41,              // IfcRelFillsElement
  VoidsElement = 42,              // IfcRelVoidsElement
  ConnectsElements = 43,          // IfcRelConnectsElements
  
  // Space boundaries
  SpaceBoundary = 50,             // IfcRelSpaceBoundary
  
  // Assignments
  AssignsToGroup = 60,            // IfcRelAssignsToGroup
  AssignsToProduct = 61,          // IfcRelAssignsToProduct
  
  // Structural
  ReferencedInSpatialStructure = 70, // For elements referenced but not contained
}

/**
 * Relationship metadata table.
 */
interface RelationshipTable {
  readonly count: number;
  
  expressId: Uint32Array;
  typeEnum: Uint16Array;
  globalId: Uint32Array;
  name: Uint32Array;
  
  // Specific relationship data
  propertySetId: Int32Array;      // For IfcRelDefinesByProperties, -1 if N/A
  materialId: Int32Array;         // For IfcRelAssociatesMaterial, -1 if N/A
}

interface RelationshipInfo {
  relationshipId: number;
  type: RelationshipType;
  typeName: string;
  name?: string;
}
```

---

## 2.5 Geometry Store (Layer 4)

```typescript
/**
 * Columnar geometry storage.
 * Zero-copy uploadable to GPU.
 */
interface GeometryStore {
  // === MESH DATA (combined buffers) ===
  positions: Float32Array;          // [x,y,z, x,y,z, ...]
  normals: Float32Array;            // [nx,ny,nz, ...]
  indices: Uint32Array;             // Triangle indices
  uvs?: Float32Array;               // [u,v, u,v, ...] if present
  
  // === MESH RANGES ===
  meshes: MeshTable;
  
  // === INSTANCES ===
  instances: InstanceTable;
  
  // === MATERIALS ===
  materials: MaterialStore;
  
  // === METHODS ===
  getMesh(expressId: number): ColumnarMesh | null;
  getBounds(expressId: number): AABB | null;
  getCombined(expressIds: number[]): CombinedGeometry;
  getCombinedBounds(expressIds: number[]): AABB;
}

interface MeshTable {
  readonly count: number;
  
  expressId: Uint32Array;           // Owning entity
  
  // Range in position/normal buffers
  vertexStart: Uint32Array;
  vertexCount: Uint32Array;
  
  // Range in index buffer
  indexStart: Uint32Array;
  indexCount: Uint32Array;
  
  // Material
  materialIndex: Int32Array;        // -1 if default
  
  // Bounding box (for culling)
  boundsMinX: Float32Array;
  boundsMinY: Float32Array;
  boundsMinZ: Float32Array;
  boundsMaxX: Float32Array;
  boundsMaxY: Float32Array;
  boundsMaxZ: Float32Array;
  
  // Flags
  flags: Uint8Array;
  // Bit 0: isInstanced
  // Bit 1: hasUVs
  // Bit 2: isTransparent
  // Bit 3: doubleSided
}

interface InstanceTable {
  readonly count: number;
  
  // Which mesh this is an instance of
  prototypeIndex: Uint32Array;
  
  // Per-instance data
  expressId: Uint32Array;
  
  // Transform (4x4 column-major matrix)
  transforms: Float32Array;         // [16 floats per instance]
  
  // Optional per-instance color override
  colorOverride?: Uint8Array;       // [r,g,b,a per instance], 0 = no override
}

interface MaterialStore {
  readonly count: number;
  
  name: Uint32Array;                // Index into StringTable
  
  // Surface style (PBR-ish)
  diffuseColor: Float32Array;       // [r,g,b,a] per material
  specularColor: Float32Array;
  emissiveColor: Float32Array;
  
  shininess: Float32Array;
  transparency: Float32Array;
  roughness: Float32Array;
  metallic: Float32Array;
  
  // Texture references (index into texture array, -1 if none)
  diffuseTexture: Int32Array;
  normalTexture: Int32Array;
  roughnessTexture: Int32Array;
  
  // Textures
  textures: TextureData[];
}

interface TextureData {
  id: number;
  name: string;
  width: number;
  height: number;
  format: 'rgb' | 'rgba' | 'luminance';
  data: Uint8Array;
  mimeType?: string;
}

/**
 * Output format for single mesh retrieval.
 */
interface ColumnarMesh {
  expressId: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  bounds: AABB;
  materialIndex: number;
}

/**
 * Output format for combined geometry.
 */
interface CombinedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  
  // Mesh ranges for sub-object identification
  ranges: MeshRange[];
  
  // Overall bounds
  bounds: AABB;
}

interface MeshRange {
  expressId: number;
  indexStart: number;
  indexCount: number;
  materialIndex: number;
}

interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}
```

---

## 2.6 Spatial Hierarchy (Layer 5)

```typescript
/**
 * Precomputed spatial hierarchy for fast navigation.
 */
interface SpatialHierarchy {
  // Project → Sites → Buildings → Storeys → Spaces
  project: SpatialNode;
  
  // Fast lookup maps
  byStorey: Map<number, number[]>;    // storeyId → element IDs
  byBuilding: Map<number, number[]>;  // buildingId → element IDs
  bySite: Map<number, number[]>;      // siteId → element IDs
  bySpace: Map<number, number[]>;     // spaceId → element IDs
  
  // Elevation data
  storeyElevations: Map<number, number>;  // storeyId → elevation (z)
  
  // Methods
  getStoreyElements(storeyId: number): number[];
  getStoreyByElevation(z: number): number | null;
  getContainingSpace(elementId: number): number | null;
  getPath(elementId: number): SpatialNode[]; // Project → ... → Element
}

interface SpatialNode {
  expressId: number;
  type: IfcTypeEnum;
  name: string;
  elevation?: number;           // For storeys
  children: SpatialNode[];
  elements: number[];           // Direct contained elements (expressIds)
}

/**
 * Type index for fast type-based queries.
 */
interface TypeIndex {
  // Type entity → instances of that type
  instancesByType: Map<number, number[]>;
  
  // For each entity, its defining type (if any)
  typeOf: Map<number, number>;
  
  // Type metadata
  types: Map<number, TypeMetadata>;
  
  // Methods
  getInstancesOfType(typeId: number): number[];
  getDefiningType(instanceId: number): number | null;
  getTypeMetadata(typeId: number): TypeMetadata | null;
}

interface TypeMetadata {
  expressId: number;
  name: string;
  description?: string;
  applicableOccurrence?: string;
  propertySetIds: number[];         // Attached PSets
  representationMaps: number[];     // For geometry
  tag?: string;
}
```

---

*Continue to Part 3: Parsing Pipeline*

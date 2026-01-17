# IFC5 Support Planning Document

## Executive Summary

This document provides an implementation-ready plan for extending ifc-lite to support IFC5 (IFCX). Given that IFC5 is still in alpha and key aspects (especially data layer semantics) remain fluid, we focus on:

1. **Stable features** that can be implemented now with confidence
2. **Abstraction layers** for unstable features to minimize future churn
3. **Integration points** with existing server/client pipelines

**Key Insight**: IFC5's geometry representation (USD-style pre-tessellated meshes) is actually *simpler* than IFC4's parametric geometry, making the geometry pipeline a low-risk starting point.

---

## Stability Analysis

### STABLE (Implement with Confidence)

| Feature | Format | Why Stable |
|---------|--------|------------|
| **Geometry meshes** | `usd::usdgeom::mesh` | USD standard, unlikely to change |
| **Transform matrices** | `usd::xformop::transform` | USD standard 4x4 matrices |
| **JSON structure** | header/imports/schemas/data | Core format, finalized |
| **Path-based IDs** | UUID strings | Fundamental to ECS model |
| **children/inherits** | Composition model | Core ECS pattern |
| **Entity classification** | `bsi::ifc::class` | Maps to existing IFC types |
| **Basic properties** | `bsi::ifc::prop::*` | Direct attribute values |
| **Presentation** | `bsi::ifc::presentation::*` | Color/opacity |

### LIKELY STABLE (Implement with Abstraction)

| Feature | Format | Risk |
|---------|--------|------|
| **Materials** | `bsi::ifc::material` | Code/URI structure may evolve |
| **Quantities** | `bsi::ifc::prop::Volume` etc | Naming conventions may change |
| **Space boundaries** | `bsi::ifc::spaceBoundary` | Relationship pattern may evolve |

### UNSTABLE (Abstract Heavily)

| Feature | Concern |
|---------|---------|
| **Import URIs** | Schema hosting URLs will change |
| **Schema validation** | TypeSpec schemas still evolving |
| **Federation semantics** | Layer merge rules unclear |
| **Third-party schemas** | `nlsfb::`, etc. - external |

---

## Integration Architecture

### Target: Unified Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     FILE DETECTION                               │
│         detectFormat(buffer) → 'ifc4' | 'ifcx'                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│     IFC4 PIPELINE       │     │     IFCX PIPELINE       │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │ STEP Parser (Rust)│  │     │  │ JSON Parser (TS)  │  │
│  └─────────┬─────────┘  │     │  └─────────┬─────────┘  │
│            ▼            │     │            ▼            │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │ Parametric Geom   │  │     │  │ Composition       │  │
│  │ → Tessellation    │  │     │  │ (flatten ECS)     │  │
│  └─────────┬─────────┘  │     │  └─────────┬─────────┘  │
│            ▼            │     │            ▼            │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │ Entity/Property   │  │     │  │ Entity/Property   │  │
│  │ Extraction        │  │     │  │ Extraction        │  │
│  └─────────┬─────────┘  │     │  └─────────┬─────────┘  │
└────────────┼────────────┘     └────────────┼────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │      UNIFIED DATA STORE       │
              │  ┌─────────────────────────┐  │
              │  │ EntityTable             │  │
              │  │ PropertyTable           │  │
              │  │ RelationshipGraph       │  │
              │  │ SpatialHierarchy        │  │
              │  │ MeshData[]              │  │
              │  └─────────────────────────┘  │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │    SHARED DOWNSTREAM          │
              │  • Visualization (WebGPU)     │
              │  • Query API                  │
              │  • Export (glTF, Parquet)     │
              │  • Caching                    │
              └───────────────────────────────┘
```

---

## Implementation Plan

### Package Structure

```
packages/
├── ifcx/                          # NEW: IFCX-specific code
│   ├── src/
│   │   ├── index.ts               # Public API
│   │   ├── parser.ts              # JSON parsing
│   │   ├── composition.ts         # ECS flattening
│   │   ├── geometry-extractor.ts  # USD mesh → MeshData
│   │   ├── entity-extractor.ts    # bsi::ifc::class → EntityTable
│   │   ├── property-extractor.ts  # bsi::ifc::prop::* → PropertyTable
│   │   ├── hierarchy-builder.ts   # children → SpatialHierarchy
│   │   └── types.ts               # IFCX-specific types
│   └── package.json
├── parser/                        # EXISTING: Add format detection
│   └── src/
│       ├── index.ts               # Add: detectFormat(), parseAuto()
│       └── ...
└── data/                          # EXISTING: No changes needed
    └── src/
        ├── entity-table.ts        # Reuse as-is
        ├── property-table.ts      # Reuse as-is
        └── ...
```

### Phase 1: Core IFCX Parser (Stable Features)

**Goal**: Parse single IFCX files, produce `IfcDataStore` compatible with existing pipeline.

#### 1.1 File Detection

**File**: `packages/parser/src/index.ts`

```typescript
export type FileFormat = 'ifc4' | 'ifcx' | 'unknown';

export function detectFormat(buffer: ArrayBuffer): FileFormat {
  const bytes = new Uint8Array(buffer, 0, Math.min(100, buffer.byteLength));
  const start = new TextDecoder().decode(bytes).trim();

  // IFCX is JSON starting with {
  if (start.startsWith('{')) {
    return 'ifcx';
  }
  // IFC4 STEP starts with ISO-10303-21
  if (start.includes('ISO-10303-21') || start.startsWith('ISO')) {
    return 'ifc4';
  }
  return 'unknown';
}

export async function parseAuto(buffer: ArrayBuffer): Promise<IfcDataStore> {
  const format = detectFormat(buffer);
  switch (format) {
    case 'ifcx':
      return parseIfcx(buffer);
    case 'ifc4':
      return parseColumnar(buffer);
    default:
      throw new Error('Unknown file format');
  }
}
```

#### 1.2 IFCX Types

**File**: `packages/ifcx/src/types.ts`

```typescript
// Core IFCX structures (from buildingSMART schema)
export interface IfcxFile {
  header: IfcxHeader;
  imports: ImportNode[];
  schemas: Record<string, IfcxSchema>;
  data: IfcxNode[];
}

export interface IfcxHeader {
  id: string;
  ifcxVersion: string;
  dataVersion: string;
  author: string;
  timestamp: string;
}

export interface ImportNode {
  uri: string;
  integrity?: string;
}

export interface IfcxNode {
  path: string;
  children?: Record<string, string | null>;
  inherits?: Record<string, string | null>;
  attributes?: Record<string, unknown>;
}

export interface IfcxSchema {
  uri?: string;
  value: IfcxValueDescription;
}

// Post-composition node (flattened)
export interface ComposedNode {
  path: string;
  attributes: Map<string, unknown>;
  children: Map<string, ComposedNode>;
  parent?: ComposedNode;
}

// Attribute namespace constants
export const ATTR = {
  // Stable - implement now
  CLASS: 'bsi::ifc::class',
  MESH: 'usd::usdgeom::mesh',
  TRANSFORM: 'usd::xformop',
  VISIBILITY: 'usd::usdgeom::visibility',
  DIFFUSE_COLOR: 'bsi::ifc::presentation::diffuseColor',
  OPACITY: 'bsi::ifc::presentation::opacity',
  MATERIAL: 'bsi::ifc::material',

  // Likely stable - implement with abstraction
  PROP_PREFIX: 'bsi::ifc::prop::',
  SPACE_BOUNDARY: 'bsi::ifc::spaceBoundary',
} as const;
```

#### 1.3 Composition Engine

**File**: `packages/ifcx/src/composition.ts`

```typescript
import { IfcxFile, IfcxNode, ComposedNode } from './types';

/**
 * Flattens IFCX ECS data into composed nodes.
 *
 * Algorithm:
 * 1. Group all nodes by path (multiple nodes can reference same path)
 * 2. Merge attributes (later wins)
 * 3. Resolve inherits references
 * 4. Build parent-child tree from children references
 */
export function composeIfcx(file: IfcxFile): Map<string, ComposedNode> {
  // Phase 1: Group nodes by path
  const nodesByPath = new Map<string, IfcxNode[]>();
  for (const node of file.data) {
    const existing = nodesByPath.get(node.path) || [];
    existing.push(node);
    nodesByPath.set(node.path, existing);
  }

  // Phase 2: Flatten to pre-composition nodes
  const preComposed = new Map<string, PreComposedNode>();
  for (const [path, nodes] of nodesByPath) {
    preComposed.set(path, flattenNodes(path, nodes));
  }

  // Phase 3: Resolve inherits and build tree
  const composed = new Map<string, ComposedNode>();
  for (const [path, pre] of preComposed) {
    if (!composed.has(path)) {
      composeNode(path, preComposed, composed);
    }
  }

  return composed;
}

interface PreComposedNode {
  path: string;
  children: Record<string, string | null>;
  inherits: Record<string, string | null>;
  attributes: Record<string, unknown>;
}

function flattenNodes(path: string, nodes: IfcxNode[]): PreComposedNode {
  const result: PreComposedNode = {
    path,
    children: {},
    inherits: {},
    attributes: {},
  };

  // Later nodes override earlier (layer semantics)
  for (const node of nodes) {
    if (node.children) {
      for (const [key, value] of Object.entries(node.children)) {
        if (value === null) {
          delete result.children[key];
        } else {
          result.children[key] = value;
        }
      }
    }
    if (node.inherits) {
      for (const [key, value] of Object.entries(node.inherits)) {
        if (value === null) {
          delete result.inherits[key];
        } else {
          result.inherits[key] = value;
        }
      }
    }
    if (node.attributes) {
      Object.assign(result.attributes, node.attributes);
    }
  }

  return result;
}

function composeNode(
  path: string,
  preComposed: Map<string, PreComposedNode>,
  composed: Map<string, ComposedNode>,
  visited = new Set<string>()
): ComposedNode {
  // Cycle detection
  if (visited.has(path)) {
    throw new Error(`Circular reference detected: ${path}`);
  }
  visited.add(path);

  // Already composed?
  if (composed.has(path)) {
    return composed.get(path)!;
  }

  const pre = preComposed.get(path);
  const node: ComposedNode = {
    path,
    attributes: new Map(),
    children: new Map(),
  };

  if (!pre) {
    composed.set(path, node);
    return node;
  }

  // Resolve inherits first (type-level data)
  for (const inheritPath of Object.values(pre.inherits)) {
    if (inheritPath) {
      const inherited = composeNode(inheritPath, preComposed, composed, visited);
      // Copy inherited attributes (can be overridden)
      for (const [key, value] of inherited.attributes) {
        node.attributes.set(key, value);
      }
      // Copy inherited children
      for (const [key, child] of inherited.children) {
        node.children.set(key, child);
      }
    }
  }

  // Apply own attributes (override inherited)
  for (const [key, value] of Object.entries(pre.attributes)) {
    node.attributes.set(key, value);
  }

  // Resolve children
  for (const [name, childPath] of Object.entries(pre.children)) {
    if (childPath) {
      const child = composeNode(childPath, preComposed, composed, visited);
      child.parent = node;
      node.children.set(name, child);
    }
  }

  composed.set(path, node);
  return node;
}

/**
 * Find root nodes (nodes with no parent reference)
 */
export function findRoots(composed: Map<string, ComposedNode>): ComposedNode[] {
  const roots: ComposedNode[] = [];
  const childPaths = new Set<string>();

  // Collect all child paths
  for (const node of composed.values()) {
    for (const child of node.children.values()) {
      childPaths.add(child.path);
    }
  }

  // Roots are nodes not referenced as children
  for (const node of composed.values()) {
    if (!childPaths.has(node.path)) {
      roots.push(node);
    }
  }

  return roots;
}
```

#### 1.4 Geometry Extractor

**File**: `packages/ifcx/src/geometry-extractor.ts`

```typescript
import { ComposedNode, ATTR } from './types';
import { MeshData } from '@ifc-lite/geometry';

interface UsdMesh {
  points: number[][];           // [[x,y,z], ...]
  faceVertexIndices: number[];  // Triangle indices
  normals?: number[][];         // Optional normals
}

interface UsdTransform {
  transform: number[][];        // 4x4 matrix, row-major
}

/**
 * Extract geometry from composed IFCX nodes.
 *
 * IFC5 geometry is pre-tessellated (unlike IFC4 parametric geometry),
 * so this is straightforward mesh extraction.
 */
export function extractGeometry(
  composed: Map<string, ComposedNode>,
  expressIdMap: Map<string, number>
): MeshData[] {
  const meshes: MeshData[] = [];

  for (const node of composed.values()) {
    const mesh = node.attributes.get(ATTR.MESH) as UsdMesh | undefined;
    if (!mesh) continue;

    const expressId = expressIdMap.get(node.path);
    if (expressId === undefined) continue;

    // Get accumulated transform
    const transform = getAccumulatedTransform(node);

    // Convert USD mesh to MeshData
    const meshData = convertUsdMesh(mesh, expressId, transform);

    // Apply presentation attributes
    applyPresentation(meshData, node);

    meshes.push(meshData);
  }

  return meshes;
}

function convertUsdMesh(
  usd: UsdMesh,
  expressId: number,
  transform: Float32Array | null
): MeshData {
  // Flatten points array
  const positions = new Float32Array(usd.points.length * 3);
  for (let i = 0; i < usd.points.length; i++) {
    const [x, y, z] = usd.points[i];
    if (transform) {
      // Apply transform
      const [tx, ty, tz] = applyTransform(x, y, z, transform);
      positions[i * 3] = tx;
      positions[i * 3 + 1] = ty;
      positions[i * 3 + 2] = tz;
    } else {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
  }

  // Indices are already triangle indices
  const indices = new Uint32Array(usd.faceVertexIndices);

  // Compute normals if not provided
  const normals = usd.normals
    ? flattenNormals(usd.normals)
    : computeNormals(positions, indices);

  return {
    expressId,
    positions,
    indices,
    normals,
  };
}

function getAccumulatedTransform(node: ComposedNode): Float32Array | null {
  const transforms: Float32Array[] = [];

  let current: ComposedNode | undefined = node;
  while (current) {
    const xform = current.attributes.get(ATTR.TRANSFORM) as UsdTransform | undefined;
    if (xform?.transform) {
      transforms.unshift(flattenMatrix(xform.transform));
    }
    current = current.parent;
  }

  if (transforms.length === 0) return null;
  if (transforms.length === 1) return transforms[0];

  // Multiply transforms (parent * child order)
  let result = transforms[0];
  for (let i = 1; i < transforms.length; i++) {
    result = multiplyMatrices(result, transforms[i]);
  }

  return result;
}

function flattenMatrix(m: number[][]): Float32Array {
  // USD uses row-major 4x4 matrices
  const result = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      result[row * 4 + col] = m[row][col];
    }
  }
  return result;
}

function applyTransform(x: number, y: number, z: number, m: Float32Array): [number, number, number] {
  // Row-major matrix multiplication
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function applyPresentation(mesh: MeshData, node: ComposedNode): void {
  const diffuse = node.attributes.get(ATTR.DIFFUSE_COLOR) as number[] | undefined;
  const opacity = node.attributes.get(ATTR.OPACITY) as number | undefined;

  if (diffuse) {
    const [r, g, b] = diffuse;
    const a = opacity ?? 1.0;
    mesh.color = new Uint8Array([
      Math.round(r * 255),
      Math.round(g * 255),
      Math.round(b * 255),
      Math.round(a * 255),
    ]);
  }
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  // Standard normal computation from triangles
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    // Triangle vertices
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // Edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // Cross product
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate (will normalize later)
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }

  return normals;
}

function flattenNormals(normals: number[][]): Float32Array {
  const result = new Float32Array(normals.length * 3);
  for (let i = 0; i < normals.length; i++) {
    result[i * 3] = normals[i][0];
    result[i * 3 + 1] = normals[i][1];
    result[i * 3 + 2] = normals[i][2];
  }
  return result;
}

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      result[row * 4 + col] = sum;
    }
  }
  return result;
}
```

#### 1.5 Entity Extractor

**File**: `packages/ifcx/src/entity-extractor.ts`

```typescript
import { ComposedNode, ATTR } from './types';
import { EntityTable, EntityTableBuilder, IfcTypeEnum, IfcTypeEnumFromString } from '@ifc-lite/data';

interface IfcClass {
  code: string;   // "IfcWall"
  uri?: string;   // "https://identifier.buildingsmart.org/..."
}

/**
 * Extract entities from composed IFCX nodes.
 *
 * Mapping:
 * - path → expressId (synthetic, auto-incrementing)
 * - bsi::ifc::class.code → typeEnum
 * - children hierarchy → spatial structure
 */
export function extractEntities(
  composed: Map<string, ComposedNode>,
  strings: StringTable
): { entities: EntityTable; pathToId: Map<string, number> } {
  const builder = new EntityTableBuilder();
  const pathToId = new Map<string, number>();

  let nextExpressId = 1;

  // First pass: assign express IDs and extract basic entity data
  for (const node of composed.values()) {
    const ifcClass = node.attributes.get(ATTR.CLASS) as IfcClass | undefined;
    if (!ifcClass) continue; // Skip non-IFC nodes (geometry-only, materials, etc.)

    const expressId = nextExpressId++;
    pathToId.set(node.path, expressId);

    // Map IFC class code to enum
    const typeEnum = IfcTypeEnumFromString(ifcClass.code) ?? IfcTypeEnum.IfcBuildingElementProxy;

    // Extract name from attributes or path
    const name = extractName(node) ?? node.path.slice(0, 8);

    // Check if has geometry
    const hasGeometry = node.attributes.has(ATTR.MESH) ||
      hasGeometryInChildren(node);

    builder.addEntity({
      expressId,
      typeEnum,
      globalId: strings.intern(node.path),
      name: strings.intern(name),
      description: strings.intern(''),
      objectType: strings.intern(ifcClass.code),
      flags: hasGeometry ? EntityFlags.HAS_GEOMETRY : 0,
    });
  }

  return {
    entities: builder.build(),
    pathToId,
  };
}

function extractName(node: ComposedNode): string | null {
  // Try common property patterns
  const name = node.attributes.get('bsi::ifc::prop::Name');
  if (typeof name === 'string') return name;

  const typeName = node.attributes.get('bsi::ifc::prop::TypeName');
  if (typeof typeName === 'string') return typeName;

  return null;
}

function hasGeometryInChildren(node: ComposedNode): boolean {
  for (const child of node.children.values()) {
    if (child.attributes.has(ATTR.MESH)) return true;
    if (hasGeometryInChildren(child)) return true;
  }
  return false;
}
```

#### 1.6 Property Extractor

**File**: `packages/ifcx/src/property-extractor.ts`

```typescript
import { ComposedNode, ATTR } from './types';
import { PropertyTable, PropertyTableBuilder, PropertyValueType } from '@ifc-lite/data';

/**
 * Extract properties from composed IFCX nodes.
 *
 * IFCX properties are flat attributes with namespace prefixes:
 * - bsi::ifc::prop::IsExternal → PropertySingleValue
 * - bsi::ifc::prop::Volume → QuantitySingleValue
 *
 * We group properties by namespace prefix for PropertySet-like grouping.
 */
export function extractProperties(
  composed: Map<string, ComposedNode>,
  pathToId: Map<string, number>,
  strings: StringTable
): PropertyTable {
  const builder = new PropertyTableBuilder();

  for (const node of composed.values()) {
    const expressId = pathToId.get(node.path);
    if (expressId === undefined) continue;

    // Group attributes by namespace
    const grouped = groupAttributesByNamespace(node.attributes);

    for (const [psetName, props] of grouped) {
      for (const [propName, value] of props) {
        const { valueType, stringVal, realVal, intVal, boolVal } =
          convertPropertyValue(value, strings);

        builder.addProperty({
          entityId: expressId,
          psetName: strings.intern(psetName),
          psetGlobalId: strings.intern(''),
          propName: strings.intern(propName),
          propType: valueType,
          valueString: stringVal,
          valueReal: realVal,
          valueInt: intVal,
          valueBool: boolVal,
          unitId: -1,
        });
      }
    }
  }

  return builder.build();
}

function groupAttributesByNamespace(
  attributes: Map<string, unknown>
): Map<string, Map<string, unknown>> {
  const grouped = new Map<string, Map<string, unknown>>();

  for (const [key, value] of attributes) {
    // Skip non-property attributes
    if (key === ATTR.CLASS || key === ATTR.MESH || key === ATTR.TRANSFORM ||
        key === ATTR.VISIBILITY || key === ATTR.DIFFUSE_COLOR ||
        key === ATTR.OPACITY || key === ATTR.MATERIAL) {
      continue;
    }

    // Parse namespace::name pattern
    const lastColon = key.lastIndexOf('::');
    if (lastColon === -1) continue;

    const namespace = key.slice(0, lastColon);
    const propName = key.slice(lastColon + 2);

    // Use namespace as pset name, simplify for display
    const psetName = namespace.replace(/::/g, ' / ');

    if (!grouped.has(psetName)) {
      grouped.set(psetName, new Map());
    }
    grouped.get(psetName)!.set(propName, value);
  }

  return grouped;
}

function convertPropertyValue(
  value: unknown,
  strings: StringTable
): {
  valueType: PropertyValueType;
  stringVal: number;
  realVal: number;
  intVal: number;
  boolVal: number;
} {
  if (typeof value === 'string') {
    return {
      valueType: PropertyValueType.String,
      stringVal: strings.intern(value),
      realVal: 0,
      intVal: 0,
      boolVal: 255,
    };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {
        valueType: PropertyValueType.Integer,
        stringVal: 0,
        realVal: 0,
        intVal: value,
        boolVal: 255,
      };
    }
    return {
      valueType: PropertyValueType.Real,
      stringVal: 0,
      realVal: value,
      intVal: 0,
      boolVal: 255,
    };
  }

  if (typeof value === 'boolean') {
    return {
      valueType: PropertyValueType.Boolean,
      stringVal: 0,
      realVal: 0,
      intVal: 0,
      boolVal: value ? 1 : 0,
    };
  }

  // Complex objects - serialize to JSON string
  return {
    valueType: PropertyValueType.String,
    stringVal: strings.intern(JSON.stringify(value)),
    realVal: 0,
    intVal: 0,
    boolVal: 255,
  };
}
```

#### 1.7 Hierarchy Builder

**File**: `packages/ifcx/src/hierarchy-builder.ts`

```typescript
import { ComposedNode, ATTR } from './types';
import { SpatialHierarchy, SpatialNode, IfcTypeEnum } from '@ifc-lite/data';

interface IfcClass {
  code: string;
}

const SPATIAL_TYPES = new Set([
  'IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace'
]);

/**
 * Build spatial hierarchy from composed IFCX nodes.
 *
 * IFCX hierarchy comes from children relationships:
 * - Project → Site → Building → Storey → Elements
 *
 * We identify spatial structure elements by their bsi::ifc::class codes.
 */
export function buildHierarchy(
  composed: Map<string, ComposedNode>,
  pathToId: Map<string, number>,
  strings: StringTable
): SpatialHierarchy {
  // Find project root
  const projectNode = findProjectRoot(composed);
  if (!projectNode) {
    return createEmptyHierarchy();
  }

  // Build spatial tree
  const projectSpatial = buildSpatialNode(projectNode, pathToId, strings);

  // Build lookup maps
  const byStorey = new Map<number, number[]>();
  const byBuilding = new Map<number, number[]>();
  const bySite = new Map<number, number[]>();
  const bySpace = new Map<number, number[]>();
  const storeyElevations = new Map<number, number>();
  const elementToStorey = new Map<number, number>();

  // Traverse and populate maps
  populateMaps(
    projectSpatial,
    null,
    pathToId,
    byStorey,
    byBuilding,
    bySite,
    bySpace,
    storeyElevations,
    elementToStorey
  );

  return {
    project: projectSpatial,
    byStorey,
    byBuilding,
    bySite,
    bySpace,
    storeyElevations,
    elementToStorey,
  };
}

function findProjectRoot(composed: Map<string, ComposedNode>): ComposedNode | null {
  for (const node of composed.values()) {
    const ifcClass = node.attributes.get(ATTR.CLASS) as IfcClass | undefined;
    if (ifcClass?.code === 'IfcProject') {
      return node;
    }
  }
  return null;
}

function buildSpatialNode(
  node: ComposedNode,
  pathToId: Map<string, number>,
  strings: StringTable
): SpatialNode {
  const ifcClass = node.attributes.get(ATTR.CLASS) as IfcClass | undefined;
  const expressId = pathToId.get(node.path) ?? 0;
  const typeEnum = IfcTypeEnumFromString(ifcClass?.code ?? '') ?? IfcTypeEnum.IfcBuildingElementProxy;

  const spatialNode: SpatialNode = {
    expressId,
    type: typeEnum,
    name: extractName(node) ?? node.path.slice(0, 8),
    children: [],
    elements: [],
  };

  // Extract elevation for storeys
  if (ifcClass?.code === 'IfcBuildingStorey') {
    const elevation = node.attributes.get('bsi::ifc::prop::Elevation');
    if (typeof elevation === 'number') {
      spatialNode.elevation = elevation;
    }
  }

  // Process children
  for (const [name, child] of node.children) {
    const childClass = child.attributes.get(ATTR.CLASS) as IfcClass | undefined;

    if (childClass && SPATIAL_TYPES.has(childClass.code)) {
      // Spatial child - recurse
      spatialNode.children.push(buildSpatialNode(child, pathToId, strings));
    } else if (childClass) {
      // Element - add to elements list
      const childId = pathToId.get(child.path);
      if (childId !== undefined) {
        spatialNode.elements.push(childId);
      }
    }
    // Geometry-only children (Body, Axis, etc.) are skipped
  }

  return spatialNode;
}

function populateMaps(
  node: SpatialNode,
  currentStorey: number | null,
  pathToId: Map<string, number>,
  byStorey: Map<number, number[]>,
  byBuilding: Map<number, number[]>,
  bySite: Map<number, number[]>,
  bySpace: Map<number, number[]>,
  storeyElevations: Map<number, number>,
  elementToStorey: Map<number, number>
): void {
  // Update current storey if this is a storey
  if (node.type === IfcTypeEnum.IfcBuildingStorey) {
    currentStorey = node.expressId;
    if (node.elevation !== undefined) {
      storeyElevations.set(node.expressId, node.elevation);
    }
    byStorey.set(node.expressId, []);
  }

  // Add elements to appropriate maps
  for (const elementId of node.elements) {
    if (currentStorey !== null) {
      byStorey.get(currentStorey)?.push(elementId);
      elementToStorey.set(elementId, currentStorey);
    }
  }

  // Recurse to children
  for (const child of node.children) {
    populateMaps(
      child,
      currentStorey,
      pathToId,
      byStorey,
      byBuilding,
      bySite,
      bySpace,
      storeyElevations,
      elementToStorey
    );
  }
}

function createEmptyHierarchy(): SpatialHierarchy {
  return {
    project: {
      expressId: 0,
      type: IfcTypeEnum.IfcProject,
      name: 'Unknown Project',
      children: [],
      elements: [],
    },
    byStorey: new Map(),
    byBuilding: new Map(),
    bySite: new Map(),
    bySpace: new Map(),
    storeyElevations: new Map(),
    elementToStorey: new Map(),
  };
}

function extractName(node: ComposedNode): string | null {
  const name = node.attributes.get('bsi::ifc::prop::Name');
  if (typeof name === 'string') return name;
  const typeName = node.attributes.get('bsi::ifc::prop::TypeName');
  if (typeof typeName === 'string') return typeName;
  return null;
}
```

#### 1.8 Main Parser Entry Point

**File**: `packages/ifcx/src/index.ts`

```typescript
import { IfcxFile, ComposedNode } from './types';
import { composeIfcx, findRoots } from './composition';
import { extractEntities } from './entity-extractor';
import { extractProperties } from './property-extractor';
import { extractGeometry } from './geometry-extractor';
import { buildHierarchy } from './hierarchy-builder';
import { IfcDataStore, StringTable, RelationshipGraph } from '@ifc-lite/data';

export interface IfcxParseResult {
  dataStore: IfcDataStore;
  meshes: MeshData[];
}

/**
 * Parse an IFCX file and return data compatible with existing ifc-lite pipeline.
 */
export async function parseIfcx(buffer: ArrayBuffer): Promise<IfcxParseResult> {
  // 1. Parse JSON
  const text = new TextDecoder().decode(buffer);
  const file: IfcxFile = JSON.parse(text);

  // 2. Validate header
  if (!file.header?.ifcxVersion?.startsWith('ifcx')) {
    throw new Error('Invalid IFCX file: missing or invalid header');
  }

  // 3. Compose ECS nodes
  const composed = composeIfcx(file);

  // 4. Extract data structures
  const strings = new StringTable();

  const { entities, pathToId } = extractEntities(composed, strings);
  const properties = extractProperties(composed, pathToId, strings);
  const hierarchy = buildHierarchy(composed, pathToId, strings);
  const meshes = extractGeometry(composed, pathToId);

  // 5. Build relationship graph (minimal for now)
  const relationships = buildRelationships(composed, pathToId);

  // 6. Assemble data store
  const dataStore: IfcDataStore = {
    schemaVersion: 'IFC5', // New version identifier
    strings,
    entities,
    properties,
    quantities: createEmptyQuantityTable(), // TODO: extract from properties
    relationships,
    spatialHierarchy: hierarchy,
  };

  return { dataStore, meshes };
}

function buildRelationships(
  composed: Map<string, ComposedNode>,
  pathToId: Map<string, number>
): RelationshipGraph {
  // Build basic containment relationships from children
  const builder = new RelationshipGraphBuilder();

  for (const node of composed.values()) {
    const parentId = pathToId.get(node.path);
    if (parentId === undefined) continue;

    for (const child of node.children.values()) {
      const childId = pathToId.get(child.path);
      if (childId !== undefined) {
        builder.addRelationship(
          RelationshipType.ContainsElements,
          parentId,
          childId
        );
      }
    }
  }

  return builder.build();
}

// Re-exports for public API
export * from './types';
export { composeIfcx, findRoots } from './composition';
```

---

### Phase 2: Integration with Existing Pipeline

#### 2.1 Update Main Parser

**File**: `packages/parser/src/index.ts` (additions)

```typescript
import { parseIfcx as parseIfcxImpl } from '@ifc-lite/ifcx';

export async function parseAuto(
  buffer: ArrayBuffer,
  options?: ParseOptions
): Promise<{
  dataStore: IfcDataStore;
  meshes?: MeshData[];
}> {
  const format = detectFormat(buffer);

  switch (format) {
    case 'ifcx': {
      const result = await parseIfcxImpl(buffer);
      return {
        dataStore: result.dataStore,
        meshes: result.meshes,
      };
    }
    case 'ifc4': {
      const dataStore = await parseColumnar(buffer, options);
      return { dataStore };
      // Note: IFC4 meshes come from geometry processor separately
    }
    default:
      throw new Error('Unknown file format');
  }
}
```

#### 2.2 Update Cache Format

**File**: `packages/cache/src/types.ts` (additions)

```typescript
export enum SchemaVersion {
  IFC2X3 = 0,
  IFC4 = 1,
  IFC4X3 = 2,
  IFC5 = 3,  // NEW
}
```

#### 2.3 Update Client Hook

**File**: `apps/viewer/src/hooks/useIfc.ts` (concept)

```typescript
// The hook should work unchanged because parseAuto returns
// the same IfcDataStore interface. The only addition is
// that IFCX files return meshes directly (no geometry processing needed).

async function loadFile(file: File) {
  const buffer = await file.arrayBuffer();
  const format = detectFormat(buffer);

  if (format === 'ifcx') {
    // IFCX: geometry is already tessellated
    const { dataStore, meshes } = await parseAuto(buffer);
    setIfcDataStore(dataStore);
    setGeometryResult({ meshes, totalTriangles: countTriangles(meshes) });
  } else {
    // IFC4: need geometry processing
    const { dataStore } = await parseAuto(buffer);
    setIfcDataStore(dataStore);

    // Start geometry processing in parallel
    for await (const batch of geometryProcessor.processStreaming(buffer)) {
      appendGeometryBatch(batch.meshes);
    }
  }
}
```

---

## Abstraction Strategy for Unstable Features

### Attribute Namespace Registry

To handle evolving attribute namespaces:

```typescript
// packages/ifcx/src/namespace-registry.ts

interface NamespaceHandler {
  extract(value: unknown): unknown;
  validate?(value: unknown): boolean;
}

const namespaceHandlers = new Map<string, NamespaceHandler>([
  ['bsi::ifc::class', {
    extract: (v) => (v as any)?.code,
  }],
  ['bsi::ifc::prop::', {
    extract: (v) => v, // Direct value
  }],
  ['usd::usdgeom::mesh', {
    extract: (v) => v, // Pass through to geometry
  }],
]);

export function getHandler(namespace: string): NamespaceHandler | null {
  // Exact match
  if (namespaceHandlers.has(namespace)) {
    return namespaceHandlers.get(namespace)!;
  }
  // Prefix match
  for (const [prefix, handler] of namespaceHandlers) {
    if (namespace.startsWith(prefix)) {
      return handler;
    }
  }
  return null;
}
```

### Import Resolution (Deferred)

```typescript
// packages/ifcx/src/import-resolver.ts

// For now, just log warnings about unresolved imports
// Future: fetch and cache remote schemas

export async function resolveImports(
  imports: ImportNode[]
): Promise<Map<string, IfcxSchema>> {
  const schemas = new Map<string, IfcxSchema>();

  for (const imp of imports) {
    console.warn(`IFCX import not resolved (not yet implemented): ${imp.uri}`);
    // Future: fetch from ifcx.dev or bundled schemas
  }

  return schemas;
}
```

---

## Testing Strategy

### Example-Driven Testing

Use IFC5 development repository examples as test fixtures:

```typescript
// packages/ifcx/src/__tests__/examples.test.ts

const EXAMPLES = [
  'Hello Wall/hello-wall.ifcx',
  'Hello Wall/hello-wall-add-fire-rating-30.ifcx',
  'Hello Wall/advanced/3rd-window.ifcx',
];

describe('IFCX Examples', () => {
  for (const example of EXAMPLES) {
    it(`should parse ${example}`, async () => {
      const buffer = await loadFixture(example);
      const { dataStore, meshes } = await parseIfcx(buffer);

      expect(dataStore.entities.count).toBeGreaterThan(0);
      expect(meshes.length).toBeGreaterThan(0);
    });
  }
});
```

---

## Development Milestones

### M1: Core Parser (Week 1-2)
- [x] Package structure setup
- [ ] JSON parsing and validation
- [ ] Composition engine (flatten ECS)
- [ ] Basic tests with Hello Wall example

### M2: Geometry Pipeline (Week 2-3)
- [ ] USD mesh extraction
- [ ] Transform accumulation
- [ ] Normal computation
- [ ] Color/opacity from presentation attributes

### M3: Entity Integration (Week 3-4)
- [ ] Entity extraction with type mapping
- [ ] Property extraction
- [ ] Hierarchy building
- [ ] Integration with existing EntityTable

### M4: Full Integration (Week 4-5)
- [ ] Format detection in main parser
- [ ] Cache format updates
- [ ] Client hook updates
- [ ] End-to-end testing

### M5: Polish & Documentation (Week 5-6)
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation
- [ ] Example coverage expansion

---

## Open Questions

1. **Federation**: How should we handle multi-file IFCX loading?
   - Option A: Compose at load time, single data store
   - Option B: Maintain separate data stores, virtual merge at query time

2. **Schema validation**: Should we validate against imported schemas?
   - Recommendation: Skip for now, add later

3. **Versioning**: How to handle ifcxVersion changes?
   - Recommendation: Version-specific parsers with fallback

4. **Caching**: Should IFCX files be cached differently?
   - Recommendation: Same cache format, just mark schema version

---

## References

- [IFC5 Development Repository](https://github.com/buildingSMART/IFC5-development)
- [IFC5 Schema (TypeSpec)](https://github.com/buildingSMART/IFC5-development/tree/main/schema)
- [OpenUSD Geometry Schemas](https://openusd.org/docs/api/usd_geom_page_front.html)
- [USD Transform Operations](https://openusd.org/docs/api/class_usd_geom_xformable.html)

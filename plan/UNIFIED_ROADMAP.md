# IFC-Lite Unified Roadmap

## Vision: Best of All Worlds

Combine the strengths of IfcOpenShell, web-ifc, and ifc-lite into a unified architecture:

| From | Feature | Benefit |
|------|---------|---------|
| **IfcOpenShell** | Rule validation, formal grammar concepts | IFC conformance, correctness |
| **web-ifc** | CRC32 type IDs, serialization, dual-target codegen | Performance, IFC writing |
| **ifc-lite** | TypeScript-first, streaming, WebGPU | Developer experience, web performance |

### Target Architecture

```
                    ┌─────────────────────────────────────┐
                    │     EXPRESS Schema (.exp files)      │
                    └─────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │   Enhanced EXPRESS Parser (Phase 0)  │
                    │   - Regex + PEG.js hybrid            │
                    │   - WHERE/UNIQUE rule extraction     │
                    │   - FUNCTION parsing                 │
                    └─────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │  TypeScript   │  │     Rust      │  │  Validation   │
        │   Generator   │  │   Generator   │  │   Generator   │
        └───────────────┘  └───────────────┘  └───────────────┘
                │                  │                  │
                ▼                  ▼                  ▼
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │ entities.ts   │  │  types.rs     │  │ validators.ts │
        │ schema.ts     │  │  schema.rs    │  │ (WHERE rules) │
        │ serializers.ts│  │  geometry.rs  │  │               │
        └───────────────┘  └───────────────┘  └───────────────┘
                │                  │                  │
                └─────────────────┼──────────────────┘
                                  ▼
                    ┌─────────────────────────────────────┐
                    │         Unified IFC Runtime          │
                    │   - Parse (WASM)                     │
                    │   - Query (TypeScript)               │
                    │   - Geometry (WASM)                  │
                    │   - Validate (TypeScript)            │
                    │   - Serialize (TypeScript)           │
                    │   - Render (WebGPU)                  │
                    └─────────────────────────────────────┘
```

---

## Phase 0: Schema Infrastructure (Foundation)

**Goal**: Build the codegen foundation that powers everything else.

### 0.1 CRC32 Type System

**From web-ifc**: Fast numeric type identification.

```typescript
// packages/codegen/src/crc32.ts
const CRC32_TABLE = buildTable();

export function crc32(str: string): number {
    let crc = 0xFFFFFFFF;
    const upper = str.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ upper.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
}
```

**Generated output** (`type-ids.ts`):
```typescript
/**
 * CRC32 Type IDs for fast entity lookup
 * Generated from EXPRESS schema
 */
export const TYPE_IDS = {
    // Core
    IfcRoot: 0x7F7F7F7F,
    IfcObjectDefinition: 0x12345678,

    // Building Elements
    IfcWall: 3512223829,
    IfcWallStandardCase: 2698829179,
    IfcDoor: 395920057,
    IfcWindow: 1299126871,
    IfcSlab: 1529196076,
    IfcColumn: 843113511,
    IfcBeam: 753842376,

    // Geometry
    IfcExtrudedAreaSolid: 477187591,
    IfcRevolvedAreaSolid: 1856042241,
    IfcBooleanResult: 2736907675,
    // ... 800+ more
} as const;

export type TypeId = typeof TYPE_IDS[keyof typeof TYPE_IDS];

// Reverse lookup
export const TYPE_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(TYPE_IDS).map(([k, v]) => [v, k])
);
```

**Rust integration** (`rust/core/src/types.rs`):
```rust
// Auto-generated from same source
pub const IFCWALL: u32 = 3512223829;
pub const IFCDOOR: u32 = 395920057;
pub const IFCEXTRUDEDAREASOLID: u32 = 477187591;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum IfcTypeId {
    IfcWall = 3512223829,
    IfcDoor = 395920057,
    IfcExtrudedAreaSolid = 477187591,
    // ...
}

impl From<u32> for IfcTypeId {
    fn from(id: u32) -> Self {
        // Fast lookup via match or phf
    }
}
```

### 0.2 Unified Schema Registry

**Enhanced metadata** combining all approaches:

```typescript
// packages/codegen/generated/schema.ts
export interface EntitySchema {
    // Identity
    name: string;
    typeId: number;                    // CRC32 hash (from web-ifc)

    // Inheritance
    parent?: string;
    parentTypeId?: number;
    inheritanceChain: string[];
    subtypes: string[];

    // Attributes
    attributes: AttributeSchema[];
    allAttributes: AttributeSchema[];  // Including inherited

    // Relationships (from web-ifc)
    inverseProps: InversePropertyDef[];

    // Validation (from IfcOpenShell)
    whereRules: WhereRule[];
    uniqueRules: UniqueRule[];

    // Metadata
    isAbstract: boolean;
    isProduct: boolean;               // Has geometry potential
    geometryCategory?: GeometryCategory;
}

export interface AttributeSchema {
    name: string;
    index: number;                    // Position in STEP line
    type: string;
    typeId: number;                   // CRC32 of type
    tsType: string;                   // TypeScript type
    optional: boolean;
    aggregation?: 'LIST' | 'SET' | 'ARRAY';
    bounds?: [number, number];

    // Serialization info
    stepType: StepValueType;          // For writing IFC
}

export interface WhereRule {
    name: string;
    expression: string;               // Original EXPRESS
    compiled?: ValidatorFn;           // Runtime validator
}

export type ValidatorFn = (entity: any, context: ValidationContext) => boolean | null;
```

### 0.3 Serialization Support

**From web-ifc**: Enable IFC writing.

```typescript
// packages/codegen/src/serialization-generator.ts
function generateSerializers(schema: ExpressSchema): string {
    let code = `
import { TYPE_IDS } from './type-ids';
import { SCHEMA } from './schema';

export type StepValue = string | number | boolean | null | StepValue[] | EntityRef;
export interface EntityRef { ref: number; }

/**
 * Serialize entity to STEP format
 */
export function toStepLine(entity: StepEntity): string {
    const schema = SCHEMA.entities[entity.type];
    if (!schema) throw new Error(\`Unknown type: \${entity.type}\`);

    const values = schema.allAttributes.map(attr =>
        serializeValue(entity[attr.name], attr)
    );

    return \`#\${entity.expressId}=\${entity.type.toUpperCase()}(\${values.join(',')});\`;
}

/**
 * Serialize a single value
 */
export function serializeValue(value: any, attr: AttributeSchema): string {
    if (value === null || value === undefined) return '$';
    if (value === '*') return '*';  // Derived

    switch (attr.stepType) {
        case 'INTEGER': return String(Math.round(value));
        case 'REAL': return formatReal(value);
        case 'STRING': return \`'\${escapeString(value)}'\`;
        case 'BOOLEAN': return value ? '.T.' : '.F.';
        case 'LOGICAL': return value === null ? '.U.' : (value ? '.T.' : '.F.');
        case 'ENUM': return \`.\${value}.\`;
        case 'BINARY': return \`"\${value}"\`;
        case 'REF': return \`#\${value.ref}\`;
        case 'LIST':
        case 'SET':
        case 'ARRAY':
            return \`(\${value.map(v => serializeValue(v, attr.elementAttr)).join(',')})\`;
        default:
            return String(value);
    }
}

function formatReal(n: number): string {
    if (!Number.isFinite(n)) return '$';
    const s = n.toExponential(10);
    // Normalize to STEP format
    return s.replace('e', 'E').replace('E+', 'E');
}

function escapeString(s: string): string {
    return s.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "''");
}
`;
    return code;
}
```

**IFC File Writer**:
```typescript
// packages/writer/src/ifc-writer.ts
export class IfcWriter {
    private entities: Map<number, StepEntity> = new Map();
    private nextId = 1;

    constructor(
        private schema: 'IFC2X3' | 'IFC4' | 'IFC4X3' = 'IFC4'
    ) {}

    /**
     * Create a new entity
     */
    create<T extends keyof EntityTypes>(
        type: T,
        attributes: Partial<EntityTypes[T]>
    ): EntityTypes[T] & { expressId: number } {
        const entity = {
            type,
            expressId: this.nextId++,
            ...getDefaults(type),
            ...attributes,
        };
        this.entities.set(entity.expressId, entity);
        return entity as any;
    }

    /**
     * Generate STEP file content
     */
    toStepFile(): string {
        const header = this.generateHeader();
        const data = this.generateData();
        return `ISO-10303-21;
HEADER;
${header}
ENDSEC;
DATA;
${data}
ENDSEC;
END-ISO-10303-21;`;
    }

    private generateHeader(): string {
        return `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('output.ifc','${new Date().toISOString()}',(''),(''),'ifc-lite','ifc-lite','');
FILE_SCHEMA(('${this.schema}'));`;
    }

    private generateData(): string {
        // Sort by expressId for deterministic output
        const sorted = [...this.entities.values()].sort((a, b) => a.expressId - b.expressId);
        return sorted.map(e => toStepLine(e)).join('\n');
    }
}
```

### 0.4 Rust Type Generation

**New generator for Rust code**:

```typescript
// packages/codegen/src/rust-generator.ts
export function generateRustTypes(schema: ExpressSchema): RustOutput {
    return {
        typeIds: generateTypeIds(schema),
        typeEnum: generateTypeEnum(schema),
        schema: generateSchemaStruct(schema),
        geometry: generateGeometryCategories(schema),
    };
}

function generateTypeIds(schema: ExpressSchema): string {
    let code = `//! Auto-generated IFC type IDs
//! DO NOT EDIT

`;
    for (const entity of schema.entities) {
        const id = crc32(entity.name.toUpperCase());
        code += `pub const ${entity.name.toUpperCase()}: u32 = ${id};\n`;
    }
    return code;
}

function generateTypeEnum(schema: ExpressSchema): string {
    return `//! Auto-generated IFC type enum

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IfcType {
${schema.entities.map(e => `    ${e.name},`).join('\n')}
}

impl IfcType {
    pub fn from_id(id: u32) -> Option<Self> {
        match id {
${schema.entities.map(e => `            ${crc32(e.name.toUpperCase())} => Some(Self::${e.name}),`).join('\n')}
            _ => None,
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_uppercase().as_str() {
${schema.entities.map(e => `            "${e.name.toUpperCase()}" => Some(Self::${e.name}),`).join('\n')}
            _ => None,
        }
    }

    pub fn id(&self) -> u32 {
        match self {
${schema.entities.map(e => `            Self::${e.name} => ${crc32(e.name.toUpperCase())},`).join('\n')}
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
${schema.entities.map(e => `            Self::${e.name} => "${e.name}",`).join('\n')}
        }
    }

    pub fn parent(&self) -> Option<Self> {
        match self {
${schema.entities.filter(e => e.supertype).map(e => `            Self::${e.name} => Some(Self::${e.supertype}),`).join('\n')}
            _ => None,
        }
    }

    pub fn is_subtype_of(&self, parent: Self) -> bool {
        let mut current = Some(*self);
        while let Some(t) = current {
            if t == parent { return true; }
            current = t.parent();
        }
        false
    }
}

impl fmt::Display for IfcType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}
`;
}

function generateGeometryCategories(schema: ExpressSchema): string {
    // Categorize geometry types for the router
    const geometryTypes = schema.entities.filter(e =>
        isGeometryType(e, schema)
    );

    return `//! Geometry type categorization

use super::IfcType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryCategory {
    SweptSolid,
    CSG,
    BRep,
    Tessellated,
    Mapped,
    Surface,
    Curve,
    Point,
}

impl IfcType {
    pub fn geometry_category(&self) -> Option<GeometryCategory> {
        match self {
            // Swept solids
            Self::IfcExtrudedAreaSolid |
            Self::IfcExtrudedAreaSolidTapered |
            Self::IfcRevolvedAreaSolid |
            Self::IfcRevolvedAreaSolidTapered |
            Self::IfcSurfaceCurveSweptAreaSolid |
            Self::IfcFixedReferenceSweptAreaSolid |
            Self::IfcSweptDiskSolid |
            Self::IfcSweptDiskSolidPolygonal => Some(GeometryCategory::SweptSolid),

            // CSG
            Self::IfcBooleanResult |
            Self::IfcBooleanClippingResult |
            Self::IfcCsgSolid |
            Self::IfcBlock |
            Self::IfcSphere |
            Self::IfcRightCircularCone |
            Self::IfcRightCircularCylinder |
            Self::IfcRectangularPyramid => Some(GeometryCategory::CSG),

            // BRep
            Self::IfcFacetedBrep |
            Self::IfcFacetedBrepWithVoids |
            Self::IfcAdvancedBrep |
            Self::IfcAdvancedBrepWithVoids |
            Self::IfcManifoldSolidBrep => Some(GeometryCategory::BRep),

            // Tessellated
            Self::IfcTriangulatedFaceSet |
            Self::IfcPolygonalFaceSet |
            Self::IfcTriangulatedIrregularNetwork |
            Self::IfcIndexedPolygonalFace => Some(GeometryCategory::Tessellated),

            // Mapped
            Self::IfcMappedItem => Some(GeometryCategory::Mapped),

            // Surfaces
            Self::IfcBSplineSurface |
            Self::IfcBSplineSurfaceWithKnots |
            Self::IfcRationalBSplineSurfaceWithKnots |
            Self::IfcCylindricalSurface |
            Self::IfcSphericalSurface |
            Self::IfcToroidalSurface |
            Self::IfcPlane |
            Self::IfcCurveBoundedPlane |
            Self::IfcCurveBoundedSurface |
            Self::IfcRectangularTrimmedSurface => Some(GeometryCategory::Surface),

            // Curves
            Self::IfcBSplineCurve |
            Self::IfcBSplineCurveWithKnots |
            Self::IfcRationalBSplineCurveWithKnots |
            Self::IfcCompositeCurve |
            Self::IfcPolyline |
            Self::IfcTrimmedCurve |
            Self::IfcCircle |
            Self::IfcEllipse |
            Self::IfcLine => Some(GeometryCategory::Curve),

            _ => None,
        }
    }
}
`;
}
```

### 0.5 Validation System

**From IfcOpenShell**: Rule compilation for IFC conformance.

```typescript
// packages/codegen/src/rule-compiler.ts

export interface CompiledRule {
    name: string;
    entity: string;
    expression: string;
    validator: ValidatorFn;
}

/**
 * Compile EXPRESS WHERE clause to JavaScript validator
 */
export function compileWhereRule(
    ruleName: string,
    expression: string,
    entity: EntityDefinition,
    schema: ExpressSchema
): CompiledRule {
    // Parse expression to AST
    const ast = parseExpressExpression(expression);

    // Transform to JavaScript
    const jsExpression = transformToJS(ast, entity, schema);

    // Create validator function
    const validator = new Function(
        'entity', 'exists', 'sizeof', 'typeof_', 'usedin', 'context',
        `try {
            return ${jsExpression};
        } catch (e) {
            return null; // Unknown/indeterminate
        }`
    ) as ValidatorFn;

    return {
        name: ruleName,
        entity: entity.name,
        expression,
        validator,
    };
}

/**
 * EXPRESS expression parser (simplified)
 */
function parseExpressExpression(expr: string): ExpressionAST {
    // Handle common patterns:
    // - EXISTS(attr)
    // - SIZEOF(collection) > 0
    // - attr :=: value (instance equal)
    // - attr <> value (not equal)
    // - NOT, AND, OR, XOR
    // - SELF\Entity.Attribute
    // ...
}

/**
 * Transform AST to JavaScript expression
 */
function transformToJS(ast: ExpressionAST, entity: EntityDefinition, schema: ExpressSchema): string {
    switch (ast.type) {
        case 'EXISTS':
            return `exists(entity.${ast.attribute})`;

        case 'NOT':
            return `!(${transformToJS(ast.operand, entity, schema)})`;

        case 'AND':
            return `(${transformToJS(ast.left, entity, schema)} && ${transformToJS(ast.right, entity, schema)})`;

        case 'OR':
            return `(${transformToJS(ast.left, entity, schema)} || ${transformToJS(ast.right, entity, schema)})`;

        case 'EQUAL':
            return `(entity.${ast.left} === ${transformValue(ast.right)})`;

        case 'NOT_EQUAL':
            return `(entity.${ast.left} !== ${transformValue(ast.right)})`;

        case 'SELF_REF':
            // Handle SELF\ParentEntity.Attribute
            return `entity.${ast.attribute}`;

        case 'SIZEOF':
            return `sizeof(entity.${ast.collection})`;

        case 'COMPARISON':
            return `(${transformToJS(ast.left, entity, schema)} ${ast.operator} ${transformToJS(ast.right, entity, schema)})`;

        default:
            return 'true'; // Fallback for unsupported expressions
    }
}

// Helper functions available to validators
export const validationHelpers = {
    exists: (value: any) => value !== null && value !== undefined,
    sizeof: (arr: any[] | null | undefined) => arr?.length ?? 0,
    typeof_: (entity: any) => entity?.type,
    usedin: (entity: any, rel: string) => [], // Would need relationship context
};
```

**Generated validators**:
```typescript
// packages/codegen/generated/validators.ts
import { validationHelpers } from '../validation-helpers';

const { exists, sizeof, typeof_, usedin } = validationHelpers;

export const VALIDATORS: Record<string, Record<string, ValidatorFn>> = {
    IfcWall: {
        WR1: (entity) => {
            // WHERE WR1 : (NOT(EXISTS(PredefinedType))) OR ...
            return (!exists(entity.PredefinedType)) ||
                   (entity.PredefinedType !== 'USERDEFINED') ||
                   ((entity.PredefinedType === 'USERDEFINED') && exists(entity.ObjectType));
        },
    },

    IfcDoor: {
        WR1: (entity) => {
            // WHERE WR1 : EXISTS(SELF\IfcObject.ObjectType)
            return exists(entity.ObjectType);
        },
    },

    // ... more validators
};

/**
 * Validate an entity against all WHERE rules
 */
export function validateEntity(entity: StepEntity): ValidationResult {
    const validators = VALIDATORS[entity.type];
    if (!validators) return { valid: true, errors: [] };

    const errors: ValidationError[] = [];

    for (const [ruleName, validator] of Object.entries(validators)) {
        const result = validator(entity, validationHelpers);
        if (result === false) {
            errors.push({
                entity: entity.expressId,
                type: entity.type,
                rule: ruleName,
                message: `WHERE rule ${ruleName} failed`,
            });
        } else if (result === null) {
            // Indeterminate - could warn
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
```

---

## Phase 1: Geometry Foundation

**Goal**: Core geometry types with unified type system.

### 1.1 Update Geometry Router

Use CRC32 type IDs for fast dispatch:

```rust
// rust/geometry/src/router.rs

use crate::types::{IfcType, GeometryCategory};
use std::collections::HashMap;

pub struct GeometryRouter {
    processors: HashMap<IfcType, Box<dyn GeometryProcessor>>,
    category_handlers: HashMap<GeometryCategory, Box<dyn CategoryHandler>>,
}

impl GeometryRouter {
    pub fn new() -> Self {
        let mut router = Self {
            processors: HashMap::new(),
            category_handlers: HashMap::new(),
        };

        // Register processors by type
        router.register(IfcType::IfcExtrudedAreaSolid, Box::new(ExtrudedAreaSolidProcessor::new()));
        router.register(IfcType::IfcRevolvedAreaSolid, Box::new(RevolvedAreaSolidProcessor::new()));
        router.register(IfcType::IfcTriangulatedFaceSet, Box::new(TriangulatedFaceSetProcessor::new()));
        // ... more registrations

        // Register category handlers as fallbacks
        router.register_category(GeometryCategory::SweptSolid, Box::new(SweptSolidHandler::new()));
        router.register_category(GeometryCategory::CSG, Box::new(CsgHandler::new()));
        router.register_category(GeometryCategory::BRep, Box::new(BrepHandler::new()));

        router
    }

    pub fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
        // Fast lookup by type ID (CRC32)
        if let Some(processor) = self.processors.get(&entity.ifc_type) {
            return processor.process(entity, decoder);
        }

        // Fallback to category handler
        if let Some(category) = entity.ifc_type.geometry_category() {
            if let Some(handler) = self.category_handlers.get(&category) {
                return handler.process(entity, decoder);
            }
        }

        Err(Error::geometry(format!("No processor for type: {}", entity.ifc_type)))
    }
}
```

### 1.2 Revolution Solids

```rust
// rust/geometry/src/processors/revolution.rs

pub struct RevolvedAreaSolidProcessor {
    profile_processor: ProfileProcessor,
    default_segments: usize,
}

impl RevolvedAreaSolidProcessor {
    pub fn new() -> Self {
        Self {
            profile_processor: ProfileProcessor::new(),
            default_segments: 32,
        }
    }

    fn revolve_profile(
        &self,
        profile: &Profile2D,
        axis_point: Point3<f64>,
        axis_dir: Vector3<f64>,
        angle: f64,
        segments: usize,
    ) -> Result<Mesh> {
        let axis_dir = axis_dir.normalize();
        let angle_step = angle / segments as f64;
        let profile_len = profile.outer.len();

        // Pre-allocate buffers
        let vertex_count = (segments + 1) * profile_len;
        let mut positions = Vec::with_capacity(vertex_count * 3);
        let mut normals = Vec::with_capacity(vertex_count * 3);

        // Generate vertices for each angular slice
        for i in 0..=segments {
            let theta = i as f64 * angle_step;
            let rotation = Rotation3::from_axis_angle(&Unit::new_normalize(axis_dir), theta);

            for (j, point) in profile.outer.iter().enumerate() {
                // Transform 2D profile point to 3D on axis plane
                let p3d = self.profile_point_to_3d(point, &axis_point, &axis_dir);

                // Rotate around axis
                let rotated = axis_point + rotation * (p3d - axis_point);

                positions.extend_from_slice(&[
                    rotated.x as f32,
                    rotated.y as f32,
                    rotated.z as f32,
                ]);

                // Normal = radial direction from axis
                let radial = self.compute_radial_normal(&rotated, &axis_point, &axis_dir);
                normals.extend_from_slice(&[
                    radial.x as f32,
                    radial.y as f32,
                    radial.z as f32,
                ]);
            }
        }

        // Generate indices
        let mut indices = Vec::with_capacity(segments * profile_len * 6);
        for i in 0..segments {
            for j in 0..profile_len {
                let next_j = (j + 1) % profile_len;

                let v0 = (i * profile_len + j) as u32;
                let v1 = (i * profile_len + next_j) as u32;
                let v2 = ((i + 1) * profile_len + j) as u32;
                let v3 = ((i + 1) * profile_len + next_j) as u32;

                // Two triangles per quad (CCW winding)
                indices.extend_from_slice(&[v0, v2, v1]);
                indices.extend_from_slice(&[v1, v2, v3]);
            }
        }

        // Add caps if not full revolution
        if angle < std::f64::consts::TAU - 0.001 {
            self.add_cap(&mut positions, &mut normals, &mut indices, profile, &axis_point, &axis_dir, 0.0, true)?;
            self.add_cap(&mut positions, &mut normals, &mut indices, profile, &axis_point, &axis_dir, angle, false)?;
        }

        Ok(Mesh { positions, normals, indices })
    }
}

impl GeometryProcessor for RevolvedAreaSolidProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
        let swept_area = decoder.get_entity_ref(entity, 0)?;
        let profile = self.profile_processor.process(&swept_area, decoder)?;

        let position = decoder.get_optional_entity_ref(entity, 1)?;
        let axis = decoder.get_entity_ref(entity, 2)?;
        let angle: f64 = decoder.get_float(entity, 3)?;

        let axis_point = self.extract_axis_point(&axis, decoder)?;
        let axis_dir = self.extract_axis_direction(&axis, decoder)?;

        let mut mesh = self.revolve_profile(&profile, axis_point, axis_dir, angle, self.default_segments)?;

        // Apply placement if specified
        if let Some(pos) = position {
            let transform = self.extract_placement_transform(&pos, decoder)?;
            mesh.apply_transform(&transform);
        }

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![
            IfcType::IfcRevolvedAreaSolid,
            IfcType::IfcRevolvedAreaSolidTapered,
        ]
    }
}
```

### 1.3 Sweep Solids

```rust
// rust/geometry/src/processors/sweep.rs

pub struct SurfaceCurveSweptAreaSolidProcessor {
    profile_processor: ProfileProcessor,
    curve_processor: CurveProcessor,
    segments_per_unit: usize,
}

impl GeometryProcessor for SurfaceCurveSweptAreaSolidProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
        let swept_area = decoder.get_entity_ref(entity, 0)?;
        let profile = self.profile_processor.process(&swept_area, decoder)?;

        let directrix = decoder.get_entity_ref(entity, 2)?;
        let curve_points = self.curve_processor.discretize(&directrix, decoder)?;

        let ref_surface = decoder.get_entity_ref(entity, 3)?;

        self.sweep_along_curve(&profile, &curve_points, &ref_surface, decoder)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcSurfaceCurveSweptAreaSolid]
    }
}

impl SurfaceCurveSweptAreaSolidProcessor {
    fn sweep_along_curve(
        &self,
        profile: &Profile2D,
        curve_points: &[Point3<f64>],
        ref_surface: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        let n = curve_points.len();
        let profile_len = profile.outer.len();

        let mut positions = Vec::with_capacity(n * profile_len * 3);
        let mut normals = Vec::with_capacity(n * profile_len * 3);

        for i in 0..n {
            // Compute Frenet frame at this point
            let tangent = self.compute_tangent(curve_points, i);
            let surface_normal = self.get_surface_normal(ref_surface, &curve_points[i], decoder)?;

            // Build orthonormal frame
            let binormal = tangent.cross(&surface_normal).normalize();
            let normal = binormal.cross(&tangent).normalize();

            // Transform profile to this frame
            for point in &profile.outer {
                let world_pos = curve_points[i]
                    + normal * point.x
                    + binormal * point.y;

                positions.extend_from_slice(&[
                    world_pos.x as f32,
                    world_pos.y as f32,
                    world_pos.z as f32,
                ]);

                // Approximate normal (radial from curve)
                let approx_normal = (world_pos - curve_points[i]).normalize();
                normals.extend_from_slice(&[
                    approx_normal.x as f32,
                    approx_normal.y as f32,
                    approx_normal.z as f32,
                ]);
            }
        }

        // Generate indices connecting adjacent slices
        let mut indices = Vec::with_capacity((n - 1) * profile_len * 6);
        for i in 0..(n - 1) {
            for j in 0..profile_len {
                let next_j = (j + 1) % profile_len;

                let v0 = (i * profile_len + j) as u32;
                let v1 = (i * profile_len + next_j) as u32;
                let v2 = ((i + 1) * profile_len + j) as u32;
                let v3 = ((i + 1) * profile_len + next_j) as u32;

                indices.extend_from_slice(&[v0, v2, v1]);
                indices.extend_from_slice(&[v1, v2, v3]);
            }
        }

        // Add end caps
        self.add_sweep_caps(&mut positions, &mut normals, &mut indices, profile, curve_points)?;

        Ok(Mesh { positions, normals, indices })
    }
}
```

---

## Phase 2: Boolean & CSG

### 2.1 BSP Tree Implementation

```rust
// rust/geometry/src/bsp.rs

use nalgebra::{Point3, Vector3};

#[derive(Clone)]
pub struct Plane {
    normal: Vector3<f64>,
    d: f64,
}

impl Plane {
    pub fn from_points(a: Point3<f64>, b: Point3<f64>, c: Point3<f64>) -> Self {
        let normal = (b - a).cross(&(c - a)).normalize();
        let d = normal.dot(&a.coords);
        Self { normal, d }
    }

    pub fn signed_distance(&self, point: &Point3<f64>) -> f64 {
        self.normal.dot(&point.coords) - self.d
    }

    pub fn flip(&mut self) {
        self.normal = -self.normal;
        self.d = -self.d;
    }
}

#[derive(Clone)]
pub struct Triangle {
    pub vertices: [Point3<f64>; 3],
    pub normal: Vector3<f64>,
}

pub struct BspNode {
    plane: Option<Plane>,
    front: Option<Box<BspNode>>,
    back: Option<Box<BspNode>>,
    triangles: Vec<Triangle>,
}

impl BspNode {
    pub fn new() -> Self {
        Self {
            plane: None,
            front: None,
            back: None,
            triangles: Vec::new(),
        }
    }

    pub fn from_triangles(triangles: Vec<Triangle>) -> Self {
        let mut node = Self::new();
        node.build(triangles);
        node
    }

    pub fn build(&mut self, triangles: Vec<Triangle>) {
        if triangles.is_empty() {
            return;
        }

        // Use first triangle's plane as splitting plane
        if self.plane.is_none() {
            let t = &triangles[0];
            self.plane = Some(Plane::from_points(t.vertices[0], t.vertices[1], t.vertices[2]));
        }

        let plane = self.plane.as_ref().unwrap();
        let mut front = Vec::new();
        let mut back = Vec::new();

        for tri in triangles {
            self.split_triangle(&tri, plane, &mut self.triangles, &mut self.triangles, &mut front, &mut back);
        }

        if !front.is_empty() {
            self.front = Some(Box::new(BspNode::from_triangles(front)));
        }
        if !back.is_empty() {
            self.back = Some(Box::new(BspNode::from_triangles(back)));
        }
    }

    fn split_triangle(
        &self,
        tri: &Triangle,
        plane: &Plane,
        coplanar_front: &mut Vec<Triangle>,
        coplanar_back: &mut Vec<Triangle>,
        front: &mut Vec<Triangle>,
        back: &mut Vec<Triangle>,
    ) {
        const EPSILON: f64 = 1e-10;

        let mut types = [0i32; 3];
        let mut dists = [0.0f64; 3];

        for i in 0..3 {
            dists[i] = plane.signed_distance(&tri.vertices[i]);
            if dists[i] < -EPSILON {
                types[i] = -1; // Back
            } else if dists[i] > EPSILON {
                types[i] = 1;  // Front
            } else {
                types[i] = 0;  // Coplanar
            }
        }

        let type_sum: i32 = types.iter().sum();

        match type_sum {
            3 => front.push(tri.clone()),      // All front
            -3 => back.push(tri.clone()),      // All back
            0 if types == [0, 0, 0] => {       // Coplanar
                if plane.normal.dot(&tri.normal) > 0.0 {
                    coplanar_front.push(tri.clone());
                } else {
                    coplanar_back.push(tri.clone());
                }
            }
            _ => {
                // Split the triangle
                self.split_triangle_by_plane(tri, plane, &types, &dists, front, back);
            }
        }
    }

    fn split_triangle_by_plane(
        &self,
        tri: &Triangle,
        plane: &Plane,
        types: &[i32; 3],
        dists: &[f64; 3],
        front: &mut Vec<Triangle>,
        back: &mut Vec<Triangle>,
    ) {
        let mut f_verts = Vec::new();
        let mut b_verts = Vec::new();

        for i in 0..3 {
            let j = (i + 1) % 3;
            let vi = tri.vertices[i];
            let vj = tri.vertices[j];

            if types[i] >= 0 {
                f_verts.push(vi);
            }
            if types[i] <= 0 {
                b_verts.push(vi);
            }

            if (types[i] > 0 && types[j] < 0) || (types[i] < 0 && types[j] > 0) {
                // Edge crosses plane - compute intersection
                let t = dists[i] / (dists[i] - dists[j]);
                let intersection = vi + (vj - vi) * t;
                f_verts.push(intersection);
                b_verts.push(intersection);
            }
        }

        // Triangulate and add
        Self::triangulate_and_add(&f_verts, &tri.normal, front);
        Self::triangulate_and_add(&b_verts, &tri.normal, back);
    }

    fn triangulate_and_add(verts: &[Point3<f64>], normal: &Vector3<f64>, output: &mut Vec<Triangle>) {
        if verts.len() >= 3 {
            for i in 1..(verts.len() - 1) {
                output.push(Triangle {
                    vertices: [verts[0], verts[i], verts[i + 1]],
                    normal: *normal,
                });
            }
        }
    }

    pub fn invert(&mut self) {
        for tri in &mut self.triangles {
            tri.vertices.swap(0, 2);
            tri.normal = -tri.normal;
        }

        if let Some(ref mut plane) = self.plane {
            plane.flip();
        }

        std::mem::swap(&mut self.front, &mut self.back);

        if let Some(ref mut front) = self.front {
            front.invert();
        }
        if let Some(ref mut back) = self.back {
            back.invert();
        }
    }

    pub fn clip_to(&mut self, other: &BspNode) {
        self.triangles = other.clip_triangles(&self.triangles);

        if let Some(ref mut front) = self.front {
            front.clip_to(other);
        }
        if let Some(ref mut back) = self.back {
            back.clip_to(other);
        }
    }

    fn clip_triangles(&self, triangles: &[Triangle]) -> Vec<Triangle> {
        if self.plane.is_none() {
            return triangles.to_vec();
        }

        let plane = self.plane.as_ref().unwrap();
        let mut front = Vec::new();
        let mut back = Vec::new();

        for tri in triangles {
            self.split_triangle(tri, plane, &mut front, &mut back, &mut front, &mut back);
        }

        let mut result = if let Some(ref f) = self.front {
            f.clip_triangles(&front)
        } else {
            front
        };

        if let Some(ref b) = self.back {
            result.extend(b.clip_triangles(&back));
        }

        result
    }

    pub fn all_triangles(&self) -> Vec<Triangle> {
        let mut result = self.triangles.clone();

        if let Some(ref front) = self.front {
            result.extend(front.all_triangles());
        }
        if let Some(ref back) = self.back {
            result.extend(back.all_triangles());
        }

        result
    }
}

// Boolean operations
pub fn csg_union(a: &Mesh, b: &Mesh) -> Result<Mesh> {
    let mut a_bsp = BspNode::from_triangles(mesh_to_triangles(a));
    let mut b_bsp = BspNode::from_triangles(mesh_to_triangles(b));

    a_bsp.clip_to(&b_bsp);
    b_bsp.clip_to(&a_bsp);
    b_bsp.invert();
    b_bsp.clip_to(&a_bsp);
    b_bsp.invert();

    a_bsp.build(b_bsp.all_triangles());

    triangles_to_mesh(&a_bsp.all_triangles())
}

pub fn csg_subtract(a: &Mesh, b: &Mesh) -> Result<Mesh> {
    let mut a_bsp = BspNode::from_triangles(mesh_to_triangles(a));
    let mut b_bsp = BspNode::from_triangles(mesh_to_triangles(b));

    a_bsp.invert();
    a_bsp.clip_to(&b_bsp);
    b_bsp.clip_to(&a_bsp);
    b_bsp.invert();
    b_bsp.clip_to(&a_bsp);
    b_bsp.invert();

    a_bsp.build(b_bsp.all_triangles());
    a_bsp.invert();

    triangles_to_mesh(&a_bsp.all_triangles())
}

pub fn csg_intersect(a: &Mesh, b: &Mesh) -> Result<Mesh> {
    let mut a_bsp = BspNode::from_triangles(mesh_to_triangles(a));
    let mut b_bsp = BspNode::from_triangles(mesh_to_triangles(b));

    a_bsp.invert();
    b_bsp.clip_to(&a_bsp);
    b_bsp.invert();
    a_bsp.clip_to(&b_bsp);
    b_bsp.clip_to(&a_bsp);

    a_bsp.build(b_bsp.all_triangles());
    a_bsp.invert();

    triangles_to_mesh(&a_bsp.all_triangles())
}
```

### 2.2 CSG Primitives

```rust
// rust/geometry/src/processors/csg_primitives.rs

pub struct CsgPrimitiveProcessor {
    segments: usize,
}

impl CsgPrimitiveProcessor {
    pub fn new(segments: usize) -> Self {
        Self { segments }
    }

    pub fn process_sphere(&self, radius: f64, position: Option<&Matrix4<f64>>) -> Mesh {
        let stacks = self.segments;
        let slices = self.segments * 2;

        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut indices = Vec::new();

        for i in 0..=stacks {
            let phi = PI * i as f64 / stacks as f64;
            let sin_phi = phi.sin();
            let cos_phi = phi.cos();

            for j in 0..=slices {
                let theta = TAU * j as f64 / slices as f64;

                let x = sin_phi * theta.cos();
                let y = cos_phi;
                let z = sin_phi * theta.sin();

                positions.extend_from_slice(&[
                    (x * radius) as f32,
                    (y * radius) as f32,
                    (z * radius) as f32,
                ]);

                normals.extend_from_slice(&[x as f32, y as f32, z as f32]);
            }
        }

        for i in 0..stacks {
            for j in 0..slices {
                let v0 = i * (slices + 1) + j;
                let v1 = v0 + 1;
                let v2 = v0 + slices + 1;
                let v3 = v2 + 1;

                indices.extend_from_slice(&[v0 as u32, v2 as u32, v1 as u32]);
                indices.extend_from_slice(&[v1 as u32, v2 as u32, v3 as u32]);
            }
        }

        let mut mesh = Mesh { positions, normals, indices };
        if let Some(transform) = position {
            mesh.apply_transform(transform);
        }
        mesh
    }

    pub fn process_cylinder(&self, radius: f64, height: f64, position: Option<&Matrix4<f64>>) -> Mesh {
        let slices = self.segments * 2;
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut indices = Vec::new();

        // Side vertices
        for i in 0..=1 {
            let y = if i == 0 { 0.0 } else { height };

            for j in 0..=slices {
                let theta = TAU * j as f64 / slices as f64;
                let x = theta.cos();
                let z = theta.sin();

                positions.extend_from_slice(&[
                    (x * radius) as f32,
                    y as f32,
                    (z * radius) as f32,
                ]);

                normals.extend_from_slice(&[x as f32, 0.0, z as f32]);
            }
        }

        // Side indices
        for j in 0..slices {
            let v0 = j as u32;
            let v1 = (j + 1) as u32;
            let v2 = (slices + 1 + j) as u32;
            let v3 = (slices + 2 + j) as u32;

            indices.extend_from_slice(&[v0, v2, v1]);
            indices.extend_from_slice(&[v1, v2, v3]);
        }

        // Add caps
        let base_idx = positions.len() / 3;
        self.add_disk_cap(&mut positions, &mut normals, &mut indices, radius, 0.0, -1.0, slices, base_idx);

        let base_idx = positions.len() / 3;
        self.add_disk_cap(&mut positions, &mut normals, &mut indices, radius, height, 1.0, slices, base_idx);

        let mut mesh = Mesh { positions, normals, indices };
        if let Some(transform) = position {
            mesh.apply_transform(transform);
        }
        mesh
    }

    pub fn process_cone(&self, radius: f64, height: f64, position: Option<&Matrix4<f64>>) -> Mesh {
        let slices = self.segments * 2;
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut indices = Vec::new();

        // Apex vertex
        positions.extend_from_slice(&[0.0, height as f32, 0.0]);
        normals.extend_from_slice(&[0.0, 1.0, 0.0]); // Will be smoothed

        // Base ring vertices
        let slope = radius / height;
        let ny = 1.0 / (1.0 + slope * slope).sqrt();
        let nr = slope * ny;

        for j in 0..=slices {
            let theta = TAU * j as f64 / slices as f64;
            let x = theta.cos();
            let z = theta.sin();

            positions.extend_from_slice(&[
                (x * radius) as f32,
                0.0,
                (z * radius) as f32,
            ]);

            normals.extend_from_slice(&[
                (x * nr) as f32,
                ny as f32,
                (z * nr) as f32,
            ]);
        }

        // Side triangles
        for j in 0..slices {
            let v0 = 0u32;  // Apex
            let v1 = (1 + j) as u32;
            let v2 = (2 + j) as u32;

            indices.extend_from_slice(&[v0, v2, v1]);
        }

        // Base cap
        let base_idx = positions.len() / 3;
        self.add_disk_cap(&mut positions, &mut normals, &mut indices, radius, 0.0, -1.0, slices, base_idx);

        let mut mesh = Mesh { positions, normals, indices };
        if let Some(transform) = position {
            mesh.apply_transform(transform);
        }
        mesh
    }

    pub fn process_block(&self, x: f64, y: f64, z: f64, position: Option<&Matrix4<f64>>) -> Mesh {
        // 8 vertices, 12 triangles
        let positions = vec![
            // Front face
            0.0, 0.0, z as f32,  x as f32, 0.0, z as f32,  x as f32, y as f32, z as f32,  0.0, y as f32, z as f32,
            // Back face
            x as f32, 0.0, 0.0,  0.0, 0.0, 0.0,  0.0, y as f32, 0.0,  x as f32, y as f32, 0.0,
            // Left face
            0.0, 0.0, 0.0,  0.0, 0.0, z as f32,  0.0, y as f32, z as f32,  0.0, y as f32, 0.0,
            // Right face
            x as f32, 0.0, z as f32,  x as f32, 0.0, 0.0,  x as f32, y as f32, 0.0,  x as f32, y as f32, z as f32,
            // Top face
            0.0, y as f32, z as f32,  x as f32, y as f32, z as f32,  x as f32, y as f32, 0.0,  0.0, y as f32, 0.0,
            // Bottom face
            0.0, 0.0, 0.0,  x as f32, 0.0, 0.0,  x as f32, 0.0, z as f32,  0.0, 0.0, z as f32,
        ];

        let normals = vec![
            // Front
            0.0, 0.0, 1.0,  0.0, 0.0, 1.0,  0.0, 0.0, 1.0,  0.0, 0.0, 1.0,
            // Back
            0.0, 0.0, -1.0,  0.0, 0.0, -1.0,  0.0, 0.0, -1.0,  0.0, 0.0, -1.0,
            // Left
            -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,
            // Right
            1.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 0.0, 0.0,
            // Top
            0.0, 1.0, 0.0,  0.0, 1.0, 0.0,  0.0, 1.0, 0.0,  0.0, 1.0, 0.0,
            // Bottom
            0.0, -1.0, 0.0,  0.0, -1.0, 0.0,  0.0, -1.0, 0.0,  0.0, -1.0, 0.0,
        ];

        let indices: Vec<u32> = (0..6).flat_map(|face| {
            let base = face * 4;
            vec![base, base + 1, base + 2, base, base + 2, base + 3]
        }).collect();

        let mut mesh = Mesh { positions, normals, indices };
        if let Some(transform) = position {
            mesh.apply_transform(transform);
        }
        mesh
    }
}
```

---

## Phase 3: NURBS & B-Splines

### 3.1 B-Spline Implementation

```rust
// rust/geometry/src/nurbs.rs

use nalgebra::{Point2, Point3, Vector3};

/// B-Spline curve (non-rational)
pub struct BSplineCurve {
    pub degree: usize,
    pub control_points: Vec<Point3<f64>>,
    pub knots: Vec<f64>,
}

/// NURBS curve (rational B-spline)
pub struct NurbsCurve {
    pub degree: usize,
    pub control_points: Vec<Point3<f64>>,
    pub weights: Vec<f64>,
    pub knots: Vec<f64>,
}

impl BSplineCurve {
    pub fn evaluate(&self, t: f64) -> Point3<f64> {
        let span = self.find_span(t);
        let basis = self.basis_functions(span, t);

        let mut point = Point3::origin();
        for i in 0..=self.degree {
            let idx = span - self.degree + i;
            point += self.control_points[idx].coords * basis[i];
        }
        point
    }

    pub fn derivative(&self, t: f64) -> Vector3<f64> {
        let span = self.find_span(t);
        let basis_derivs = self.basis_function_derivatives(span, t, 1);

        let mut deriv = Vector3::zeros();
        for i in 0..=self.degree {
            let idx = span - self.degree + i;
            deriv += self.control_points[idx].coords * basis_derivs[1][i];
        }
        deriv
    }

    pub fn to_polyline(&self, segments: usize) -> Vec<Point3<f64>> {
        let t_min = self.knots[self.degree];
        let t_max = self.knots[self.control_points.len()];
        let dt = (t_max - t_min) / segments as f64;

        (0..=segments)
            .map(|i| self.evaluate(t_min + i as f64 * dt))
            .collect()
    }

    fn find_span(&self, t: f64) -> usize {
        let n = self.control_points.len() - 1;

        if t >= self.knots[n + 1] {
            return n;
        }
        if t <= self.knots[self.degree] {
            return self.degree;
        }

        // Binary search
        let mut low = self.degree;
        let mut high = n + 1;
        let mut mid = (low + high) / 2;

        while t < self.knots[mid] || t >= self.knots[mid + 1] {
            if t < self.knots[mid] {
                high = mid;
            } else {
                low = mid;
            }
            mid = (low + high) / 2;
        }

        mid
    }

    fn basis_functions(&self, span: usize, t: f64) -> Vec<f64> {
        let mut basis = vec![0.0; self.degree + 1];
        let mut left = vec![0.0; self.degree + 1];
        let mut right = vec![0.0; self.degree + 1];

        basis[0] = 1.0;

        for j in 1..=self.degree {
            left[j] = t - self.knots[span + 1 - j];
            right[j] = self.knots[span + j] - t;

            let mut saved = 0.0;
            for r in 0..j {
                let temp = basis[r] / (right[r + 1] + left[j - r]);
                basis[r] = saved + right[r + 1] * temp;
                saved = left[j - r] * temp;
            }
            basis[j] = saved;
        }

        basis
    }

    fn basis_function_derivatives(&self, span: usize, t: f64, n: usize) -> Vec<Vec<f64>> {
        // Returns derivatives 0 through n
        // Implementation follows "The NURBS Book" algorithm
        let mut ders = vec![vec![0.0; self.degree + 1]; n + 1];

        // Compute basis functions and derivatives
        // ... (detailed implementation)

        ders
    }
}

impl NurbsCurve {
    pub fn evaluate(&self, t: f64) -> Point3<f64> {
        // Convert to homogeneous coordinates, evaluate, then project
        let span = self.find_span(t);
        let basis = self.basis_functions(span, t);

        let mut point = Point3::origin();
        let mut weight_sum = 0.0;

        for i in 0..=self.degree {
            let idx = span - self.degree + i;
            let w = self.weights[idx] * basis[i];
            point += self.control_points[idx].coords * w;
            weight_sum += w;
        }

        point / weight_sum
    }

    // Similar methods as BSplineCurve...
}

/// B-Spline surface
pub struct BSplineSurface {
    pub degree_u: usize,
    pub degree_v: usize,
    pub control_points: Vec<Vec<Point3<f64>>>,
    pub knots_u: Vec<f64>,
    pub knots_v: Vec<f64>,
}

impl BSplineSurface {
    pub fn evaluate(&self, u: f64, v: f64) -> Point3<f64> {
        // Tensor product evaluation
        // Evaluate along u first, then v
        let mut temp_points = Vec::new();

        for row in &self.control_points {
            let curve_u = BSplineCurve {
                degree: self.degree_u,
                control_points: row.clone(),
                knots: self.knots_u.clone(),
            };
            temp_points.push(curve_u.evaluate(u));
        }

        let curve_v = BSplineCurve {
            degree: self.degree_v,
            control_points: temp_points,
            knots: self.knots_v.clone(),
        };

        curve_v.evaluate(v)
    }

    pub fn normal(&self, u: f64, v: f64) -> Vector3<f64> {
        let eps = 1e-6;
        let p = self.evaluate(u, v);
        let du = (self.evaluate(u + eps, v) - p) / eps;
        let dv = (self.evaluate(u, v + eps) - p) / eps;
        du.cross(&dv).normalize()
    }

    pub fn tessellate(&self, u_segments: usize, v_segments: usize) -> Mesh {
        let u_range = (self.knots_u[self.degree_u], self.knots_u[self.control_points.len()]);
        let v_range = (self.knots_v[self.degree_v], self.knots_v[self.control_points[0].len()]);

        let mut positions = Vec::new();
        let mut normals = Vec::new();

        for i in 0..=u_segments {
            let u = u_range.0 + (u_range.1 - u_range.0) * i as f64 / u_segments as f64;

            for j in 0..=v_segments {
                let v = v_range.0 + (v_range.1 - v_range.0) * j as f64 / v_segments as f64;

                let p = self.evaluate(u, v);
                let n = self.normal(u, v);

                positions.extend_from_slice(&[p.x as f32, p.y as f32, p.z as f32]);
                normals.extend_from_slice(&[n.x as f32, n.y as f32, n.z as f32]);
            }
        }

        let mut indices = Vec::new();
        for i in 0..u_segments {
            for j in 0..v_segments {
                let v0 = (i * (v_segments + 1) + j) as u32;
                let v1 = v0 + 1;
                let v2 = v0 + (v_segments + 1) as u32;
                let v3 = v2 + 1;

                indices.extend_from_slice(&[v0, v2, v1]);
                indices.extend_from_slice(&[v1, v2, v3]);
            }
        }

        Mesh { positions, normals, indices }
    }
}
```

---

## Phase 4: TypeScript Integration

### 4.1 Updated Package Structure

```
packages/
├── codegen/              # Schema generation
│   ├── src/
│   │   ├── express-parser.ts      # Enhanced parser
│   │   ├── typescript-generator.ts
│   │   ├── rust-generator.ts      # NEW
│   │   ├── crc32.ts               # NEW
│   │   ├── serialization-generator.ts  # NEW
│   │   ├── rule-compiler.ts       # NEW
│   │   └── cli.ts
│   └── generated/
│       ├── ifc4/
│       │   ├── entities.ts
│       │   ├── type-ids.ts        # NEW
│       │   ├── serializers.ts     # NEW
│       │   ├── validators.ts      # NEW
│       │   └── schema.ts          # Enhanced
│       └── rust/                  # NEW
│           ├── type_ids.rs
│           ├── types.rs
│           └── geometry_categories.rs
│
├── writer/               # NEW: IFC writing
│   ├── src/
│   │   ├── ifc-writer.ts
│   │   ├── step-serializer.ts
│   │   └── index.ts
│   └── package.json
│
├── validator/            # NEW: IFC validation
│   ├── src/
│   │   ├── validator.ts
│   │   ├── rules.ts
│   │   └── index.ts
│   └── package.json
│
├── parser/               # Existing (enhanced)
├── geometry/             # Existing (enhanced)
├── query/                # Existing
├── renderer/             # Existing
└── data/                 # Existing
```

### 4.2 API Design

```typescript
// Unified API example

import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { IfcWriter } from '@ifc-lite/writer';
import { validateEntity, validateFile } from '@ifc-lite/validator';
import { TYPE_IDS, toStepLine } from '@ifc-lite/codegen/ifc4';

// Parse
const parser = new IfcParser();
const model = await parser.parse(buffer);

// Query with type IDs (fast)
const walls = model.getByTypeId(TYPE_IDS.IfcWall);

// Geometry
const geometry = new GeometryProcessor();
const meshes = await geometry.processAll(model);

// Validate
const result = validateFile(model);
if (!result.valid) {
    console.error('Validation errors:', result.errors);
}

// Write
const writer = new IfcWriter('IFC4');
const project = writer.create('IfcProject', { Name: 'My Project' });
const site = writer.create('IfcSite', { Name: 'Site' });
// ... build model ...
const ifcContent = writer.toStepFile();
```

---

## Implementation Timeline

### Phase 0: Schema Infrastructure
- [ ] CRC32 type IDs
- [ ] Rust type generation
- [ ] Serialization support
- [ ] Basic validation rules

### Phase 1: Core Geometry
- [ ] Revolution solids
- [ ] Sweep solids
- [ ] Enhanced SweptDiskSolid

### Phase 2: Boolean & CSG
- [ ] BSP tree implementation
- [ ] Boolean operations (union, subtract, intersect)
- [ ] CSG primitives (sphere, cylinder, cone, block)

### Phase 3: NURBS
- [ ] B-spline curves
- [ ] NURBS curves
- [ ] B-spline surfaces
- [ ] Adaptive tessellation

### Phase 4: Integration
- [ ] Writer package
- [ ] Validator package
- [ ] Updated documentation
- [ ] Benchmarks

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Geometry coverage | ~85% | ~95% |
| Type lookup speed | O(n) string | O(1) hash |
| IFC writing | ❌ | ✅ |
| Validation | ❌ | Basic WHERE rules |
| Bundle size | 86 KB | <150 KB |
| Rust type safety | Manual | Generated |

# IFC5 Support Planning Document

## Executive Summary

This document analyzes approaches for extending ifc-lite to support IFC5 (IFCX), the next-generation BIM data exchange format currently in alpha development by buildingSMART.

**Key Finding:** IFC5 represents a fundamental paradigm shift from IFC4, not just a schema update. The move from STEP-based monolithic files to JSON-based Entity Component System (ECS) architecture requires careful consideration of integration strategy.

---

## IFC5 Format Analysis

### Core Differences from IFC4

| Aspect | IFC4 | IFC5 (IFCX) |
|--------|------|-------------|
| **File Format** | STEP (ISO 10303-21) | JSON |
| **Data Model** | Object-oriented inheritance | Entity Component System (ECS) |
| **Entity Identity** | Express IDs (#1, #2, ...) | UUIDs/Paths |
| **Relationships** | Explicit rel entities (IfcRelDefinesByProperties) | Composition via `children`/`inherits` |
| **Geometry** | Parametric (swept solids, booleans) | Pre-tessellated meshes (USD-style) |
| **Multi-file** | Single monolithic file | Federated layers with imports |
| **Schema** | Static EXPRESS schema | Dynamic per-file schema definitions |
| **Properties** | PropertySets with nested structure | Flat attribute namespaces |

### IFCX File Structure

```json
{
  "header": {
    "id": "...",
    "ifcxVersion": "ifcx_alpha",
    "dataVersion": "1.0.0",
    "author": "...",
    "timestamp": "..."
  },
  "imports": [
    { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" }
  ],
  "schemas": {
    "bsi::ifc::prop::FireRating": {
      "value": { "dataType": "Enum", "enumRestrictions": { "options": ["R30", "R60"] } }
    }
  },
  "data": [
    {
      "path": "uuid-1",
      "children": { "Wall": "uuid-2" },
      "inherits": { "type": "uuid-3" },
      "attributes": {
        "bsi::ifc::class": { "code": "IfcWall", "uri": "..." },
        "usd::usdgeom::mesh": { "points": [...], "faceVertexIndices": [...] }
      }
    }
  ]
}
```

### Key IFC5 Concepts

1. **Composition (ECS)**: Objects are composed from path-addressable nodes
2. **Inheritance**: `inherits` field allows type-level data sharing
3. **Layered Federation**: Multiple IFCX files compose together (later wins)
4. **USD Integration**: Geometry uses OpenUSD concepts (`usd::usdgeom::mesh`, `usd::xformop`)
5. **Semantic Attributes**: Namespaced keys like `bsi::ifc::class`, `nlsfb::class`

---

## Current ifc-lite Architecture

### Strengths for IFC5 Integration
- **Version-agnostic design**: Already supports IFC2X3/4/4X3
- **Columnar storage**: EntityTable, PropertyTable work with any schema
- **Generated code**: Codegen pipeline can generate from any schema
- **Schema registry**: Runtime type lookup supports dynamic types

### Challenges for IFC5
- **STEP-centric parser**: Rust parser optimized for STEP tokenization
- **EXPRESS schema assumption**: Entity relationships follow EXPRESS model
- **Implicit geometry**: Current pipeline expects parametric geometry→mesh conversion
- **Single-file model**: No federation/layering support

---

## Approach Options

### Approach 1: Unified Data Model with Dual Parsers

**Strategy**: Add IFCX JSON parser alongside STEP parser, map both to same internal structures.

```
┌─────────────┐    ┌─────────────┐
│ STEP Parser │    │ IFCX Parser │
│   (Rust)    │    │ (TS/Rust)   │
└──────┬──────┘    └──────┬──────┘
       │                  │
       └────────┬─────────┘
                ▼
       ┌────────────────┐
       │ Unified Store  │
       │ (EntityTable,  │
       │  Properties,   │
       │  Relationships)│
       └────────┬───────┘
                ▼
       ┌────────────────┐
       │  Visualization │
       │  Query/Export  │
       └────────────────┘
```

**Pros:**
- Minimal disruption to existing codebase
- Single downstream pipeline for viz/query/export
- Gradual migration path
- Can reuse all existing infrastructure

**Cons:**
- Forces IFC5's ECS model into IFC4-style structures (potential impedance mismatch)
- Loses IFC5 composition/layering semantics
- May not handle IFC5-unique features well (dynamic schemas)
- Geometry is fundamentally different (pre-tessellated vs parametric)

**Effort**: Medium
**Risk**: Medium (semantic loss)

---

### Approach 2: Native ECS Architecture

**Strategy**: Adopt IFC5's ECS model as internal representation; adapt IFC4 loading to populate ECS.

```
┌─────────────┐    ┌─────────────┐
│ STEP Parser │    │ IFCX Parser │
└──────┬──────┘    └──────┬──────┘
       │                  │
       ▼                  │
┌──────────────┐          │
│ IFC4→ECS     │          │
│ Adapter      │          │
└──────┬───────┘          │
       │                  │
       └────────┬─────────┘
                ▼
       ┌────────────────┐
       │  ECS Store     │
       │ (Nodes, Attrs, │
       │  Composition)  │
       └────────┬───────┘
                ▼
       ┌────────────────┐
       │  Visualization │
       │  Query/Export  │
       └────────────────┘
```

**Pros:**
- Future-proof architecture aligned with IFC5
- Full support for composition, layering, federation
- Better semantic preservation
- Cleaner handling of both formats

**Cons:**
- Significant refactor of internal data structures
- IFC4 adapter adds complexity/overhead
- May over-engineer for current IFC4 usage
- Disrupts existing query/export code

**Effort**: High
**Risk**: High (major refactor)

---

### Approach 3: Transform Layer (IFC5→IFC4-like)

**Strategy**: Convert IFCX to IFC4-compatible representation at load time.

```
┌─────────────────┐
│  IFCX File      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ IFCX→IFC4       │
│ Transformer     │
│ (flatten ECS,   │
│  create rels)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Existing Parser │
│ Pipeline        │
└─────────────────┘
```

**Pros:**
- Minimal changes to existing code
- Quick path to basic IFC5 support
- Leverages battle-tested IFC4 pipeline

**Cons:**
- Lossy transformation (ECS→OO loses semantics)
- No layering/federation support
- Ongoing maintenance of transform logic
- May break with future IFC5 changes
- Geometry already pre-tessellated (no parametric→mesh step)

**Effort**: Low-Medium
**Risk**: High (fragile, lossy)

---

### Approach 4: Parallel Subsystems with Shared Visualization

**Strategy**: Maintain separate IFC4 and IFC5 subsystems; share only visualization/export layers.

```
┌─────────────┐         ┌─────────────┐
│ IFC4 Parser │         │ IFC5 Parser │
└──────┬──────┘         └──────┬──────┘
       ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ IFC4 Store  │         │ IFC5 Store  │
│ (current)   │         │ (ECS-based) │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └────────┬──────────────┘
                ▼
       ┌────────────────┐
       │ Unified Scene  │
       │ (GPU buffers,  │
       │  Mesh data)    │
       └────────┬───────┘
                ▼
       ┌────────────────┐
       │  Visualization │
       │  Export        │
       └────────────────┘
```

**Pros:**
- Clean separation of concerns
- Each format handled optimally
- No compromise on either side
- Easier to maintain/evolve independently

**Cons:**
- Code duplication in query/property layers
- Two mental models to maintain
- Harder to unify APIs for consumers
- More total code

**Effort**: Medium-High
**Risk**: Medium (manageable complexity)

---

## Recommended Approach: Phased Hybrid

Given IFC5's alpha status and the differences in geometry handling, we recommend a phased approach:

### Phase 1: Minimal Viable IFC5 Support (Approach 3 variant)

**Goal**: Load and visualize basic IFCX files

1. **IFCX Parser** (TypeScript)
   - Parse JSON structure
   - Resolve composition (flatten inherits/children)
   - Extract geometry from `usd::usdgeom::mesh` attributes

2. **Direct Mesh Pipeline**
   - IFCX geometry is pre-tessellated, bypass parametric geometry engine
   - Feed mesh data directly to GPU buffer builder
   - Map `bsi::ifc::class` to entity types

3. **Basic Property Extraction**
   - Extract `bsi::ifc::prop::*` attributes
   - Map to existing PropertyTable format

**Deliverables:**
- Load single IFCX files
- Visualize 3D geometry
- Basic entity tree
- Property panel support

### Phase 2: Full ECS Integration (Approach 4 elements)

**Goal**: Support federation, layering, and advanced queries

1. **ECS Store Module**
   - Native representation for composed nodes
   - Layered data with provenance tracking
   - Dynamic schema registry

2. **Federation Engine**
   - Multi-file loading with import resolution
   - Layer ordering and conflict resolution
   - Delta files for model changes

3. **Query Adapter**
   - Unified query API across IFC4/IFC5
   - Attribute namespace handling

### Phase 3: Unified Architecture (Long-term, Approach 2 elements)

**Goal**: Single internal model supporting both paradigms

1. **ECS-first internal model**
2. **IFC4 adapter layer**
3. **Unified export pipeline**

---

## Technical Considerations

### Geometry Handling

IFC5 geometry is fundamentally different:

```
IFC4: IfcExtrudedAreaSolid → tessellate → mesh
IFC5: usd::usdgeom::mesh already contains vertices/faces
```

**Recommendation**: Create separate geometry ingestion path for IFCX that bypasses parametric geometry engine.

### Schema/Type System

IFC5 schemas are dynamic and namespace-qualified:

```json
"bsi::ifc::class": { "code": "IfcWall", "uri": "..." }
"nlsfb::class": { "code": "21.21", "uri": "..." }
```

**Recommendation**: Extend type system to handle:
- Namespace prefixes
- URI-based type identification
- Multiple classification systems per entity

### Import Resolution

IFCX files can import external schemas:

```json
"imports": [
  { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" }
]
```

**Recommendation**:
- Bundle common base schemas for offline use
- Cache fetched schemas
- Consider integrity verification

### Coordinate Systems

IFC5 uses USD-style 4x4 transform matrices:

```json
"usd::xformop": {
  "transform": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[x,y,z,1]]
}
```

**Recommendation**: Transform matrix handling already exists; verify row/column order compatibility.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| IFC5 schema changes | High | Medium | Loose coupling, schema versioning |
| Performance regression | Medium | High | Benchmark-driven development |
| Incomplete IFC5 spec | High | Medium | Focus on example coverage first |
| Breaking existing IFC4 | Low | High | Parallel subsystems initially |
| Community adoption lag | Medium | Low | Backward compatibility priority |

---

## Development Milestones

### M1: IFCX Parser Foundation
- [ ] JSON parser for IFCX structure
- [ ] Node composition engine (flatten inherits/children)
- [ ] Basic schema validation

### M2: Geometry Pipeline
- [ ] USD mesh extraction
- [ ] Direct GPU buffer creation
- [ ] Transform matrix handling

### M3: Entity Integration
- [ ] Map bsi::ifc::class to IfcTypeEnum
- [ ] Property extraction from attributes
- [ ] Entity tree construction

### M4: Visualization
- [ ] Material/color from presentation attributes
- [ ] Picking support
- [ ] Property panel integration

### M5: Advanced Features
- [ ] Multi-file federation
- [ ] Layer management
- [ ] Delta/diff support

---

## Conclusion

IFC5 support requires significant architectural consideration due to fundamental paradigm differences. The recommended phased approach allows:

1. Quick wins with basic IFCX loading
2. Proper ECS architecture development without rushing
3. Flexibility to adapt as IFC5 specification evolves

Given IFC5's alpha status, tight coupling should be avoided. The parallel subsystem approach (Approach 4) with shared visualization provides the best balance of capability and maintainability.

---

## References

- [IFC5 Development Repository](https://github.com/buildingSMART/IFC5-development)
- [IFC5 Viewer](https://ifc5.technical.buildingsmart.org/viewer/)
- [buildingSMART IFC Specifications](https://technical.buildingsmart.org/standards/ifc/)
- [OpenUSD Documentation](https://openusd.org/docs/)

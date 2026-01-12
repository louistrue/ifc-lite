# IFC-Lite: Complete Technical Specification

## A High-Performance Browser-Native IFC Platform

**Version:** 2.0.0  
**Author:** Louis / Ltplus AG  
**Date:** January 2026  
**Status:** Technical Specification

---

## Document Structure

This specification is split into multiple parts for readability:

1. **Part 1** (this file): Executive Summary, Architecture Overview
2. **Part 2**: Core Data Structures
3. **Part 3**: Parsing Pipeline
4. **Part 4**: Query System
5. **Part 5**: SQL Integration (DuckDB-WASM)
6. **Part 6**: Export Formats
7. **Part 7**: Implementation Roadmap
8. **Part 8**: API Reference

---

## Executive Summary

IFC-Lite is a **complete IFC data platform** for the browser, not just a geometry library. It combines:

1. **Blazing-fast geometry processing** (from v1 spec)
2. **Hybrid data architecture** for non-geometric data
3. **Multi-modal query interface** (Fluent API, SQL, Graph traversal)
4. **Zero-copy data flow** from parse to GPU to analytics export

### The Core Innovation: Three Data Models, One Interface

```
┌─────────────────────────────────────────────────────────────────┐
│                         IFC File                                │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Streaming Parser                             │
│              (Single pass, ~800ms for 10MB)                     │
└───────────┬─────────────────┬─────────────────┬─────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
┌───────────────────┐ ┌───────────────┐ ┌─────────────────────────┐
│  Columnar Tables  │ │ Relationship  │ │    Geometry Buffers     │
│  (Properties,     │ │    Graph      │ │  (Positions, Normals,   │
│   Quantities)     │ │ (Adjacency)   │ │   Indices, Instances)   │
└─────────┬─────────┘ └───────┬───────┘ └────────────┬────────────┘
          │                   │                      │
          └───────────────────┼──────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Unified Query Interface                       │
│                                                                 │
│   model.walls().where(...).withGeometry()     // Fluent API    │
│   model.sql("SELECT ... FROM ... WHERE ...")  // SQL           │
│   model.entity(123).traverse('ContainedIn')   // Graph         │
│   model.elementsInBounds(aabb)                // Spatial       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│   WebGL/WebGPU  │ │  DuckDB/Arrow   │ │   Parquet/JSON Export   │
│  (Rendering)    │ │  (Analytics)    │ │   (Interoperability)    │
└─────────────────┘ └─────────────────┘ └─────────────────────────┘
```

### Performance Targets

Performance varies significantly by file complexity. See **[Part 10: Remaining Solutions](10-remaining-solutions.md)** for detailed tiered expectations.

| Metric | Current Best | IFC-Lite Target (Tier 2 Typical) |
|--------|--------------|-----------------------------------|
| Bundle size (core) | 500KB-10MB | **<200KB** |
| Parse 10MB IFC (full) | 3-8s | **800-1500ms** (Tier 2) |
| First geometry | 2-5s | **300-500ms** (Tier 2) |
| Property query (all walls) | 100-500ms | **<15ms** |
| SQL join query | N/A in browser | **<50ms** (with DuckDB) |
| Graph traversal (5 hops) | 50-200ms | **<5ms** |
| Memory (10MB IFC) | 150-500MB | **80-180MB** (realistic) |

**Performance Tiers:**
- **Tier 1 (Simple)**: No CSG, <10% instanced → 400-600ms parse, 150-200ms first triangle
- **Tier 2 (Typical)**: Some CSG, 30-50% instanced → 800-1500ms parse, 300-500ms first triangle  
- **Tier 3 (Complex)**: Heavy CSG, MEP, advanced geometry → 2-5s parse, 1-2s first triangle

---

## Part 1: Architecture Overview

### 1.1 Design Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                      DESIGN PRINCIPLES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. HYBRID DATA MODEL                                           │
│     - Columnar tables for bulk queries (properties, quantities) │
│     - Graph structure for relationships                         │
│     - Lazy byte offsets for on-demand parsing                   │
│                                                                 │
│  2. STREAMING FIRST                                             │
│     - First triangles in <200ms                                 │
│     - Progressive data availability                             │
│     - No blocking on full file parse                            │
│                                                                 │
│  3. ZERO-COPY PIPELINES                                         │
│     - ArrayBuffers directly uploadable to GPU                   │
│     - Arrow format for SQL engine                               │
│     - No intermediate transformations                           │
│                                                                 │
│  4. QUERY-OPTIMIZED                                             │
│     - Automatic strategy selection based on query pattern       │
│     - Columnar scans for property filters                       │
│     - Graph traversal for relationships                         │
│     - BVH for spatial queries                                   │
│                                                                 │
│  5. INTEROPERABLE                                               │
│     - ara3d BOS compatible Parquet export                       │
│     - Arrow IPC for analytics tools                             │
│     - glTF for 3D interchange                                   │
│     - JSON-LD for semantic web                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Package Structure

```
@ifc-lite/
├── core                    # Foundation (~20KB)
│   ├── types              # TypeScript definitions
│   ├── utils              # Shared utilities
│   └── errors             # Error types
│
├── parser                  # IFC/STEP parsing (~25KB)
│   ├── tokenizer          # STEP tokenizer
│   ├── scanner            # Entity index builder
│   └── decoder            # On-demand entity decoder
│
├── schema                  # IFC schema support (~15KB)
│   ├── ifc4               # IFC4 type definitions
│   ├── ifc4x3             # IFC4x3 additions
│   └── enums              # Enumeration mappings
│
├── geometry                # Geometry processing (~35KB)
│   ├── representations    # IfcExtrudedAreaSolid, etc.
│   ├── profiles           # Profile triangulation
│   ├── transforms         # Matrix operations
│   └── instances          # IfcMappedItem handling
│
├── data                    # Non-geometric data (~40KB)
│   ├── store              # Hybrid data store
│   ├── columns            # Columnar table management
│   ├── graph              # Relationship graph
│   └── strings            # String interning
│
├── query                   # Query interface (~30KB)
│   ├── fluent             # Fluent API builder
│   ├── sql                # SQL query compiler
│   ├── graph              # Graph traversal
│   └── spatial            # Spatial queries
│
├── spatial                 # Spatial indexing (~20KB)
│   ├── bvh                # Bounding Volume Hierarchy
│   ├── aabb               # Axis-aligned bounding boxes
│   └── frustum            # Frustum culling
│
├── operations              # Geometry operations (~20KB)
│   ├── section            # Section planes
│   ├── clash              # Clash detection
│   └── measure            # Measurements
│
├── csg                     # CSG operations (~300KB WASM, optional)
│   └── manifold           # Manifold WASM wrapper
│
├── export                  # Export formats (~25KB)
│   ├── gltf               # glTF/GLB export
│   ├── parquet            # Parquet export (ara3d compatible)
│   ├── arrow              # Arrow IPC export
│   └── json               # JSON-LD export
│
├── integrations            # Framework integrations (~15KB each)
│   ├── duckdb             # DuckDB-WASM integration
│   ├── react              # React hooks
│   └── vue                # Vue composables
│
└── wasm                    # Rust accelerators (~80KB, optional)
    ├── parser             # Fast tokenizer
    ├── triangulate        # Profile triangulation
    └── bvh                # BVH construction
```

### 1.3 Bundle Sizes

| Configuration | Size (gzipped) | Use Case |
|---------------|----------------|----------|
| Core only (parse + basic query) | ~135KB | Data extraction, validation |
| + Full geometry | ~170KB | Visualization |
| + DuckDB-WASM | ~4.5MB | Full SQL analytics |
| + CSG (Manifold) | ~470KB | Boolean operations |
| + WASM accelerators | ~250KB | Large model performance |
| Everything | ~5MB | Full-featured application |

### 1.4 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              IFC FILE                                       │
│                         (ArrayBuffer input)                                 │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     PHASE 1: SCAN         │
                    │   Build Entity Index      │
                    │   (~50ms for 10MB)        │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    PHASE 2: EXTRACT       │
                    │  Parallel data streams    │
                    └──┬──────────┬──────────┬──┘
                       │          │          │
         ┌─────────────▼───┐ ┌────▼────┐ ┌───▼─────────────┐
         │   Properties    │ │ Rels    │ │    Geometry     │
         │   Stream        │ │ Stream  │ │    Stream       │
         └────────┬────────┘ └────┬────┘ └────────┬────────┘
                  │               │               │
    ┌─────────────▼───────────────▼───────────────▼─────────────┐
    │                     PHASE 3: BUILD                        │
    │              Construct optimized structures               │
    └──┬──────────────────┬──────────────────┬─────────────────┬┘
       │                  │                  │                 │
┌──────▼──────┐   ┌───────▼───────┐  ┌───────▼───────┐ ┌───────▼───────┐
│  Columnar   │   │ Relationship  │  │   Geometry    │ │   Spatial     │
│  Tables     │   │    Graph      │  │   Buffers     │ │    Index      │
│             │   │               │  │               │ │    (BVH)      │
│ - Entities  │   │ - Forward     │  │ - Positions   │ │               │
│ - Props     │   │ - Inverse     │  │ - Normals     │ │ - AABB tree   │
│ - Quants    │   │ - Typed edges │  │ - Indices     │ │ - Express IDs │
│ - Strings   │   │               │  │ - Instances   │ │               │
└──────┬──────┘   └───────┬───────┘  └───────┬───────┘ └───────┬───────┘
       │                  │                  │                 │
       └──────────────────┴────────┬─────────┴─────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      UNIFIED QUERY API      │
                    │                             │
                    │  Automatic strategy selection│
                    │  based on query pattern     │
                    └──────────────┬──────────────┘
                                   │
         ┌────────────┬────────────┼────────────┬────────────┐
         ▼            ▼            ▼            ▼            ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ WebGL/  │ │ DuckDB  │ │ Parquet │ │  Arrow  │ │  JSON   │
    │ WebGPU  │ │  SQL    │ │ Export  │ │   IPC   │ │   LD    │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

### 1.5 Query Strategy Selection

The query engine automatically selects the optimal execution strategy:

| Query Pattern | Strategy | Data Structure |
|---------------|----------|----------------|
| Filter by property value | Columnar scan | PropertyTable |
| Filter by type | Type index lookup | EntityTable.typeRanges |
| Navigate relationships | Graph traversal | RelationshipGraph |
| Spatial bounds query | BVH traversal | SpatialIndex |
| Complex joins | SQL execution | DuckDB-WASM |
| Single entity lookup | Hash map | EntityIndex.byId |

```typescript
// Example: Query engine decides strategy
const query = model.walls()
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)  // → Columnar scan
  .onStorey(storeyId)                                         // → Graph lookup
  .inBounds(aabb)                                             // → BVH query
  .includeGeometry();                                         // → Geometry fetch

// Execution plan:
// 1. Get wall IDs from type index (fast)
// 2. Filter by property using columnar scan (bulk efficient)
// 3. Intersect with storey elements from graph (set operation)
// 4. Intersect with BVH spatial query (geometric filter)
// 5. Fetch geometry for final results (lazy load)
```

### 1.6 Memory Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                     MEMORY LAYOUT                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Source Buffer (retained for lazy parsing)               │   │
│  │ [Original IFC file bytes - memory mapped if possible]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Entity Index (compact references)                       │   │
│  │ Map<expressId → {type, offset, length}>                 │   │
│  │ ~20 bytes per entity                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Columnar Tables (typed arrays)                          │   │
│  │                                                         │   │
│  │  EntityTable:     Uint32 + Uint16 + Uint32... per row  │   │
│  │  PropertyTable:   Uint32 + Uint32 + Float64... per row │   │
│  │  QuantityTable:   Uint32 + Float64... per row          │   │
│  │                                                         │   │
│  │  ~50-100 bytes per entity (varies by property count)   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ String Table (deduplicated)                             │   │
│  │ Single copy of each unique string                       │   │
│  │ ~10-30% of original property string data                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Relationship Graph (CSR format)                         │   │
│  │ ~16 bytes per relationship                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Geometry Buffers (GPU-ready)                            │   │
│  │                                                         │   │
│  │  Positions: Float32Array [x,y,z, x,y,z, ...]           │   │
│  │  Normals:   Float32Array [nx,ny,nz, ...]               │   │
│  │  Indices:   Uint32Array  [i0,i1,i2, ...]               │   │
│  │                                                         │   │
│  │  ~24 bytes per vertex + 12 bytes per triangle          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Spatial Index (BVH)                                     │   │
│  │ ~64 bytes per node, O(n) nodes for n meshes            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

TOTAL MEMORY (10MB IFC, ~50K entities, ~10K geometric elements):

  Source buffer:     10 MB (can be released after parse)
  Entity index:       1 MB
  Columnar tables:    5 MB
  String table:       2 MB
  Relationship graph: 1 MB
  Geometry buffers:  40 MB (varies greatly by model complexity)
  Spatial index:      1 MB
  ─────────────────────────
  TOTAL:            ~60 MB (with source retained)
                    ~50 MB (source released)
```

---

## Critical Implementation Notes

Several areas require special attention during implementation. See **[Part 8: Critical Solutions](08-critical-solutions.md)** for detailed strategies on:

1. **CSG/Boolean Operations** - 3-tier strategy for geometry processing
2. **Opening Processing** - IfcRelVoidsElement handling  
3. **Coordinate Systems** - Placement chain resolution and large coordinates
4. **Error Handling** - Graceful degradation with malformed files
5. **Unit Conversion** - IfcUnitAssignment processing
6. **Streaming Dependencies** - Forward reference resolution

Also see **[Part 9: Geometry Pipeline Details](09-geometry-pipeline-details.md)** for comprehensive profile, curve, and extrusion processing specifications.

---

*Continue to Part 2: Core Data Structures*

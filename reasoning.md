# Why Build Another IFC Library?

## The Short Answer

> "web-ifc is a geometry engine. I'm building a data platform. Different problems."

---

## The Honest Assessment of Existing Options

### web-ifc

**What it is:** C++ IFC geometry kernel compiled to WASM. Excellent at turning IFC geometry into triangles.

**What it's good at:**
- Triangulation (best open-source option)
- Geometry coverage (handles most IFC types)
- Speed (C++ compiled to WASM)

**What it's not designed for:**
```typescript
// web-ifc: Load everything, get triangles
const modelID = ifcApi.OpenModel(buffer);      // Blocks until fully parsed
const geometry = ifcApi.LoadAllGeometry(modelID); // All or nothing

// What I need: Stream progressively, query flexibly
for await (const entity of parser.stream(file)) {
  // Show geometry as it loads
  // User can navigate while loading continues
}

// Query without loading everything
const fireWalls = await model.query()
  .walls()
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)
  .execute();
```

**The gap:** web-ifc is batch-oriented. Load file → process → get result. No streaming, no incremental loading, no SQL queries, no columnar storage.

---

### Fragments (ThatOpen/IFC.js)

**What it is:** A binary format that pre-processes IFC into viewer-optimized chunks.

**What it's good at:**
- Fast loading (pre-triangulated)
- Viewer integration (designed for their viewer)
- Handles large models

**What it's not designed for:**
```typescript
// Fragments: Convert once, view many times
const fragments = await converter.convert(ifcFile);  // Preprocessing step
await viewer.load(fragments);

// What I need: Direct IFC, no conversion step
await viewer.load(ifcFile);  // User drops IFC, sees it immediately

// Fragments: Opinionated format
// - Tied to ThatOpen ecosystem
// - Can't use with other tools
// - Loses some IFC fidelity in conversion

// What I need: Standards-based output
await exporter.toParquet(model);  // Analytics in DuckDB
await exporter.toGLTF(model);     // Use in any 3D tool
await exporter.toArrow(model);    // Data science pipelines
```

**The gap:** Fragments solves "how to view IFC fast" by converting to a proprietary format. I want to solve "how to work with IFC natively" without format lock-in.

---

## The Architectural Differences

```
web-ifc / Fragments approach:
─────────────────────────────

  IFC File ──→ [WASM Parser] ──→ [Full Parse] ──→ Triangles
                    │                               │
                    └── All in C++/WASM ────────────┘
                    
  - Monolithic
  - Batch processing
  - Geometry-focused
  - Opaque (hard to extend)


IFC-Lite approach:
──────────────────

  IFC File ──→ [Stream Scanner] ──→ [Entity Index] ──→ [Lazy Properties]
                    │                     │                    │
                    │                     ▼                    │
                    │              [Columnar Store] ◄──────────┘
                    │                     │
                    ▼                     ▼
            [On-demand Parse] ──→ [Triangulate] ──→ GPU
                    │                     │
                    ▼                     ▼
            [Query Engine] ◄───── [Relationship Graph]
                    │
                    ▼
            [Export: Parquet/Arrow/glTF]
                    
  - Modular
  - Streaming
  - Data + Geometry
  - Extensible
```

---

## Specific Use Cases web-ifc/Fragments Don't Serve Well

### 1. Progressive Loading for Huge Files

```typescript
// User drops 500MB file
// With web-ifc: Wait 30+ seconds, stare at spinner
// With IFC-Lite: See building in 2 seconds, navigate while loading

for await (const batch of parser.stream(file)) {
  renderer.addGeometry(batch);
  ui.updateProgress(batch.progress);
  // User is already exploring the model
}
```

### 2. SQL Analytics on Building Data

```typescript
// "What's the total area of all fire-rated walls by floor?"
// With web-ifc: Write custom JS, iterate everything, slow
// With IFC-Lite: SQL query on columnar data, fast

const report = await model.sql(`
  SELECT 
    storey.name,
    SUM(wall.area) as total_area,
    COUNT(*) as wall_count
  FROM walls wall
  JOIN properties p ON wall.id = p.entity_id
  JOIN storeys storey ON wall.storey_id = storey.id
  WHERE p.pset = 'Pset_WallCommon' 
    AND p.name = 'FireRating' 
    AND p.value >= 60
  GROUP BY storey.name
`);
```

### 3. Integration with Data Science Tools

```typescript
// Export to Parquet for analysis in Python/DuckDB/Spark
// With web-ifc: Not possible, geometry-only
// With IFC-Lite: First-class export

await model.export.toParquet('./building-data.parquet');

// In Python:
import duckdb
df = duckdb.read_parquet('building-data.parquet')
df.groupby('element_type').agg({'area': 'sum'}).show()
```

### 4. Custom Viewer Integration

```typescript
// Use geometry in my own renderer (not ThatOpen's viewer)
// With Fragments: Designed for their viewer, awkward otherwise
// With IFC-Lite: Clean geometry buffers, use anywhere

const mesh = await model.entity(wallId).geometry();
// mesh.positions: Float32Array - standard format
// mesh.indices: Uint32Array - standard format
// mesh.normals: Float32Array - standard format

myCustomRenderer.addMesh(mesh);  // Works with any WebGPU/WebGL renderer
```

### 5. Embedded Use in Other Products

```typescript
// Embed in ifcrender.com, modelhealthcheck.com, etc.
// With web-ifc: Can do, but no streaming, no query
// With Fragments: Brings entire ThatOpen ecosystem, heavy

// IFC-Lite: Tree-shakeable, take only what you need
import { IfcParser } from 'ifc-lite/parser';     // 50KB
import { PropertyTable } from 'ifc-lite/props';  // 20KB
// Total: 70KB vs 500KB+ for full frameworks
```

---

## The Honest Trade-offs

| Aspect | web-ifc/Fragments | IFC-Lite |
|--------|-------------------|----------|
| **Maturity** | Production-ready | New (risk) |
| **Community** | Established | Starting |
| **Geometry coverage** | Excellent | Must match |
| **Streaming** | No | Yes |
| **Query/SQL** | No | Yes |
| **Bundle size** | ~500KB+ | Target <200KB |
| **Vendor lock-in** | ThatOpen ecosystem | None (standards) |
| **Export formats** | Limited | Parquet, Arrow, glTF |
| **IFC versions** | IFC2X3/4 | IFC2X3/4/4X3 (with normalization) |
| **Performance** | Single tier | Tiered (complexity-aware) |

---

## When to Use What

```
USE web-ifc WHEN:
─────────────────
├── You just need triangles
├── Batch processing is fine
├── You're already in ThatOpen ecosystem
└── You need production-ready today

USE IFC-Lite WHEN:
──────────────────
├── You need streaming for large files
├── You need SQL queries on properties
├── You need data export (Parquet, Arrow)
├── You're building a custom viewer
├── You want tree-shakeable modules
└── You want standards-based output

USE BOTH:
─────────
├── IFC-Lite for parsing + data + streaming
└── web-ifc's geometry kernel for triangulation (if we can extract it)
```

---

## The Strategic Answer

> "I'm not replacing web-ifc's geometry engine - it's excellent. I'm building the data layer that doesn't exist: streaming, columnar storage, SQL queries, and standards-based export. Think of it as 'what if DuckDB met IFC' rather than 'another IFC parser'."

---

## The Portfolio Answer (for Ltplus context)

> "We have 20+ BIM applications. Each one reinvents IFC loading. web-ifc solves viewing, but we need:
> - Fast property queries for validation tools
> - Streaming for cloud-based rendering
> - Parquet export for analytics dashboards
> - Small bundle for embedded widgets
> 
> One library that does all of this, maintained by us, pays for itself across the product portfolio."

---

## The Diplomatic Answer (for the community)

> "web-ifc and Fragments are great for their use cases. I'm exploring a different architecture - streaming-first, columnar storage, SQL queries - that might work better for some scenarios. 
>
> If it works, maybe some ideas flow back to the ecosystem. If not, I've learned a lot and web-ifc is still there. Open source isn't zero-sum."

---

## The Technical Purity Answer

> "web-ifc is a geometry engine with parsing bolted on. Fragments is a viewer format with IFC support. Neither is designed as a general-purpose IFC data platform.
>
> I want the IFC equivalent of what Arrow/Parquet did for data: a columnar, streaming, interoperable foundation that multiple tools can build on."

---

## What If They're Right?

Maybe we discover that:
- Streaming isn't worth the complexity
- Columnar storage doesn't help for typical queries  
- web-ifc's geometry kernel is too entangled to extract

**That's what the feasibility phase is for.** 

If spikes fail, we know early. We haven't committed to full development on an assumption.
# IFC-Lite: Complete Technical Specification

## A High-Performance Browser-Native IFC Platform

**Version:** 2.0.0  
**Author:** Louis / Ltplus AG  
**Date:** January 2026  
**Status:** Technical Specification

---

## Document Index

| Part | Title | Description |
|------|-------|-------------|
| [01](01-overview-architecture.md) | Overview & Architecture | Executive summary, design philosophy, package structure |
| [02](02-core-data-structures.md) | Core Data Structures | Entity index, columnar tables, relationship graph, geometry store |
| [03](03-parsing-pipeline.md) | Parsing Pipeline | STEP tokenizer, entity extraction, streaming parser |
| [04](04-query-system.md) | Query System | Fluent API, SQL integration, graph traversal |
| [05](05-export-formats.md) | Export Formats | Parquet (ara3d), glTF, CSV, JSON-LD |
| [06](06-implementation-roadmap.md) | Implementation Roadmap | Timeline, milestones, resources, testing |
| [07](07-api-reference.md) | API Reference | Quick reference, common patterns |
| [08](08-critical-solutions.md) | **Critical Solutions** | CSG/Boolean ops, error handling, large coordinates, streaming |
| [09](09-geometry-pipeline-details.md) | **Geometry Pipeline** | Profiles, curves, extrusion, mesh repair |
| [10](10-remaining-solutions.md) | **Remaining Solutions** | Performance tiers, memory budgets, versioning, compatibility |

### Viewer Specification

| Part | Title | Description |
|------|-------|-------------|
| [V-01](viewer/01-overview-architecture.md) | Viewer Overview | Vision, performance targets, tech stack |
| [V-02](viewer/02-rendering-pipeline.md) | Rendering Pipeline | WebGPU, LOD, culling, instancing |
| [V-03](viewer/03-data-management.md) | Data Management | Streaming, memory, caching |
| [V-04](viewer/04-ui-and-implementation.md) | UI & Implementation | Controls, tools, timeline |

---

## Executive Summary

IFC-Lite is a **complete IFC data platform** for the browser combining:

1. **Blazing-fast geometry processing** - First triangle in 150-500ms (varies by complexity)
2. **Hybrid data architecture** - Columnar tables + Graph + Lazy parsing
3. **Multi-modal query interface** - Fluent API, SQL, Graph traversal
4. **Zero-copy data flow** - Parse → GPU → Analytics export

### Key Performance Targets

Performance varies by file complexity. See **[Part 10: Remaining Solutions](10-remaining-solutions.md)** for tiered expectations.

| Metric | Competition | IFC-Lite (Tier 2 Typical) |
|--------|-------------|---------------------------|
| Bundle size | 500KB-10MB | **<200KB** |
| Parse 10MB | 3-8s | **800-1500ms** (varies by complexity) |
| First triangle | 2-5s | **300-500ms** (Tier 2) |
| Property query | 100-500ms | **<15ms** |
| Memory (10MB) | 150-500MB | **80-180MB** (realistic) |

*Tier 1 (simple): 400-600ms parse | Tier 3 (complex): 2-5s parse*

### Strategic Value for Ltplus AG

- **ifcrender.com** - 10x faster browser rendering
- **modelhealthcheck.com** - Client-side geometry validation  
- **ifcclassify.com** - Real-time visual classification
- **ifcflow.com** - Embedded lightweight viewer
- **BFH teaching** - Clean, documented codebase

---

## Quick Start Example

```typescript
import { IfcParser, IfcQuery } from '@ifc-lite/core';

// Parse IFC file
const parser = new IfcParser();
const store = await parser.parse(arrayBuffer);

// Query with fluent API
const model = new IfcQuery(store);
const fireWalls = await model.walls()
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)
  .includeGeometry()
  .execute();

// Export to glTF
const gltf = new GLTFExporter(store);
const glb = await gltf.exportGLB();

// SQL analytics
const report = await model.sql(`
  SELECT type, COUNT(*), SUM(q.value) as total_area
  FROM entities e
  JOIN quantities q ON q.entity_id = e.express_id
  GROUP BY type
`);
```

---

## Recommendation

**Proceed with development.**

**Rationale:**
1. Strategic value strengthens entire Ltplus product portfolio
2. Manageable investment over 8 months
3. Low risk: modular design allows partial delivery
4. Market timing: window before competition catches up
5. Educational alignment: supports BFH teaching mission

---

## Next Steps

1. **Assign lead developer**
2. **Publish intent** (blog post, gather feedback)
3. **Contact ara3d** (explore Parquet compatibility)
4. **Set up repository** (monorepo with packages)

---

*For detailed technical information, see the individual specification parts.*

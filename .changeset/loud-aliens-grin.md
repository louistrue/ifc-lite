---
 '@ifc-lite/geometry': patch
 '@ifc-lite/renderer': patch
---

Add the first metadata-first geometry foundation for progressive viewer loading.

This introduces huge-geometry metadata and stats types in `@ifc-lite/geometry`, plus a huge-batch streaming path that can pre-batch large parallel geometry loads before they reach the viewer. `@ifc-lite/renderer` now owns huge-batch ingestion and metadata/bounds registries, while the viewer has shared geometry summary helpers, huge-geometry store state, and streaming support so hierarchy, toolbar, status, overlay, basket visibility, and IDS color flows no longer depend solely on `geometryResult.meshes.length`.

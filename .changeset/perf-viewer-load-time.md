---
"@ifc-lite/viewer": patch
---

Improve large-file load performance targeting ~3–5 s savings on a 326 MB IFC file.

- Replace O(total_accumulated) `.reduce()` calls in `appendGeometryBatch` with O(batch_size) incremental totals
- Defer data model parser to after geometry streaming completes (no main-thread CPU contention with WASM)
- Accumulate color updates locally during streaming; apply single `updateMeshColors()` at complete
- Disable IndexedDB caching for files above 150 MB (source buffer required for on-demand extraction)

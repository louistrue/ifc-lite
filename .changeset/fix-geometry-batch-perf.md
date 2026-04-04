---
"@ifc-lite/geometry": patch
"@ifc-lite/wasm": patch
---

Fix geometry processing hang on models with 500K+ geometry elements

Cache entity index from buildPrePassOnce and reuse it across processGeometryBatch calls, eliminating redundant full-file scans. Cap batch count at 30 to prevent excessive per-batch overhead for models with very high geometry element counts.

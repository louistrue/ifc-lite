---
"@ifc-lite/renderer": patch
---

perf: optimize rendering with buffer pooling and frustum culling

- Add pooled per-frame uniform scratch buffers to eliminate GC pressure from per-batch Float32Array allocations
- Add frustum culling for batched meshes to skip entire batches outside camera view
- Build uniform template once per frame with only per-batch color patched, reducing redundant writes
- Skip post-processing (contact shading, separation lines) during rapid camera interaction for faster frame times

---
"@ifc-lite/renderer": minor
---

Fix GPU buffer overflow on large models and optimize streaming performance

- Automatically split color-grouped batches into sub-batches that fit within WebGPU's maxBufferSize limit, preventing createBuffer() failures on large IFC models (1+ GB with 10M+ elements)
- Introduce lightweight fragment batches during streaming to eliminate O(N²) rebuild cost — fragments render immediately and are merged into final batches on stream completion

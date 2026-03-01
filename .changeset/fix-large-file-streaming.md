---
"@ifc-lite/geometry": patch
"@ifc-lite/wasm": patch
---

fix: support large IFC files (700MB+) in geometry streaming

- Add error handling to `collectInstancedGeometryStreaming()` to prevent infinite hang when WASM fails
- Add adaptive batch sizing for large files in `processInstancedStreaming()`
- Add 0-result detection warnings when WASM returns no geometry
- Replace `content.clone()` with `Option::take()` in all async WASM methods to halve peak memory usage

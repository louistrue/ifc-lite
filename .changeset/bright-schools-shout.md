---
'@ifc-lite/geometry': patch
'@ifc-lite/wasm': patch
---

Fix large direct `GeometryProcessor.processStreaming()` and `processInstancedStreaming()` calls by switching oversized IFC inputs to the existing byte-based WASM pre-pass and batch pipeline instead of decoding the entire file into a single JavaScript string first, and expose the supporting byte-based instanced batch API from `@ifc-lite/wasm`.

---
'@ifc-lite/geometry': patch
---

Fix large direct `GeometryProcessor.processStreaming()` calls by switching oversized IFC inputs to the existing byte-based WASM pre-pass and batch pipeline instead of decoding the entire file into a single JavaScript string first.

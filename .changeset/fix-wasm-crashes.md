---
"@ifc-lite/wasm": minor
---

Remove wasm-bindgen-rayon thread infrastructure and rebuild WASM binary without atomics/shared-memory. Pin wasm-bindgen to 0.2.106. Add `parseMeshesSubset`, `buildPrePassOnce`, and `processGeometryBatch` APIs for parallel Web Worker geometry processing. Enable WASM SIMD128 for faster geometry math. Fix exponential triangle growth in rectangular opening clipping by merging adjacent openings. Add NaN guards and bounds checks in clipping code. Reduce boolean recursion depth limit to prevent stack overflow.

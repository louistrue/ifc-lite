---
"@ifc-lite/geometry": minor
---

Add Web Worker parallel geometry processing. Pre-pass runs once on a dedicated worker, then geometry is split across multiple workers using SharedArrayBuffer for zero-copy file sharing. Disable wasm-bindgen-rayon initThreadPool (incompatible with Vite production builds). Switch from async streaming to optimized single-call processing for maximum throughput.

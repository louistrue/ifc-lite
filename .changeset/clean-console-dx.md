---
"@ifc-lite/parser": patch
"@ifc-lite/geometry": patch
"@ifc-lite/data": patch
"@ifc-lite/export": patch
"@ifc-lite/wasm": patch
---

Fix WASM safety, improve DX, and add test infrastructure

- Replace 60+ unsafe unwrap() calls with safe JS interop helpers in WASM bindings
- Clean console output with single summary line per file load
- Pure client-side by default (no CORS errors in production)
- Add unit tests for StringTable, GLTFExporter, store slices
- Add WASM contract tests and integration pipeline tests
- Fix TypeScript any types and data corruption bugs

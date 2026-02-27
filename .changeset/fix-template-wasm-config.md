---
"create-ifc-lite": patch
---

Fix WASM loading in threejs template: revert to `optimizeDeps.exclude: ['@ifc-lite/wasm']` (matching the working example). `vite-plugin-wasm` was incorrect — the wasm-bindgen `new URL('ifc-lite_bg.wasm', import.meta.url)` pattern works correctly when the package is excluded from Vite pre-bundling.

---
"create-ifc-lite": patch
---

Fix WASM loading in threejs template: add `vite-plugin-wasm` and `vite-plugin-top-level-await` to vite config. Without these plugins Vite cannot serve the `.wasm` file with the correct `application/wasm` MIME type, causing a `CompileError: wasm validation error` at runtime.

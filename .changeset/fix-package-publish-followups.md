---
'@ifc-lite/mutations': patch
'@ifc-lite/server-bin': patch
'@ifc-lite/wasm': patch
---

Remove the unused `@ifc-lite/parser` runtime dependency from `@ifc-lite/mutations`, switch `@ifc-lite/server-bin` postinstall to a safe ESM dynamic import, and refresh the published `@ifc-lite/wasm` bindings and binary so the npm package stays in sync with the current Rust sources.

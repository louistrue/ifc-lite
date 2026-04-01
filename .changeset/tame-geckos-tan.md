---
"@ifc-lite/bcf": patch
"@ifc-lite/cache": patch
"@ifc-lite/cli": patch
"@ifc-lite/codegen": patch
"@ifc-lite/create": patch
"create-ifc-lite": patch
"@ifc-lite/data": patch
"@ifc-lite/drawing-2d": patch
"@ifc-lite/encoding": patch
"@ifc-lite/export": patch
"@ifc-lite/geometry": patch
"@ifc-lite/ids": patch
"@ifc-lite/ifcx": patch
"@ifc-lite/lens": patch
"@ifc-lite/lists": patch
"@ifc-lite/mutations": patch
"@ifc-lite/parser": patch
"@ifc-lite/query": patch
"@ifc-lite/renderer": patch
"@ifc-lite/sandbox": patch
"@ifc-lite/sdk": patch
"@ifc-lite/server-bin": patch
"@ifc-lite/server-client": patch
"@ifc-lite/spatial": patch
"@ifc-lite/viewer-core": patch
---

Remove recursive package `prebuild` hooks and run TypeScript via `pnpm exec` so workspace builds resolve correctly on Windows.

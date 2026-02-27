---
"create-ifc-lite": patch
---

Fix all template TypeScript errors caught by new CI audit:
- basic template: add `@types/node` + `types: ["node"]` in tsconfig; fix `Buffer` → `ArrayBuffer` conversion when calling `IfcParser.parse()`
- Add `test-templates.yml` CI workflow that scaffolds every template, runs `npm install` + `tsc --noEmit` (+ `vite build` for threejs) on every PR touching `packages/create-ifc-lite`

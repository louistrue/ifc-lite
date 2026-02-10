---
"@ifc-lite/encoding": minor
"@ifc-lite/lists": minor
---

Add @ifc-lite/encoding and @ifc-lite/lists packages

- `@ifc-lite/encoding`: IFC string decoding and property value parsing (zero dependencies)
- `@ifc-lite/lists`: Configurable property list engine with column discovery, presets, and CSV export
- Both packages expose headless APIs via `ListDataProvider` interface for framework-agnostic usage
- Viewer updated to consume these packages via `createListDataProvider()` adapter

---
"@ifc-lite/geometry": minor
"@ifc-lite/wasm": minor
"@ifc-lite/renderer": minor
"@ifc-lite/cache": minor
---

Add symbolic representation support for 2D drawings

- **New Feature**: Added `parseSymbolicRepresentations` WASM API to extract 2D Plan, Annotation, and FootPrint representations from IFC files
- **New Feature**: Section2DPanel now supports toggling between section cuts and symbolic representations (architectural floor plans)
- **New Feature**: Added hybrid mode that combines section cuts with symbolic representations
- **New Feature**: Building rotation detection from IfcSite placement for proper floor plan orientation
- **Enhancement**: RTC offset streaming events for better coordinate handling in large models
- **Enhancement**: Geometry processor now reports building rotation in coordinate info
- **Types**: Added `SymbolicRepresentationCollection`, `SymbolicPolyline`, `SymbolicCircle` types
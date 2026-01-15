---
"@ifc-lite/renderer": patch
---

### Bug Fixes

- **Fixed visibility filtering for merged meshes**: Mesh pieces are now accumulated per expressId, ensuring visibility toggling works correctly when multiple geometry pieces belong to the same IFC element
- **Fixed spatial structure filtering**: Spatial structure types (IfcSpace, IfcSite, etc.) are now properly filtered from contained elements lists
- **Fixed spatial hierarchy cache**: Spatial hierarchy is now correctly rebuilt when loading models from cache

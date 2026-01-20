---
"@ifc-lite/renderer": patch
"@ifc-lite/wasm": patch
"@ifc-lite/geometry": patch
---

Fix multi-material rendering and enhance CSG operations

### Multi-Material Rendering
- Windows now correctly render with transparent glass panels and opaque frames
- Doors now render all submeshes including inner framing with correct colors
- Fixed mesh deduplication in Viewport that was filtering out submeshes sharing the same expressId
- Added SubMesh and SubMeshCollection types to track per-geometry-item meshes for style lookup

### CSG Operations
- Added union and intersection mesh operations for full boolean CSG support
- Improved CSG clipping with degenerate triangle removal to eliminate artifacts
- Enhanced bounds overlap detection for better performance
- Added cleanup of triangles inside opening bounds to remove CSG artifacts

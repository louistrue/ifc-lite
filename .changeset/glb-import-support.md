---
"@ifc-lite/cache": minor
"@ifc-lite/ifcx": minor
---

Add GLB file import support for fast geometry loading and 3D tool interoperability

- Add GLB parser (parseGLB, loadGLBToMeshData) to cache package for importing pre-cached geometry
- Enable round-trip workflows: IFC → GLB (export) → MeshData (import)
- Support GLB files in viewer: upload, drag-and-drop, and multi-model federation
- Detect GLB format via magic bytes (0x46546C67)

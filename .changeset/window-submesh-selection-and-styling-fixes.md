---
"@ifc-lite/wasm": patch
"@ifc-lite/renderer": patch
---

Fix window rendering and interaction regressions for multi-part tessellated elements. The WASM geometry pipeline now correctly triangulates `IfcIndexedPolygonalFaceWithVoids` (including inner loops) and respects optional `PnIndex` remapping, restoring correct window cutouts and subelement colors. Renderer picking, CPU raycasting, and selected-mesh lazy creation now handle all submesh pieces per element/model instead of collapsing to a single piece, and selected highlights are rendered after transparent passes so glass receives the same selection highlight as frames.

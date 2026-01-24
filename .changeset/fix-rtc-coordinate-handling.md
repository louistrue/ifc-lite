---
"@ifc-lite/wasm": patch
"@ifc-lite/geometry": minor
---

Fix RTC (Relative To Center) coordinate handling consistency

**BREAKING**: Rename `isGeoReferenced` to `hasLargeCoordinates` in CoordinateInfo interface.
Large coordinates do NOT mean a model is georeferenced. Proper georeferencing uses IfcMapConversion.

- Rename isGeoReferenced → hasLargeCoordinates across all packages (geometry, cache, export, viewer)
- Fix transform_mesh to apply RTC uniformly per-mesh (not per-vertex) preventing mixed coordinates
- Fix coordinate-handler.ts threshold consistency between bounds calculation and vertex cleanup
- Fix streaming path originalBounds reconstruction by undoing server-applied shift
- Surface RTC offset in GpuGeometry struct with JS-accessible getters (rtcOffsetX/Y/Z, hasRtcOffset)
- Add RTC detection and offset handling to parseToGpuGeometryAsync
- Include RTC offset in GPU async completion stats
- Add comprehensive coordinate handling documentation

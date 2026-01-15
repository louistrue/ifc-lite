---
"@ifc-lite/parser": minor
"@ifc-lite/geometry": minor
"@ifc-lite/renderer": minor
"@ifc-lite/cache": patch
"@ifc-lite/wasm": minor
---

### New Features

- **Type visibility controls**: Toggle visibility of spatial elements (IfcSpace, IfcOpeningElement, IfcSite) in the viewer toolbar
- **Enhanced CSG operations**: Improved boolean geometry operations using the `csgrs` library for better performance and accuracy
- **Full IFC4X3 schema support**: Migrated to generated schema with all 876 IFC4X3 types

### Bug Fixes

- **Fixed unit conversion**: Files using millimeters (.MILLI. prefix) now render at correct scale instead of 1000x too large
- **Fixed IFCPROJECT detection**: Now scans entire file to find IFCPROJECT instead of only first 100 entities, fixing issues with large IFC files

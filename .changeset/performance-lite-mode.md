---
"@ifc-lite/parser": minor
"@ifc-lite/wasm": minor
"@ifc-lite/renderer": minor
"@ifc-lite/geometry": minor
"@ifc-lite/cache": patch
---

### Performance Improvements

- **Lite Parsing Mode**: Added optimized parsing mode for large files (>100MB) with 5-10x faster parsing performance
- **On-Demand Property Extraction**: Implemented on-demand property extraction for instant property access, eliminating upfront table building overhead
- **Fast Semicolon Scanner**: Added high-performance semicolon-based scanner for faster large file processing
- **Single-Pass Data Extraction**: Optimized to single-pass data extraction for improved parsing speed
- **Async Yields**: Added async yields during data parsing to prevent UI blocking
- **Bulk Array Extraction**: Optimized data model decoding with bulk array extraction for better performance
- **Dynamic Batch Sizing**: Implemented dynamic batch sizing for improved performance in IFC processing with adaptive batch sizes based on file size

### New Features

- **On-Demand Parsing Mode**: Consolidated to single on-demand parsing mode for better memory efficiency
- **Targeted Spatial Parsing**: Added targeted spatial parsing in lite mode for efficient hierarchy building

### Bug Fixes

- **Fixed Relationship Graph**: Added DefinesByProperties to relationship graph in lite mode
- **Fixed On-Demand Maps**: Improved forward relationship lookup for rebuilding on-demand maps
- **Fixed Property Extraction**: Restored on-demand property extraction when loading from cache

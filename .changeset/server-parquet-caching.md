---
"@ifc-lite/server-client": minor
"@ifc-lite/cache": minor
---

### New Features

- **Parquet-Based Serialization**: Implemented Parquet-based mesh serialization for ~15x smaller payloads
- **BOS-Optimized Parquet Format**: Added ara3d BOS-optimized Parquet format for ~50x smaller payloads
- **Data Model Extraction**: Implemented data model extraction and serialization to Parquet
- **Server-Client Integration**: Added high-performance IFC processing server for Railway deployment with API information endpoint
- **Cache Fast-Path**: Added cache fast-path to streaming endpoint for improved performance

### Performance Improvements

- **Parallelized Serialization**: Parallelized geometry and data model serialization for faster processing
- **Dynamic Batch Sizing**: Implemented dynamic batch sizing for improved performance in IFC processing
- **Enhanced Caching**: Enhanced data model handling and caching in Parquet processing

### Bug Fixes

- **Fixed Background Caching**: Fixed data model background caching execution issues
- **Fixed Cache Directory Detection**: Improved cache directory detection for local development

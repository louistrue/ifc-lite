---
"@ifc-lite/geometry": minor
"@ifc-lite/wasm": minor
---

### New Features

- **2D Profile-Level Boolean Operations**: Implemented efficient 2D polygon boolean operations for void subtraction at the profile level before extrusion. This provides 10-25x performance improvement over 3D CSG operations for most openings and produces cleaner geometry with fewer degenerate triangles.

- **Void Analysis and Classification**: Added intelligent void classification system that distinguishes between coplanar voids (can be handled efficiently in 2D) and non-planar voids (require 3D CSG). This enables optimal processing strategy selection.

- **Enhanced Void Handling**: Improved void subtraction in extrusions with support for both full-depth and partial-depth voids, including segmented extrusion for complex void configurations.

### Improvements

- **WASM Compatibility**: Replaced `clipper2` (C++ dependency) with `i_overlay` (pure Rust) for WASM builds, eliminating C++ compilation issues and ensuring reliable WASM builds.

- **Performance**: Profile-level void subtraction is significantly faster than 3D CSG operations, especially for floors/slabs with many penetrations.

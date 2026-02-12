# @ifc-lite/parser

## 1.7.0

### Minor Changes

- [#200](https://github.com/louistrue/ifc-lite/pull/200) [`6c43c70`](https://github.com/louistrue/ifc-lite/commit/6c43c707ead13fc482ec367cb08d847b444a484a) Thanks [@louistrue](https://github.com/louistrue)! - Add schema-aware property editing, full property panel display, and document/relationship support

  - Property editor validates against IFC4 standard (ISO 16739-1:2018): walls get wall psets, doors get door psets, etc.
  - Schema-version-aware property editing: detects IFC2X3/IFC4/IFC4X3 from FILE_SCHEMA header
  - New dialogs for adding classifications (12 standard systems), materials, and quantities in edit mode
  - Quantity set definitions (Qto\_) with schema-aware dialog for standard IFC4 base quantities
  - On-demand classification extraction from IfcRelAssociatesClassification with chain walking
  - On-demand material extraction supporting all IFC material types: IfcMaterial, IfcMaterialLayerSet, IfcMaterialProfileSet, IfcMaterialConstituentSet, IfcMaterialList, and \*Usage wrappers
  - On-demand document extraction from IfcRelAssociatesDocument with DocumentReference→DocumentInformation chain
  - Type-level property merging: properties from IfcTypeObject HasPropertySets merged with instance properties
  - Structural relationship display: openings, fills, groups, and connections
  - Advanced property type parsing: IfcPropertyEnumeratedValue, BoundedValue, ListValue, TableValue, ReferenceValue
  - Georeferencing display (IfcMapConversion + IfcProjectedCRS) in model metadata panel
  - Length unit display in model metadata panel
  - Classifications, materials, documents displayed with dedicated card components
  - Type-level material/classification inheritance via IfcRelDefinesByType
  - Relationship graph fallback for server-loaded models without on-demand maps
  - Cycle detection in material resolution and classification chain walking
  - Removed `any` types from parser production code in favor of proper `PropertyValue` union type

### Patch Changes

- [#202](https://github.com/louistrue/ifc-lite/pull/202) [`e0af898`](https://github.com/louistrue/ifc-lite/commit/e0af898608c2f706dc2d82154c612c64e2de010c) Thanks [@louistrue](https://github.com/louistrue)! - Fix empty Description, ObjectType, and Tag columns in lists and show all IFC attributes in property panel

  - Lists: add on-demand attribute extraction fallback with per-provider caching for Description, ObjectType, and Tag columns that were previously always empty
  - Property panel: show ALL string/enum IFC attributes dynamically using the schema registry (Name, Description, ObjectType, Tag, PredefinedType, etc.) instead of hardcoding only Name/Description/ObjectType
  - Parser: add `extractAllEntityAttributes()` for schema-aware full attribute extraction, extend `extractEntityAttributesOnDemand()` to include Tag (IfcElement index 7)
  - Query: add `EntityNode.tag` getter and `EntityNode.allAttributes()` method for comprehensive attribute access
  - Performance: cache `getAttributeNames()` inheritance walks, hoist module-level constants
  - Fix type name casing bug where multi-word UPPERCASE STEP types (e.g., IFCWALLSTANDARDCASE) failed schema lookup

- Updated dependencies [[`6c43c70`](https://github.com/louistrue/ifc-lite/commit/6c43c707ead13fc482ec367cb08d847b444a484a)]:
  - @ifc-lite/data@1.7.0
  - @ifc-lite/ifcx@1.7.0

## 1.4.0

### Patch Changes

- 0191843: feat: Add BCF (BIM Collaboration Format) support

  Adds full BCF 2.1 support for issue tracking and collaboration in BIM workflows:

  **BCF Package (@ifc-lite/bcf):**

  - Read/write BCF 2.1 .bcfzip files
  - Full viewpoint support with camera position, components, and clipping planes
  - Coordinate system conversion between Y-up (viewer) and Z-up (IFC/BCF)
  - Support for multiple snapshot naming conventions
  - IFC GlobalId mapping for component references

  **Viewer Integration:**

  - BCF panel integrated into properties panel area (resizable, same layout)
  - Topic management with filtering and status updates
  - Viewpoint capture with camera state, selection, and snapshot
  - Viewpoint activation with smooth camera animation and visibility state
  - Import/export BCF files compatible with BIMcollab and other tools
  - Email setup nudge in empty state for easy author configuration
  - Smart filename generation using model name for downloads

  **Renderer Fixes:**

  - Fix screenshot distortion caused by WebGPU texture row alignment
  - Add GPU-synchronized screenshot capture for accurate snapshots

  **Parser Fixes:**

  - Extract GlobalIds for all geometry entities (not just spatial) to enable BCF component references

  **Bug Fixes:**

  - Fix BCF viewpoint visibility not clearing isolation mode
  - Add localStorage error handling for private browsing mode
  - Fix BCF XML schema compliance for BIMcollab compatibility:
    - Correct element order (Selection before Visibility)
    - Move ViewSetupHints to Components level (not inside Visibility)
    - Write OriginatingSystem/AuthoringToolId as child elements (not attributes)
    - Always include required Visibility element

## 1.3.0

### Minor Changes

- [#130](https://github.com/louistrue/ifc-lite/pull/130) [`cc4d3a9`](https://github.com/louistrue/ifc-lite/commit/cc4d3a922869be5d4f8cafd4ab1b84e6bd254302) Thanks [@louistrue](https://github.com/louistrue)! - Add IFC5 federated loading support with layer composition

  ## Features

  - **Federated IFCX Loading**: Load multiple IFCX files that compose into a unified model

    - Supports the IFC5/IFCX Entity-Component-System architecture
    - Later files in the composition chain override earlier files (USD-inspired semantics)
    - Properties from overlay files merge with base geometry files

  - **Models Panel Integration**: Show all federated layers in the Models panel

    - Each layer (base + overlays) displayed as a separate entry
    - Overlay-only files (no geometry) shown with data indicator
    - Toggle visibility per layer

  - **Add Overlay via "+" Button**: Add IFCX overlay files to existing models
    - Works with both single-file and already-federated IFCX models
    - Automatically re-composes with new overlay as strongest layer
    - Preserves original files for future re-composition

  ## Fixes

  - **Property Panel Layout**: Long property strings no longer push other values off-screen

    - Changed from flexbox to CSS grid layout
    - Individual horizontal scroll on each property value

  - **3D Selection Highlighting**: Fixed race condition that broke highlighting after adding overlays

    - Geometry now comes exclusively from models Map (not legacy state)
    - Meshes correctly tagged with modelIndex for multi-model selection

  - **ID Range Tracking**: Fixed maxExpressId calculation for proper entity resolution
    - resolveGlobalIdFromModels now correctly finds entities across federated layers

  ## Technical Details

  - New `LayerStack` class manages ordered composition with strongest-to-weakest semantics
  - New `PathIndex` class enables efficient cross-layer entity lookups
  - `parseFederatedIfcx` function handles multi-file composition
  - Viewer auto-detects when multiple IFCX files are loaded together

### Patch Changes

- [#119](https://github.com/louistrue/ifc-lite/pull/119) [`fe4f7ac`](https://github.com/louistrue/ifc-lite/commit/fe4f7aca0e7927d12905d5d86ded7e06f41cb3b3) Thanks [@louistrue](https://github.com/louistrue)! - Fix WASM safety, improve DX, and add test infrastructure

  - Replace 60+ unsafe unwrap() calls with safe JS interop helpers in WASM bindings
  - Clean console output with single summary line per file load
  - Pure client-side by default (no CORS errors in production)
  - Add unit tests for StringTable, GLTFExporter, store slices
  - Add WASM contract tests and integration pipeline tests
  - Fix TypeScript any types and data corruption bugs

- Updated dependencies [[`fe4f7ac`](https://github.com/louistrue/ifc-lite/commit/fe4f7aca0e7927d12905d5d86ded7e06f41cb3b3), [`cc4d3a9`](https://github.com/louistrue/ifc-lite/commit/cc4d3a922869be5d4f8cafd4ab1b84e6bd254302)]:
  - @ifc-lite/data@1.3.0
  - @ifc-lite/ifcx@1.3.0

## 1.2.1

### Patch Changes

- 8cb195d: Fix Ubuntu setup issues and monorepo resolution.
  - Fix `@ifc-lite/parser` worker resolution for Node.js/tsx compatibility
  - Fix `create-ifc-lite` to properly replace `workspace:` protocol in templates

## 1.2.0

### Minor Changes

- ed8f77b: ### New Features

  - **IFC5 (IFCX) Format Support**: Added full support for IFC5/IFCX file format parsing, enabling compatibility with the latest IFC standard
  - **IFCX Property/Quantity Display**: Enhanced viewer to properly display IFCX properties and quantities
  - **IFCX Coordinate System Handling**: Fixed coordinate system transformations for IFCX files

  ### Bug Fixes

  - **Fixed STEP Escaping**: Corrected STEP file escaping issues that affected IFCX parsing
  - **Fixed IFC Type Names**: Improved IFC type name handling for better compatibility

- f4fbf8c: ### New Features

  - **Type visibility controls**: Toggle visibility of spatial elements (IfcSpace, IfcOpeningElement, IfcSite) in the viewer toolbar
  - **Enhanced CSG operations**: Improved boolean geometry operations using the `csgrs` library for better performance and accuracy
  - **Full IFC4X3 schema support**: Migrated to generated schema with all 876 IFC4X3 types

  ### Bug Fixes

  - **Fixed unit conversion**: Files using millimeters (.MILLI. prefix) now render at correct scale instead of 1000x too large
  - **Fixed IFCPROJECT detection**: Now scans entire file to find IFCPROJECT instead of only first 100 entities, fixing issues with large IFC files

- ed8f77b: ### Performance Improvements

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

### Patch Changes

- ed8f77b: ### Bug Fixes

  - **Fixed Color Parsing**: Fixed TypedValue wrapper handling in color parsing
  - **Fixed Storey Visibility**: Fixed storey visibility toggle functionality
  - **Fixed Background Property Parsing**: Added background property parsing support
  - **Fixed Geometry Support**: Added IfcSpace/Opening/Site geometry support
  - **Fixed TypeScript Generation**: Fixed TypeScript generation from EXPRESS schema types
  - **Fixed Renderer Safeguards**: Added renderer safeguards for proper IFC type names

- ### Bug Fixes

  - **Fixed IFC elevation units**: IFC files store elevation values in the file's native units (e.g., mm), but they were being displayed as meters without conversion. Now properly extracts and applies length unit scale from IFCPROJECT -> IFCUNITASSIGNMENT -> IFCSIUNIT/IFCCONVERSIONBASEDUNIT, supporting SI prefixes (MILLI, CENTI, etc.) and imperial units (FOOT, INCH).
  - **Fixed IFCMEASUREWITHUNIT scale**: When extracting conversion factors from IFCMEASUREWITHUNIT, the ValueComponent is now correctly multiplied by the UnitComponent's scale factor (e.g., INCH defined as 25.4mm = 0.0254m).
  - **Fixed missing IFCUNITASSIGNMENT handling**: Added guards against missing IFCUNITASSIGNMENT attributes to prevent parsing errors.

- f7133a3: ### Performance Improvements

  - **Zero-copy WASM memory to WebGPU upload**: Implemented direct memory access from WASM linear memory to WebGPU buffers, eliminating intermediate JavaScript copies. This provides 60-70% reduction in peak RAM usage and 40-50% faster geometry-to-GPU pipeline.

  - **Optimized cache and spatial hierarchy**: Eliminated O(n²) lookups in cache and spatial hierarchy builder, implemented instant cache lookup with larger batches, and optimized batch streaming for better performance.

  - **Parallelized data model parsing**: Added parallel processing for data model parsing and streaming of cached geometry with deferred hash computation and yielding before heavy decode operations.

  ### New Features

  - **Zero-copy benchmark suite**: Added comprehensive benchmark suite to measure zero-copy performance improvements and identify bottlenecks.

  - **GPU geometry API**: Added new GPU-ready geometry API with pre-interleaved vertex data, pre-converted coordinates, and pointer-based direct WASM memory access.

  ### Bug Fixes

  - **Fixed O(n²) batch recreation**: Eliminated inefficient batch recreation in zero-copy streaming pipeline.

  - **Updated WASM and TypeScript definitions**: Updated WASM bindings and TypeScript definitions for geometry classes to support zero-copy operations.

- Updated dependencies [ed8f77b]
  - @ifc-lite/ifcx@1.2.0

## 1.2.0

### Minor Changes

- [#66](https://github.com/louistrue/ifc-lite/pull/66) [`ed8f77b`](https://github.com/louistrue/ifc-lite/commit/ed8f77b6eaa16ff93593bb946135c92db587d0f5) Thanks [@louistrue](https://github.com/louistrue)! - ### New Features

  - **IFC5 (IFCX) Format Support**: Added full support for IFC5/IFCX file format parsing, enabling compatibility with the latest IFC standard
  - **IFCX Property/Quantity Display**: Enhanced viewer to properly display IFCX properties and quantities
  - **IFCX Coordinate System Handling**: Fixed coordinate system transformations for IFCX files

  ### Bug Fixes

  - **Fixed STEP Escaping**: Corrected STEP file escaping issues that affected IFCX parsing
  - **Fixed IFC Type Names**: Improved IFC type name handling for better compatibility

- [#39](https://github.com/louistrue/ifc-lite/pull/39) [`f4fbf8c`](https://github.com/louistrue/ifc-lite/commit/f4fbf8cf0deef47a813585114c2bc829b3b15e74) Thanks [@louistrue](https://github.com/louistrue)! - ### New Features

  - **Type visibility controls**: Toggle visibility of spatial elements (IfcSpace, IfcOpeningElement, IfcSite) in the viewer toolbar
  - **Enhanced CSG operations**: Improved boolean geometry operations using the `csgrs` library for better performance and accuracy
  - **Full IFC4X3 schema support**: Migrated to generated schema with all 876 IFC4X3 types

  ### Bug Fixes

  - **Fixed unit conversion**: Files using millimeters (.MILLI. prefix) now render at correct scale instead of 1000x too large
  - **Fixed IFCPROJECT detection**: Now scans entire file to find IFCPROJECT instead of only first 100 entities, fixing issues with large IFC files

- [#66](https://github.com/louistrue/ifc-lite/pull/66) [`ed8f77b`](https://github.com/louistrue/ifc-lite/commit/ed8f77b6eaa16ff93593bb946135c92db587d0f5) Thanks [@louistrue](https://github.com/louistrue)! - ### Performance Improvements

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

### Patch Changes

- [#66](https://github.com/louistrue/ifc-lite/pull/66) [`ed8f77b`](https://github.com/louistrue/ifc-lite/commit/ed8f77b6eaa16ff93593bb946135c92db587d0f5) Thanks [@louistrue](https://github.com/louistrue)! - ### Bug Fixes

  - **Fixed Color Parsing**: Fixed TypedValue wrapper handling in color parsing
  - **Fixed Storey Visibility**: Fixed storey visibility toggle functionality
  - **Fixed Background Property Parsing**: Added background property parsing support
  - **Fixed Geometry Support**: Added IfcSpace/Opening/Site geometry support
  - **Fixed TypeScript Generation**: Fixed TypeScript generation from EXPRESS schema types
  - **Fixed Renderer Safeguards**: Added renderer safeguards for proper IFC type names

- [#52](https://github.com/louistrue/ifc-lite/pull/52) [`f7133a3`](https://github.com/louistrue/ifc-lite/commit/f7133a31320fdb8e8744313f46fbfe1718f179ff) Thanks [@louistrue](https://github.com/louistrue)! - ### Performance Improvements

  - **Zero-copy WASM memory to WebGPU upload**: Implemented direct memory access from WASM linear memory to WebGPU buffers, eliminating intermediate JavaScript copies. This provides 60-70% reduction in peak RAM usage and 40-50% faster geometry-to-GPU pipeline.

  - **Optimized cache and spatial hierarchy**: Eliminated O(n²) lookups in cache and spatial hierarchy builder, implemented instant cache lookup with larger batches, and optimized batch streaming for better performance.

  - **Parallelized data model parsing**: Added parallel processing for data model parsing and streaming of cached geometry with deferred hash computation and yielding before heavy decode operations.

  ### New Features

  - **Zero-copy benchmark suite**: Added comprehensive benchmark suite to measure zero-copy performance improvements and identify bottlenecks.

  - **GPU geometry API**: Added new GPU-ready geometry API with pre-interleaved vertex data, pre-converted coordinates, and pointer-based direct WASM memory access.

  ### Bug Fixes

  - **Fixed O(n²) batch recreation**: Eliminated inefficient batch recreation in zero-copy streaming pipeline.

  - **Updated WASM and TypeScript definitions**: Updated WASM bindings and TypeScript definitions for geometry classes to support zero-copy operations.

- Updated dependencies [[`ed8f77b`](https://github.com/louistrue/ifc-lite/commit/ed8f77b6eaa16ff93593bb946135c92db587d0f5)]:
  - @ifc-lite/ifcx@1.2.0

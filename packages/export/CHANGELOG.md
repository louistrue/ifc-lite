# @ifc-lite/export

## 1.7.0

### Patch Changes

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

- Updated dependencies [[`e0af898`](https://github.com/louistrue/ifc-lite/commit/e0af898608c2f706dc2d82154c612c64e2de010c), [`6c43c70`](https://github.com/louistrue/ifc-lite/commit/6c43c707ead13fc482ec367cb08d847b444a484a)]:
  - @ifc-lite/parser@1.7.0
  - @ifc-lite/data@1.7.0
  - @ifc-lite/geometry@1.7.0
  - @ifc-lite/mutations@1.7.0

## 1.3.0

### Patch Changes

- [#119](https://github.com/louistrue/ifc-lite/pull/119) [`fe4f7ac`](https://github.com/louistrue/ifc-lite/commit/fe4f7aca0e7927d12905d5d86ded7e06f41cb3b3) Thanks [@louistrue](https://github.com/louistrue)! - Fix WASM safety, improve DX, and add test infrastructure

  - Replace 60+ unsafe unwrap() calls with safe JS interop helpers in WASM bindings
  - Clean console output with single summary line per file load
  - Pure client-side by default (no CORS errors in production)
  - Add unit tests for StringTable, GLTFExporter, store slices
  - Add WASM contract tests and integration pipeline tests
  - Fix TypeScript any types and data corruption bugs

- Updated dependencies [[`0c1a262`](https://github.com/louistrue/ifc-lite/commit/0c1a262d971af4a1bc2c97d41258aa6745fef857), [`fe4f7ac`](https://github.com/louistrue/ifc-lite/commit/fe4f7aca0e7927d12905d5d86ded7e06f41cb3b3), [`4bf4931`](https://github.com/louistrue/ifc-lite/commit/4bf4931181d1c9867a5f0f4803972fa5a3178490), [`07558fc`](https://github.com/louistrue/ifc-lite/commit/07558fc4aa91245ef0f9c31681ec84444ec5d80e), [`cc4d3a9`](https://github.com/louistrue/ifc-lite/commit/cc4d3a922869be5d4f8cafd4ab1b84e6bd254302)]:
  - @ifc-lite/geometry@1.3.0
  - @ifc-lite/parser@1.3.0
  - @ifc-lite/data@1.3.0

## 1.2.1

### Patch Changes

- Version sync with @ifc-lite packages

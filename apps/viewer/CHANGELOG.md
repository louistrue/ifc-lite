# @ifc-lite/viewer

## 1.7.0

### Minor Changes

- [#204](https://github.com/louistrue/ifc-lite/pull/204) [`057bde9`](https://github.com/louistrue/ifc-lite/commit/057bde9e48f64c07055413c690c6bdabb6942d04) Thanks [@louistrue](https://github.com/louistrue)! - Add orthographic projection, pinboard, lens, type tree, and floorplan views

  ### Renderer

  - Orthographic reverse-Z projection matrix in math utilities
  - Camera projection mode toggle (perspective/orthographic) with seamless switching
  - Orthographic zoom scales view size instead of camera distance
  - Parallel ray unprojection for orthographic picking

  ### Viewer

  - **Orthographic projection**: Toggle button, unified Views dropdown, numpad `5` keyboard shortcut
  - **Automatic Floorplan**: Per-storey section cuts with top-down ortho view, dropdown in toolbar
  - **Pinboard**: Selection basket with Pin/Unpin/Show, entity isolation via serialized EntityRef Set
  - **Tree View by Type**: IFC type grouping mode alongside spatial hierarchy, localStorage persistence
  - **Lens**: Rule-based 3D colorization/filtering with built-in presets (By IFC Type, Structural Elements), full panel UI with color legend and rule evaluation engine

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

- Updated dependencies [[`0967cfe`](https://github.com/louistrue/ifc-lite/commit/0967cfe9a203141ee6fc7604153721396f027658), [`057bde9`](https://github.com/louistrue/ifc-lite/commit/057bde9e48f64c07055413c690c6bdabb6942d04), [`e0af898`](https://github.com/louistrue/ifc-lite/commit/e0af898608c2f706dc2d82154c612c64e2de010c), [`6c43c70`](https://github.com/louistrue/ifc-lite/commit/6c43c707ead13fc482ec367cb08d847b444a484a)]:
  - @ifc-lite/encoding@1.7.0
  - @ifc-lite/lists@1.7.0
  - @ifc-lite/renderer@1.7.0
  - @ifc-lite/parser@1.7.0
  - @ifc-lite/query@1.7.0
  - @ifc-lite/data@1.7.0
  - @ifc-lite/cache@1.7.0
  - @ifc-lite/export@1.7.0
  - @ifc-lite/ids@1.7.0
  - @ifc-lite/bcf@1.7.0
  - @ifc-lite/drawing-2d@1.7.0
  - @ifc-lite/geometry@1.7.0
  - @ifc-lite/lens@1.7.0
  - @ifc-lite/mutations@1.7.0
  - @ifc-lite/server-client@1.7.0
  - @ifc-lite/spatial@1.7.0
  - @ifc-lite/wasm@1.7.0

## 1.6.0

### Minor Changes

- Initial tracked version

---
"@ifc-lite/parser": minor
"@ifc-lite/viewer": minor
"@ifc-lite/data": patch
"@ifc-lite/cache": patch
"@ifc-lite/export": patch
---

Add schema-aware property editing, full property panel display, and document/relationship support

- Property editor validates against IFC4 standard (ISO 16739-1:2018): walls get wall psets, doors get door psets, etc.
- Schema-version-aware property editing: detects IFC2X3/IFC4/IFC4X3 from FILE_SCHEMA header
- New dialogs for adding classifications (12 standard systems), materials, and quantities in edit mode
- Quantity set definitions (Qto_) with schema-aware dialog for standard IFC4 base quantities
- On-demand classification extraction from IfcRelAssociatesClassification with chain walking
- On-demand material extraction supporting all IFC material types: IfcMaterial, IfcMaterialLayerSet, IfcMaterialProfileSet, IfcMaterialConstituentSet, IfcMaterialList, and *Usage wrappers
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

---
"@ifc-lite/parser": minor
"@ifc-lite/viewer": minor
---

Add schema-aware property editing and classification/material display

- Property editor validates against IFC4 standard (ISO 16739-1:2018): walls get wall psets, doors get door psets, etc.
- New dialogs for adding classifications (12 standard systems) and materials in edit mode
- On-demand classification extraction from IfcRelAssociatesClassification with chain walking
- On-demand material extraction supporting all IFC material types: IfcMaterial, IfcMaterialLayerSet, IfcMaterialProfileSet, IfcMaterialConstituentSet, IfcMaterialList, and *Usage wrappers
- Classifications and materials displayed in the property panel with dedicated card components
- Type-level material/classification inheritance via IfcRelDefinesByType
- Relationship graph fallback for server-loaded models without on-demand maps
- Cycle detection in material resolution and classification chain walking

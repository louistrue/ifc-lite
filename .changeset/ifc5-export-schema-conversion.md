---
"@ifc-lite/export": minor
"@ifc-lite/viewer": minor
---

Add IFC5 (IFCX) export with full schema conversion and USD geometry

New `Ifc5Exporter` converts IFC data from any schema (IFC2X3/IFC4/IFC4X3) to the IFC5 IFCX JSON format:
- Entity types converted to IFC5 naming (aligned with IFC4X3)
- Properties mapped to IFCX attribute namespaces (`bsi::ifc::prop::`)
- Tessellated geometry converted to USD mesh format with Z-up coordinates
- Spatial hierarchy mapped to IFCX path-based node structure
- Color and presentation exported as USD attributes

The export dialog is simplified: schema selection now drives the output format automatically (IFC5 → `.ifcx`, others → `.ifc`). No separate format picker needed.

Schema converter fixes:
- Skipped entities become IFCPROXY placeholders instead of being dropped, preventing dangling STEP references
- Alignment entities (IFCALIGNMENTCANT, etc.) are preserved for IFC4X3/IFC5 targets

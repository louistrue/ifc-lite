---
"@ifc-lite/parser": patch
"@ifc-lite/query": patch
"@ifc-lite/lists": patch
"@ifc-lite/viewer": patch
---

Fix empty Description, ObjectType, and Tag columns in lists and show all IFC attributes in property panel

- Lists: add on-demand attribute extraction fallback with per-provider caching for Description, ObjectType, and Tag columns that were previously always empty
- Property panel: show ALL string/enum IFC attributes dynamically using the schema registry (Name, Description, ObjectType, Tag, PredefinedType, etc.) instead of hardcoding only Name/Description/ObjectType
- Parser: add `extractAllEntityAttributes()` for schema-aware full attribute extraction, extend `extractEntityAttributesOnDemand()` to include Tag (IfcElement index 7)
- Query: add `EntityNode.tag` getter and `EntityNode.allAttributes()` method for comprehensive attribute access
- Performance: cache `getAttributeNames()` inheritance walks, hoist module-level constants
- Fix type name casing bug where multi-word UPPERCASE STEP types (e.g., IFCWALLSTANDARDCASE) failed schema lookup

---
"@ifc-lite/cli": patch
---

Fix GlobalId uniqueness validation to only check entity types that inherit from IfcRoot, using the schema registry dynamically instead of scanning all entities

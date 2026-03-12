---
"@ifc-lite/cli": patch
"@ifc-lite/data": patch
"@ifc-lite/parser": patch
---

Fix multiple CLI bugs discovered during comprehensive testing:

- **info/diff**: Resolve "Unknown" entity type spam by using IFC_ENTITY_NAMES map for UPPERCASE→PascalCase conversion instead of entity table lookup (which filters non-relevant entities)
- **loader**: Reject non-IFC files (missing ISO-10303-21 header) and empty files with clear error messages instead of silently returning 0 entities
- **props**: Return proper error for nonexistent entity IDs instead of empty JSON structure
- **bcf list**: Fix empty topics by adding Map serialization support to JSON output
- **query --relationships**: Add structural relationship types (VoidsElement, FillsElement, ConnectsPathElements, AssignsToGroup, etc.) to parser; handle 1-to-1 relationships in addition to 1-to-many
- **query --spatial**: Fall back to IfcBuilding containment when no IfcBuildingStorey exists

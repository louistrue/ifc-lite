---
"@ifc-lite/cli": minor
"@ifc-lite/data": patch
"@ifc-lite/parser": patch
---

Fix multiple CLI bugs and add new query features:

**Bug fixes:**
- **info/diff**: Resolve "Unknown" entity type spam by using IFC_ENTITY_NAMES map for UPPERCASE→PascalCase conversion
- **loader**: Reject non-IFC files (missing ISO-10303-21 header) and empty files with clear error messages
- **props**: Return proper error for nonexistent entity IDs instead of empty JSON structure
- **bcf list**: Fix empty topics by adding Map serialization support to JSON output
- **query --where**: Fix boolean property matching (IsExternal=true now works); error on malformed syntax instead of silently returning all results
- **query --relationships**: Add structural relationship types (VoidsElement, FillsElement, ConnectsPathElements, AssignsToGroup, etc.) to parser; handle 1-to-1 relationships
- **query --spatial**: Fall back to IfcBuilding containment when no IfcBuildingStorey exists
- **eval**: Support const/let/var and multi-statement expressions (auto-wraps in async IIFE)
- **model.active().schema**: Add `schema` alias so scripts can access schema version

**New features:**
- **query --where operators**: Support `!=`, `>`, `<`, `>=`, `<=`, `~` (contains) in addition to `=`
- **query --sum**: Aggregate a quantity across matched entities (e.g., `--sum GrossSideArea`)
- **query --storey**: Filter entities by storey name (e.g., `--storey Erdgeschoss`)

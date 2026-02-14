---
"@ifc-lite/export": minor
---

Improve IFC export with visible-only filtering, material preservation, and full schema coverage

- **Visible-only export**: Single-model export now correctly filters hidden entities (fixes `__legacy__` model ID handling)
- **Material preservation**: Multi-model merged export preserves colors and materials by collecting `IfcStyledItem` entities via reverse reference pass
- **Full IFC schema coverage**: Expanded product type classification from ~30 hand-curated types to 202 schema-derived types (IFC4 + IFC4X3), covering all `IfcProduct` subtypes including infrastructure (bridges, roads, railways, marine facilities)
- **Orphaned opening removal**: Hidden elements' openings are automatically excluded via `IfcRelVoidsElement` propagation
- **Performance**: Replaced `TextDecoder` + regex with byte-level `#ID` scanning and `byType` index lookups for style/opening collection (~95% fewer iterations)

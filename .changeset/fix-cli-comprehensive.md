---
"@ifc-lite/cli": minor
"@ifc-lite/sdk": patch
---

### CLI

**Bug fixes:**
- `export --where` now filters entities (was silently ignored)
- `--group-by storey` resolves actual storey names via spatial containment instead of showing "(no storey)"

**New flags:**
- `--property-names`: discover available properties per entity type (parallel to `--quantity-names`)
- `--unique PsetName.PropName`: show distinct values and counts for a property
- `--group-by` + `--sum` combo: aggregate quantity per group (e.g. `--group-by material --sum GrossVolume`)

**UX improvements:**
- `info` command splits entity types into "Building elements" and "Other types" sections

### SDK

- `bim.quantity(ref, name)` 2-arg shorthand now searches all quantity sets (previously required 3-arg form with explicit qset name)

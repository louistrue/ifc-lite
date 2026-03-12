---
"@ifc-lite/cli": patch
"@ifc-lite/create": patch
---

Fix 10 bugs from v0.5.0 test report

**@ifc-lite/cli:**
- fix(eval): `--type` and `--limit` flags no longer parsed as part of the expression
- fix(mutate): support multiple `--set` flags and entity attribute mutation (`--set Name=TestWall`)
- fix(mutate): restrict ObjectType writes to entities that actually define that attribute
- fix(ask): exterior wall recipe falls back to all walls with caveat when IsExternal property is missing
- fix(ask): WWR calculation uses exterior wall area per ISO 13790, falls back only when IsExternal data is truly missing
- fix(ask): generic count recipe matches any type name (`how many piles` → IfcPile)
- fix(ask): add largest/smallest element ranking recipes
- fix(stats): add IfcPile and IfcRamp to element breakdown
- fix(query): warn when group-by aggregation yields all zeros (missing quantity data)

**@ifc-lite/create:**
- fix: generate unique GlobalIds using crypto-strong randomness (Web Crypto API) with per-instance deduplication

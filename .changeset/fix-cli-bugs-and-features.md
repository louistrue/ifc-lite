---
"@ifc-lite/cli": minor
---

Comprehensive CLI bug fixes and new features:

**Bug fixes:**
- `--version` now reads from package.json (was hardcoded "0.2.0")
- `eval --type`/`--limit` flags no longer concatenated into expression string
- `--where` filter now searches both property sets and quantity sets for numeric filtering
- `export --storey` properly filters entities by storey (was silently ignored)
- Quantities available as export columns (e.g. `--columns Name,GrossSideArea`)
- `--unique material`, `--unique storey`, `--unique type` now supported
- `--avg`, `--min`, `--max` aggregation flags produce actual computed results
- `eval --json` wraps output in a JSON envelope
- `--type Wall` auto-prefixes to `IfcWall` with a note
- `--sum` with non-existent quantity shows helpful error and suggestions
- `--group-by` validates keys and errors on invalid options
- `--limit` with `--group-by` now limits groups, not entities

**New features:**
- `stats` command: one-command building KPIs and health check (exterior wall area, GFA, material volumes)
- `mutate` command: modify properties via CLI with `--set` and `--out`
- `ask` command: natural language BIM queries with 15+ built-in recipes
- `--sort`/`--desc` flags for sorting query results by quantity values
- `--group-by` now works with `--avg`, `--min`, `--max` (not just `--sum`)

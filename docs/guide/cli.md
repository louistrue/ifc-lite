# CLI Toolkit

The `@ifc-lite/cli` package provides a complete BIM toolkit for the terminal. Query, validate, export, create, and script IFC files — no browser or viewer required.

Designed for both **humans** and **LLM terminals** (Claude Code, Cursor, Windsurf, etc.).

## Installation

```bash
npm install -g @ifc-lite/cli
```

Or run directly with npx:

```bash
npx @ifc-lite/cli info model.ifc
```

## Quick Start

```bash
# Inspect a model
ifc-lite info model.ifc

# Query walls
ifc-lite query model.ifc --type IfcWall

# Export to CSV
ifc-lite export model.ifc --format csv --type IfcWall --out walls.csv

# Validate against IDS rules
ifc-lite ids model.ifc requirements.ids

# Create an IFC file from scratch
ifc-lite create wall --height 3 --thickness 0.2 --out wall.ifc

# Evaluate SDK expressions
ifc-lite eval model.ifc "bim.query().byType('IfcWall').count()"
```

## Commands

### `info` — Model Summary

Print schema version, entity counts, storeys, and top entity types.

```bash
ifc-lite info model.ifc
ifc-lite info model.ifc --json
```

=== "Table Output"

    ```
      File:     model.ifc
      Schema:   IFC4
      Size:     12.3 MB
      Entities: 45,821
      Parsed:   340ms

      Storeys:
        - Ground Floor
        - First Floor
        - Second Floor

      Entity types (top 10):
         Type              │ Count
        ───────────────────┼───────
         IfcWall           │ 234
         IfcDoor           │ 87
         IfcWindow         │ 156
         ...
    ```

=== "JSON Output (--json)"

    ```json
    {
      "file": "model.ifc",
      "schema": "IFC4",
      "fileSize": 12902400,
      "entityCount": 45821,
      "parseTime": "340ms",
      "storeys": ["Ground Floor", "First Floor", "Second Floor"],
      "typeCounts": {
        "IfcWall": 234,
        "IfcDoor": 87,
        "IfcWindow": 156
      }
    }
    ```

---

### `query` — Query Entities

Filter entities by type, properties, or spatial structure.

```bash
# By type
ifc-lite query model.ifc --type IfcWall
ifc-lite query model.ifc --type IfcWall,IfcDoor

# With property filter
ifc-lite query model.ifc --type IfcWall --where "Pset_WallCommon.IsExternal=true"

# With properties and quantities included
ifc-lite query model.ifc --type IfcWall --props --quantities --json

# Count only
ifc-lite query model.ifc --type IfcDoor --count

# Spatial tree
ifc-lite query model.ifc --spatial

# Pagination
ifc-lite query model.ifc --type IfcWall --limit 10 --offset 20
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--type <T>` | Filter by IFC type (comma-separated) |
| `--where <filter>` | Property filter: `PsetName.PropName=Value` |
| `--props` | Include property sets in output |
| `--quantities` | Include quantity sets in output |
| `--count` | Return count instead of entities |
| `--spatial` | Show spatial tree (storeys → elements) |
| `--limit <N>` | Limit result count |
| `--offset <N>` | Skip first N results |
| `--json` | JSON output |

---

### `props` — Entity Properties

Show all properties, quantities, materials, classifications, and relationships for a single entity.

```bash
ifc-lite props model.ifc --id 42
```

Returns a complete JSON object with:

- `attributes` — IFC schema attributes (Name, Description, ObjectType, etc.)
- `properties` — All IfcPropertySet data
- `quantities` — All IfcElementQuantity data
- `classifications` — Classification references
- `materials` — Material assignments (layers, profiles, constituents)
- `typeProperties` — Properties from the entity's type object
- `relationships` — Voids, fills, groups, connections

---

### `export` — Export Data

Export entity data to CSV, JSON, or IFC STEP format.

```bash
# CSV export
ifc-lite export model.ifc --format csv --type IfcWall --columns Name,Type,GlobalId

# JSON export
ifc-lite export model.ifc --format json --type IfcWall,IfcDoor

# With property columns (dot notation)
ifc-lite export model.ifc --format csv --type IfcWall \
  --columns Name,Type,Pset_WallCommon.IsExternal,Pset_WallCommon.FireRating

# IFC STEP re-export
ifc-lite export model.ifc --format ifc --out filtered.ifc

# Write to file
ifc-lite export model.ifc --format csv --out walls.csv
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--format <fmt>` | `csv`, `json`, or `ifc` |
| `--type <T>` | Filter entities by type |
| `--columns <cols>` | Comma-separated columns (supports `PsetName.PropName`) |
| `--separator <sep>` | CSV separator (default: `,`) |
| `--schema <ver>` | IFC schema for STEP export (`IFC2X3`, `IFC4`, `IFC4X3`) |
| `--out <file>` | Write to file instead of stdout |

---

### `ids` — IDS Validation

Validate an IFC file against IDS (Information Delivery Specification) rules.

```bash
ifc-lite ids model.ifc requirements.ids
ifc-lite ids model.ifc requirements.ids --json
ifc-lite ids model.ifc requirements.ids --locale de
```

Returns pass/fail summary with exit code 0 (pass) or 1 (fail).

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Full validation report as JSON |
| `--locale <lang>` | Message language: `en`, `de`, `fr` |

---

### `bcf` — BCF Collaboration

Create, read, and manage BCF (BIM Collaboration Format) files.

```bash
# Create a new BCF issue
ifc-lite bcf create --title "Missing fire door" --description "Level 2, Room 201" --out issue.bcf

# List topics in a BCF file
ifc-lite bcf list issues.bcf

# Add a comment to a BCF file
ifc-lite bcf add-comment --file issues.bcf --text "Fixed in revision 3" --out updated.bcf
```

---

### `create` — Create IFC Files

Generate IFC building elements from CLI flags or JSON input.

```bash
# Create a wall
ifc-lite create wall --start 0,0,0 --end 5,0,0 --height 3 --thickness 0.2 --out wall.ifc

# Create a slab
ifc-lite create slab --width 10 --depth 8 --thickness 0.3 --out slab.ifc

# Create a column
ifc-lite create column --position 0,0,0 --height 3 --width 0.3 --depth 0.3 --out column.ifc

# Create from JSON (pipe-friendly)
echo '{"Start":[0,0,0],"End":[10,0,0],"Height":3,"Thickness":0.2}' \
  | ifc-lite create wall --from-json --out wall.ifc
```

**Supported elements:** `wall`, `slab`, `column`, `beam`

**Flags:**

| Flag | Description |
|------|-------------|
| `--start <x,y,z>` | Start point (walls, beams) |
| `--end <x,y,z>` | End point (walls, beams) |
| `--position <x,y,z>` | Position (columns) |
| `--height <N>` | Element height |
| `--width <N>` | Element width |
| `--depth <N>` | Element depth |
| `--thickness <N>` | Element thickness |
| `--name <str>` | Element name |
| `--project <str>` | Project name |
| `--storey <str>` | Storey name |
| `--from-json` | Read parameters from stdin JSON |
| `--out <file>` | Output IFC file (required) |

---

### `eval` — Evaluate Expressions

Evaluate JavaScript expressions against the BIM SDK. The `bim` object provides the full `@ifc-lite/sdk` API.

```bash
# Count walls
ifc-lite eval model.ifc "bim.query().byType('IfcWall').count()"

# List storey names
ifc-lite eval model.ifc "bim.storeys().map(s => s.name)"

# Get properties of a specific entity
ifc-lite eval model.ifc "bim.properties({modelId:'default', expressId:42})"

# Complex query
ifc-lite eval model.ifc "bim.query().byType('IfcDoor').toArray().filter(d => d.name.includes('Fire'))"
```

!!! tip "Power Move for LLMs"
    The `eval` command is the most flexible tool. LLMs can write arbitrary SDK code and execute it without needing dedicated subcommands. The full API is discoverable via `ifc-lite schema`.

---

### `run` — Execute Scripts

Run JavaScript files with the full `bim` SDK available.

```bash
ifc-lite run analysis.js model.ifc
```

**Example script (`analysis.js`):**

```javascript
const walls = bim.query().byType('IfcWall').toArray();
console.log(`Found ${walls.length} walls`);

for (const wall of walls) {
  const props = bim.properties(wall.ref);
  const psetCommon = props.find(p => p.name === 'Pset_WallCommon');
  const isExternal = psetCommon?.properties.find(p => p.name === 'IsExternal');
  console.log(`  ${wall.name}: external=${isExternal?.value ?? 'unknown'}`);
}

const storeys = bim.storeys();
console.log(`\n${storeys.length} storeys:`);
for (const s of storeys) {
  const elements = bim.contains(s.ref);
  console.log(`  ${s.name}: ${elements.length} elements`);
}
```

---

### `schema` — API Schema

Dump the complete SDK API schema as JSON. Useful for LLM tools to discover available methods.

```bash
ifc-lite schema              # Full schema with params and return types
ifc-lite schema --compact    # Minimal: names and descriptions only
```

The schema includes all SDK namespaces: `model`, `query`, `viewer`, `mutate`, `create`, `export`, `ids`, `bcf`, and their methods with parameter names, return types, and LLM semantic hints.

## Output Modes

Every command supports structured output:

| Mode | Flag | Use Case |
|------|------|----------|
| Table | *(default)* | Human-readable terminal output |
| JSON | `--json` | Machine-readable, pipe to `jq` |
| CSV | `--format csv` | Spreadsheet-compatible |

**Design principles:**

- **stdout** = data (JSON, CSV, tables)
- **stderr** = status messages, progress
- **Exit 0** = success, **Exit 1** = failure

## Pipe Examples

```bash
# Count walls across multiple files
for f in *.ifc; do
  count=$(ifc-lite query "$f" --type IfcWall --count)
  echo "$f: $count walls"
done

# Extract all door names as plain text
ifc-lite query model.ifc --type IfcDoor --json | jq -r '.[].name'

# Export walls to CSV, filter with standard tools
ifc-lite export model.ifc --format csv --type IfcWall | grep "External"

# Chain: create an element, then inspect it
ifc-lite create wall --out /tmp/w.ifc --height 3 --thickness 0.2
ifc-lite info /tmp/w.ifc --json
```

## Using with LLM Terminals

The CLI is designed to work seamlessly with AI coding assistants like Claude Code.

### Discovery

An LLM can discover all capabilities by running:

```bash
ifc-lite --help          # Overview of all commands
ifc-lite schema          # Full API schema as JSON
```

### Recommended CLAUDE.md Entry

Add this to your project's `CLAUDE.md` to help Claude Code use ifc-lite:

```markdown
## IFC Analysis

Use `ifc-lite` CLI for BIM/IFC file operations:
- `ifc-lite info <file>` — model summary
- `ifc-lite query <file> --type <T> --json` — query entities
- `ifc-lite eval <file> "<expr>"` — evaluate SDK expressions
- `ifc-lite schema` — discover all SDK methods

Always use `--json` for machine-readable output.
Run `ifc-lite schema` to see the full API before writing eval expressions.
```

### Best Practices for LLM Usage

1. **Always use `--json`** — structured output is easier to parse
2. **Use `eval` for complex queries** — more flexible than building flags
3. **Run `schema` first** — discover the API before writing code
4. **Pipe to `jq`** — for filtering and transforming JSON output
5. **Use `--count` for quick checks** — avoid loading full entity data when just counting

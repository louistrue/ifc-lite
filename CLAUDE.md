# Claude Code Guidelines for ifc-lite

See [AGENTS.md](./AGENTS.md) for the full agent guidelines used by all AI assistants in this project.

## CLI Toolkit

Use `@ifc-lite/cli` for headless IFC file operations in the terminal:

```bash
ifc-lite info <file.ifc>                          # Model summary (schema, entities, storeys)
ifc-lite query <file.ifc> --type IfcWall --json    # Query entities by type
ifc-lite props <file.ifc> --id 42                  # All properties for entity #42
ifc-lite export <file.ifc> --format csv --out f.csv # Export to CSV/JSON/IFC
ifc-lite ids <file.ifc> <rules.ids>                # Validate against IDS rules
ifc-lite bcf create --title "Issue" --out f.bcf     # Create BCF collaboration files
ifc-lite create wall --height 3 --out wall.ifc      # Create IFC elements
ifc-lite eval <file.ifc> "<expression>"             # Evaluate SDK expressions
ifc-lite run <script.js> <file.ifc>                 # Execute scripts with SDK
ifc-lite schema                                     # Dump full API schema as JSON
ifc-lite view <file.ifc>                             # Interactive 3D viewer in browser
```

### 3D Viewer (CLI → Browser)

Launch an interactive 3D viewer connected to the CLI:

```bash
ifc-lite view model.ifc                              # Opens browser with 3D view
ifc-lite view model.ifc --port 3456                  # Use specific port
```

Send live commands to the viewer via REST API (ideal for Claude Code):

```bash
# Colorize all walls red
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"colorize","type":"IfcWall","color":[1,0,0,1]}'

# Isolate only walls and slabs
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"isolate","types":["IfcWall","IfcSlab"]}'

# X-ray spaces (semi-transparent)
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"xray","type":"IfcSpace","opacity":0.15}'

# Fly camera to doors
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"flyto","type":"IfcDoor"}'

# Reset everything
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"reset"}'
```

Supported actions: `colorize`, `isolate`, `highlight`, `xray`, `flyto`, `colorByStorey`, `showall`, `reset`.

Always use `--json` for machine-readable output. Run `ifc-lite schema` to discover all available SDK methods before writing `eval` expressions. The `eval` command provides the full `bim.*` SDK API — see `ifc-lite schema` for the complete reference.

Full documentation: [CLI Toolkit Guide](./docs/guide/cli.md)

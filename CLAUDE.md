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
```

Always use `--json` for machine-readable output. Run `ifc-lite schema` to discover all available SDK methods before writing `eval` expressions. The `eval` command provides the full `bim.*` SDK API — see `ifc-lite schema` for the complete reference.

Full documentation: [CLI Toolkit Guide](./docs/guide/cli.md)

# 3D Viewer API (`@ifc-lite/viewer`)

The viewer is a separate package (`packages/viewer`) that provides browser-based 3D visualization. It complements the headless CLI — all standard commands work without it.

## Launching

```bash
ifc-lite view model.ifc                              # Opens browser with 3D view
ifc-lite view model.ifc --port 3456                  # Use specific port
ifc-lite view --empty --port 3456                    # Empty scene, await commands
```

## REST API

Send live commands to the viewer:

```bash
curl -X POST http://localhost:3456/api/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"colorize","type":"IfcWall","color":[1,0,0,1]}'
```

**Type-level actions:** `colorize`, `isolate`, `xray`, `flyto`, `highlight`, `colorByStorey`, `setView`, `showall`, `reset`.

**Entity-level actions** (take `ids` array): `colorizeEntities`, `isolateEntities`, `hideEntities`, `showEntities`, `resetColorEntities`.

**Internal/advanced:** `section`, `clearSection`, `addGeometry`, `removeCreated`, `camera`, `picked`.

## Live Element Creation

```bash
# Single element
curl -X POST http://localhost:3456/api/create \
  -H 'Content-Type: application/json' \
  -d '{"type":"wall","params":{"Height":3,"Start":[0,0,0],"End":[5,0,0]}}'

# Batch create
curl -X POST http://localhost:3456/api/create \
  -H 'Content-Type: application/json' \
  -d '[{"type":"wall","params":{"Height":3,"Start":[0,0,0],"End":[5,0,0]}},{"type":"column","params":{"Height":3,"Position":[5,0,0]}}]'

# Clear created geometry
curl -X POST http://localhost:3456/api/clear-created

# Export created geometry
curl http://localhost:3456/api/export > created.ifc
```

## Analysis Overlay

```bash
ifc-lite analyze model.ifc --viewer 3456 \
  --type IfcWall --missing "Pset_WallCommon.FireRating" --color red

ifc-lite analyze model.ifc --viewer 3456 \
  --type IfcWall --heatmap "Qto_WallBaseQuantities.GrossSideArea" --palette blue-red
```

## Coordinate Convention

IFC uses Z-up; the 3D viewer uses Y-up internally. The geometry layer handles the conversion automatically during mesh parsing. When using `/api/create`, pass coordinates in IFC Z-up convention (`[x, y, z]` where Z is up).

# IFC-Lite

High-performance browser-native IFC platform.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run viewer
cd apps/viewer
pnpm dev
```

## Project Structure

```
ifc-lite/
├── packages/
│   ├── parser/       # STEP tokenizer and entity extraction
│   ├── geometry/     # web-ifc bridge for triangulation
│   ├── renderer/     # WebGPU rendering pipeline
│   └── query/        # Property query system
├── apps/
│   └── viewer/       # React viewer application
├── plan/             # Technical specification and roadmap
└── prototype/        # Feasibility spikes (reference)
```

## Current State

The project is at **early MVP stage** (~20% of planned features).

### Working

- ✅ IFC parsing with entity/property extraction
- ✅ Geometry triangulation via web-ifc
- ✅ WebGPU rendering pipeline
- ✅ Basic 3D navigation (orbit, pan, zoom)
- ✅ Camera fit-to-bounds
- ✅ Property panel display

### In Progress / Known Issues

- ⚠️ Materials use hardcoded gray (should use IFC materials)
- ⚠️ No selection highlighting

### Not Yet Implemented

- ❌ Hierarchy tree (spatial structure)
- ❌ Frustum culling
- ❌ LOD system
- ❌ Instancing/batching
- ❌ Section planes
- ❌ Measurement tools
- ❌ Progressive loading
- ❌ IndexedDB caching

## Browser Requirements

- WebGPU support (Chrome 113+, Edge 113+, Firefox 127+, Safari 18+)
- Modern JavaScript (ES2022+)

## Development

```bash
# Watch mode for all packages
pnpm -r dev

# Build specific package
cd packages/parser && pnpm build

# Run viewer in dev mode
cd apps/viewer && pnpm dev
```

## Roadmap

See `plan/` directory for full technical specification:

- `plan/01-overview-architecture.md` - System architecture
- `plan/02-core-data-structures.md` - Data structures
- `plan/03-parsing-pipeline.md` - Parsing pipeline
- `plan/04-query-system.md` - Query system
- `plan/viewer/` - Viewer-specific plans

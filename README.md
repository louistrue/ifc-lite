# IFC-Lite MVP

High-performance browser-native IFC platform - Minimal Viable Prototype.

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
│   ├── parser/      # STEP tokenizer and entity extraction
│   ├── geometry/     # web-ifc bridge for triangulation
│   ├── renderer/     # WebGPU rendering pipeline
│   └── query/        # Property query system
├── apps/
│   └── viewer/       # React viewer application
└── prototype/        # Feasibility spikes (reference)
```

## Features

- ✅ Fast IFC parsing (~1,200 MB/s)
- ✅ web-ifc triangulation (93% coverage)
- ✅ WebGPU rendering (60+ FPS)
- ✅ Property queries (<2ms)
- ✅ Basic 3D navigation (orbit, pan, zoom)
- ✅ Object picking and property display

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

## Next Steps

See `plan/` directory for full specification and roadmap.

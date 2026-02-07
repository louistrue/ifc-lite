# @ifc-lite/cache

Binary cache format for IFClite. Enables instant loading of previously parsed IFC files by caching geometry and data model in an optimized binary format.

## Installation

```bash
npm install @ifc-lite/cache
```

## Quick Start

```typescript
import { loadGLBToMeshData } from '@ifc-lite/cache';

// Load cached geometry from GLB
const meshData = await loadGLBToMeshData(glbBuffer);
```

## Features

- Binary cache format for fast loading
- GLB-based geometry caching
- Content-addressable caching (SHA-256 hash keys)
- Works with both browser and desktop storage backends

## API

See the [API Reference](../../docs/api/typescript.md#ifc-litecache).

## License

[MPL-2.0](../../LICENSE)

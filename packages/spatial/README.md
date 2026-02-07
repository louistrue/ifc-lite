# @ifc-lite/spatial

Spatial indexing for IFClite. Builds BVH (Bounding Volume Hierarchy) structures for fast ray casting and spatial queries.

## Installation

```bash
npm install @ifc-lite/spatial
```

## Quick Start

```typescript
import { buildSpatialIndex } from '@ifc-lite/spatial';

const index = buildSpatialIndex(meshData);
const hit = index.raycast(origin, direction);
```

## Features

- BVH-based spatial indexing
- Fast ray casting for entity picking
- CPU-based raycasting for models with 500+ elements

## API

See the [API Reference](../../docs/api/typescript.md#ifc-litespatial).

## License

[MPL-2.0](../../LICENSE)

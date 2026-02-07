# @ifc-lite/geometry

Geometry processing bridge for IFClite. Connects the WASM-based geometry engine to the TypeScript pipeline with streaming mesh processing.

## Installation

```bash
npm install @ifc-lite/geometry
```

## Quick Start

```typescript
import { GeometryProcessor } from '@ifc-lite/geometry';

const processor = new GeometryProcessor();
await processor.init();

const result = await processor.process(ifcBuffer, {
  onBatch: (batch) => renderer.addMeshes(batch),
});
```

## Features

- Streaming geometry processing (100 meshes/batch)
- First triangles in 300-500ms
- Up to 5x faster than web-ifc
- Web Worker support for large files (>50MB)
- Coordinate system handling and origin shift

## API

See the [Geometry Guide](../../docs/guide/geometry.md) and [API Reference](../../docs/api/typescript.md#ifc-litegeometry).

## License

[MPL-2.0](../../LICENSE)

# @ifc-lite/renderer

WebGPU-based 3D rendering engine for IFClite. Provides GPU-accelerated rendering with depth testing, frustum culling, and zero-copy WASM-to-GPU data transfer.

## Installation

```bash
npm install @ifc-lite/renderer
```

## Quick Start

```typescript
import { Renderer } from '@ifc-lite/renderer';

const renderer = new Renderer(canvas);
await renderer.init();

renderer.loadGeometry(geometryData);
renderer.fitToView();
renderer.render();
```

## Features

- WebGPU rendering with depth testing and frustum culling
- Zero-copy transfer from WASM linear memory to GPU buffers
- Section planes for cross-section views
- 3D measurements with snap-to-edge
- Entity picking via GPU ray casting
- Multi-model federation support (FederationRegistry)
- Per-entity visibility and color override

## API

See the [Rendering Guide](../../docs/guide/rendering.md) and [API Reference](../../docs/api/typescript.md#ifc-literenderer).

## License

[MPL-2.0](../../LICENSE)

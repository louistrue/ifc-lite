# @ifc-lite/ifcx

IFC5 (IFCX) parser for IFClite. Parses JSON-based IFCX files with ECS composition, USD geometry, and federated layer support.

## Installation

```bash
npm install @ifc-lite/ifcx
```

## Quick Start

```typescript
import { parseIfcx, detectFormat } from '@ifc-lite/ifcx';

// Detect file format
const format = detectFormat(buffer); // 'ifcx' | 'ifc' | 'glb' | 'unknown'

// Parse IFCX file
const result = await parseIfcx(buffer, {
  onProgress: ({ phase, percent }) => console.log(`${phase}: ${percent}%`),
});

console.log(`${result.entityCount} entities, ${result.meshes.length} meshes`);
```

## Features

- Native IFC5 (IFCX) JSON parsing
- ECS composition (Entity-Component-System)
- Pre-tessellated USD geometry extraction
- Federated layer support with property overlay
- Compatible with existing ifc-lite data pipeline
- Format auto-detection (IFC4 STEP vs IFC5 IFCX vs GLB)
- IFCX export/write support

## Federated Layers

```typescript
import { parseFederatedIfcx } from '@ifc-lite/ifcx';

const result = await parseFederatedIfcx([
  { buffer: baseBuffer, name: 'base.ifcx' },
  { buffer: overlayBuffer, name: 'overlay.ifcx' },
]);
// Properties from overlay take precedence over base
```

## API

See the [Parsing Guide](../../docs/guide/parsing.md) and [API Reference](../../docs/api/typescript.md#ifc-liteifcx).

## License

[MPL-2.0](../../LICENSE)

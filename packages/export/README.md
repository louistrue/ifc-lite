# @ifc-lite/export

Export formats for IFClite. Supports exporting IFC data to glTF/GLB, Apache Parquet, Apache Arrow, and IFC.

## Installation

```bash
npm install @ifc-lite/export
```

## Quick Start

```typescript
import { GeometryData } from '@ifc-lite/export';

// Export geometry to GLB
const glb = exportToGLB(geometryData);

// Export data to Parquet (15-50x smaller than JSON)
const parquet = exportToParquet(dataStore);
```

## Features

- GLB/glTF geometry export
- Apache Parquet serialization (columnar, compressed)
- Apache Arrow in-memory format
- IFC STEP export with mutations applied

## API

See the [Exporting Guide](../../docs/guide/exporting.md) and [API Reference](../../docs/api/typescript.md#ifc-liteexport).

## License

[MPL-2.0](../../LICENSE)

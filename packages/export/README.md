# @ifc-lite/export

Export formats for IFClite. Supports exporting IFC data to glTF/GLB, Apache Parquet, Apache Arrow, and IFC.

## Installation

```bash
npm install @ifc-lite/export
```

## Quick Start

```typescript
import { GLTFExporter, ParquetExporter, exportToStep } from '@ifc-lite/export';

// Export geometry to GLB
const gltfExporter = new GLTFExporter();
const glb = await gltfExporter.export(parseResult, { format: 'glb' });

// Export data to Parquet (15-50x smaller than JSON)
const parquetExporter = new ParquetExporter();
const parquet = await parquetExporter.exportEntities(parseResult);

// Export to IFC STEP (with mutations applied)
const step = await exportToStep(dataStore, mutations);
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

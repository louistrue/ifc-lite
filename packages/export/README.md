# @ifc-lite/export

Export formats for IFC-Lite. Supports exporting IFC data to glTF/GLB, Apache Parquet, Apache Arrow, IFC STEP, and IFC5 IFCX.

## Installation

```bash
npm install @ifc-lite/export
```

## Quick Start

```typescript
import { GLTFExporter, ParquetExporter, exportToStep, Ifc5Exporter, generateLod0, generateLod1 } from '@ifc-lite/export';

// Export geometry to GLB
const gltfExporter = new GLTFExporter();
const glb = await gltfExporter.export(parseResult, { format: 'glb' });

// Export data to Parquet (15-50x smaller than JSON)
const parquetExporter = new ParquetExporter();
const parquet = await parquetExporter.exportEntities(parseResult);

// Export to IFC STEP (with mutations applied)
const step = exportToStep(dataStore, { schema: 'IFC4' });

// Export to IFC5 IFCX (JSON + USD geometry)
const ifc5 = new Ifc5Exporter(dataStore, geometryResult);
const result = ifc5.export({ includeGeometry: true });
// result.content is IFCX JSON, save as .ifcx

// Generate lightweight LOD artifacts from IFC bytes
const lod0 = await generateLod0(ifcBytes);
const lod1 = await generateLod1(ifcBytes, { quality: 'medium' });
```

## Features

- GLB/glTF geometry export
- Apache Parquet serialization (columnar, compressed)
- Apache Arrow in-memory format
- IFC STEP export with mutations applied
- **IFC5 IFCX export** with USD geometry and full schema conversion
- Lightweight LOD0/LOD1 generation from IFC bytes
- Cross-schema conversion (IFC2X3 ↔ IFC4 ↔ IFC4X3 ↔ IFC5)

## Lightweight LOD Generation

The LOD generators are environment-agnostic. They accept IFC bytes, not file paths,
so the same API works in Node, browser, and server runtimes.

```typescript
import { generateLod0, generateLod1 } from '@ifc-lite/export';

const bytes = await file.arrayBuffer();

const lod0 = await generateLod0(bytes);
// => JSON envelopes, transforms, and world-space bounding boxes

const lod1 = await generateLod1(bytes, { quality: 'medium' });
// => { glb, meta }
```

`generateLod0()` returns cheap geometric envelopes for every placeable element.

`generateLod1()` returns:
- `glb`: binary GLB geometry
- `meta`: generation status, failed elements, and expressId → node/mesh mapping

If meshing fails, LOD1 degrades gracefully to box geometry derived from LOD0.

## IFC5 Export

The `Ifc5Exporter` converts IFC data from any schema version to the IFC5 IFCX JSON format:

```typescript
import { Ifc5Exporter } from '@ifc-lite/export';

const exporter = new Ifc5Exporter(dataStore, geometryResult, mutationView);
const result = exporter.export({
  includeGeometry: true,    // Convert meshes to USD format
  includeProperties: true,  // Map properties to bsi::ifc::prop:: namespace
  applyMutations: true,     // Apply property edits
  visibleOnly: false,       // Filter by visibility
});

// result.content → IFCX JSON string
// result.stats → { nodeCount, propertyCount, meshCount, fileSize }
```

Output includes:
- Entity types converted to IFC5 naming
- Properties in IFCX attribute namespaces (`bsi::ifc::prop::PsetName::PropName`)
- Tessellated geometry as USD meshes (`usd::usdgeom::mesh`)
- Spatial hierarchy as IFCX path-based nodes
- Presentation data (diffuse color, opacity)

## API

See the [Exporting Guide](../../docs/guide/exporting.md) and [API Reference](../../docs/api/typescript.md#ifc-liteexport).

## License

[MPL-2.0](../../LICENSE)

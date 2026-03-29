# @ifc-lite/data

Columnar data structures for IFClite. Provides TypedArray-based storage for IFC entities, properties, quantities, and relationships.

## Installation

```bash
npm install @ifc-lite/data
```

## Quick Start

```typescript
import { StringTableBuilder, EntityTableBuilder, RelationshipGraphBuilder } from '@ifc-lite/data';
import type { EntityTable, RelationshipGraph } from '@ifc-lite/data';

// String interning for efficient storage
const strings = new StringTableBuilder();
const id = strings.intern('IFCWALL');

// Columnar entity storage (builder pattern)
const entityBuilder = new EntityTableBuilder();
// ... add entities ...
const entities: EntityTable = entityBuilder.build();

// Relationship graph (builder pattern)
const graphBuilder = new RelationshipGraphBuilder();
// ... add relationships ...
const graph: RelationshipGraph = graphBuilder.build();
```

## Features

- Columnar (TypedArray) storage for entities, properties, and quantities
- String table with interning for memory efficiency
- Relationship graph with typed edges
- IFC type enum for fast type comparisons
- Spatial hierarchy representation
- Local EPSG CRS index with exact-code lookup and text search

## EPSG Lookup

```typescript
import { lookupEpsgByCode, searchEpsgIndex } from '@ifc-lite/data';

const lv95 = await lookupEpsgByCode(2056);
const search = await searchEpsgIndex('web mercator');
```

The EPSG search index is generated ahead of time and committed to the repo, so
normal builds stay offline and fast. Refresh it explicitly with
`pnpm generate:epsg-index`.

## API

See the [API Reference](../../docs/api/typescript.md#ifc-litedata).

## License

[MPL-2.0](../../LICENSE)

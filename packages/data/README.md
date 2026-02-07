# @ifc-lite/data

Columnar data structures for IFClite. Provides TypedArray-based storage for IFC entities, properties, quantities, and relationships.

## Installation

```bash
npm install @ifc-lite/data
```

## Quick Start

```typescript
import { StringTable, EntityTable, RelationshipGraph } from '@ifc-lite/data';

// String interning for efficient storage
const strings = new StringTable();
const id = strings.intern('IFCWALL');

// Columnar entity storage
const entities = new EntityTable(strings);

// Relationship graph
const graph = new RelationshipGraph();
```

## Features

- Columnar (TypedArray) storage for entities, properties, and quantities
- String table with interning for memory efficiency
- Relationship graph with typed edges
- IFC type enum for fast type comparisons
- Spatial hierarchy representation

## API

See the [API Reference](../../docs/api/typescript.md#ifc-litedata).

## License

[MPL-2.0](../../LICENSE)

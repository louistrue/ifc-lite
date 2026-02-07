# @ifc-lite/query

Query system for IFClite. Provides a fluent API for filtering and querying IFC entities by type, property, and relationship.

## Installation

```bash
npm install @ifc-lite/query
```

## Quick Start

```typescript
import { IfcQuery } from '@ifc-lite/query';

const query = new IfcQuery(dataStore);

// Find all external walls
const walls = query
  .byType('IFCWALL')
  .withProperty('Pset_WallCommon', 'IsExternal', true)
  .execute();
```

## Features

- Fluent query API
- Filter by IFC type, properties, and relationships
- SQL-like query expressions
- Multi-model query support

## API

See the [Querying Guide](../../docs/guide/querying.md) and [API Reference](../../docs/api/typescript.md#ifc-litequery).

## License

[MPL-2.0](../../LICENSE)

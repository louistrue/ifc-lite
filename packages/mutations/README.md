# @ifc-lite/mutations

Property editing and mutation tracking for IFClite. Edit IFC properties in-place with full change tracking, undo/redo, and export.

## Installation

```bash
npm install @ifc-lite/mutations
```

## Quick Start

```typescript
import { MutablePropertyView } from '@ifc-lite/mutations';

// Create a mutable view (params: PropertyTable | null, modelId)
const view = new MutablePropertyView(propertyTable, 'my-model');
view.setProperty(entityId, 'Pset_WallCommon', 'FireRating', 'REI 120');

// Get all changes
const mutations = view.getMutations();
```

## Features

- Mutation overlay on read-only IFC data
- Undo/redo support (via viewer store)
- Change sets for grouping related mutations
- Bulk query engine for updating many entities
- CSV import for spreadsheet-based updates
- Export modified data

## API

See the [Property Editing Guide](../../docs/guide/mutations.md) and [API Reference](../../docs/api/typescript.md#ifc-litemutations).

## License

[MPL-2.0](../../LICENSE)

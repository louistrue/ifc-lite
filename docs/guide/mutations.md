# Property Editing

IFClite supports editing IFC properties in-place with full change tracking, undo/redo, and export. The `@ifc-lite/mutations` package provides the mutation infrastructure, while the viewer integrates it with a property editor UI.

## How It Works

Mutations are tracked through a **MutablePropertyView** that wraps the original read-only IFC data store. When you edit a property:

1. The original value is preserved
2. The new value is stored in an overlay
3. Reads return the mutated value transparently
4. All changes are tracked as a `Mutation` with old/new values
5. Changes can be undone, redone, exported, and applied to other models

## Quick Start

### Editing Properties

```typescript
import { MutablePropertyView } from '@ifc-lite/mutations';

// Create a mutable view over the parsed IFC data
const view = new MutablePropertyView(ifcDataStore);

// Set a property value
const mutation = view.setProperty(
  entityId,       // Express ID of the entity
  'Pset_WallCommon',  // Property set name
  'FireRating',       // Property name
  'REI 120',          // New value
);

console.log(`Changed from "${mutation.oldValue}" to "${mutation.newValue}"`);

// Read the mutated value
const value = view.getProperty(entityId, 'Pset_WallCommon', 'FireRating');
// Returns 'REI 120'
```

### Undo / Redo

```typescript
// Get mutation history
const mutations = view.getMutations();

// Undo last change
view.undo(); // FireRating reverts to original value

// Redo
view.redo(); // FireRating back to 'REI 120'
```

### Change Sets

Change sets group related mutations for export and sharing:

```typescript
import { ChangeSetManager } from '@ifc-lite/mutations';

const manager = new ChangeSetManager();

// Create a change set
const changeSet = manager.createChangeSet('Fire Safety Updates');

// Record mutations in the change set
changeSet.record(mutation1);
changeSet.record(mutation2);

// Export as JSON
const json = JSON.stringify(changeSet);

// Import on another instance
const imported = manager.importChangeSet(json);
```

## Bulk Operations

For updating many entities at once, use the `BulkQueryEngine`:

```typescript
import { BulkQueryEngine } from '@ifc-lite/mutations';

const engine = new BulkQueryEngine(ifcDataStore);

// Define criteria - which entities to update
const query = {
  criteria: {
    type: 'IFCWALL',                    // All walls
    filter: { property: 'IsExternal', operator: 'equals', value: true },
  },
  action: {
    type: 'setProperty',
    psetName: 'Pset_WallCommon',
    propName: 'ThermalTransmittance',
    value: 0.18,
  },
};

// Preview changes before applying
const preview = engine.preview(query);
console.log(`Will update ${preview.matchCount} entities`);

// Apply
const result = engine.execute(query);
console.log(`Updated ${result.mutationCount} properties`);
```

## CSV Import

Import property updates from spreadsheets:

```typescript
import { CsvConnector } from '@ifc-lite/mutations';

const connector = new CsvConnector(ifcDataStore);

// Parse CSV
const rows = connector.parse(csvString, {
  delimiter: ',',
  header: true,
});

// Define mapping from CSV columns to IFC properties
const mapping = {
  matchColumn: 'GlobalId',          // Column to match entities
  matchStrategy: 'globalId',        // Match by IFC GlobalId
  properties: [
    { csvColumn: 'Fire Rating', psetName: 'Pset_WallCommon', propName: 'FireRating' },
    { csvColumn: 'U-Value', psetName: 'Pset_WallCommon', propName: 'ThermalTransmittance' },
  ],
};

// Import
const stats = connector.import(rows, mapping);
console.log(`Matched: ${stats.matched}, Updated: ${stats.updated}, Skipped: ${stats.skipped}`);
```

## Viewer Integration

In the IFClite viewer:

1. **Select an entity** in 3D or the hierarchy panel
2. **Open Properties panel** - Edit properties directly in the panel
3. **Bulk edit** - Use the Property Editor to update multiple entities
4. **Track changes** - Modified properties are highlighted
5. **Undo/Redo** - Ctrl+Z / Ctrl+Shift+Z to undo/redo edits
6. **Export** - Save modified IFC with changes applied

### Mutation State

| State | Description |
|-------|-------------|
| Modified entities | Count of entities with property changes |
| Dirty models | Models with unsaved mutations |
| Undo stack | Per-model undo history |
| Redo stack | Per-model redo history |
| Change sets | Named groups of mutations for export |

## Key Types

| Type | Description |
|------|-------------|
| `MutablePropertyView` | Wraps IFC data store with mutation overlay |
| `Mutation` | A single property change with old/new values |
| `ChangeSet` | Named collection of mutations |
| `ChangeSetManager` | Manages multiple change sets |
| `BulkQueryEngine` | Query and update entities in bulk |
| `CsvConnector` | Import property data from CSV files |

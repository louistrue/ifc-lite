# Custom Queries

Learn to build powerful queries with IFClite.

## Query Basics

```mermaid
flowchart LR
    Start["Query Builder"]
    Filter1["Type Filter"]
    Filter2["Property Filter"]
    Filter3["Spatial Filter"]
    Output["Results"]

    Start --> Filter1 --> Filter2 --> Filter3 --> Output
```

## Fluent API Examples

### Basic Type Queries

```typescript
import { IfcQuery } from '@ifc-lite/query';

const query = new IfcQuery(parseResult);

// Get all walls
const walls = query.walls().toArray();

// Get all doors and windows
const openings = query
  .ofTypes(['IFCDOOR', 'IFCWINDOW'])
  .toArray();

// Get only standard walls
const standardWalls = query
  .ofType('IFCWALLSTANDARDCASE')
  .toArray();
```

### Property Filters

```typescript
// External walls only
const externalWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .toArray();

// Walls with fire rating >= 60 minutes
const fireRatedWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)
  .toArray();

// Load-bearing elements
const loadBearing = query
  .all()
  .whereProperty('Pset_*Common', 'LoadBearing', '=', true)
  .toArray();

// Combine multiple filters
const criticalWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 90)
  .whereProperty('Pset_WallCommon', 'LoadBearing', '=', true)
  .toArray();
```

### Quantity Filters

```typescript
// Large walls by area
const largeWalls = query
  .walls()
  .whereQuantity('NetArea', '>', 20) // > 20 m²
  .toArray();

// Thick slabs
const thickSlabs = query
  .slabs()
  .whereQuantity('Thickness', '>=', 0.3) // >= 300mm
  .toArray();
```

### Spatial Queries

```typescript
// Get all elements on ground floor
const groundFloorElements = query
  .storey('Ground Floor')
  .contains()
  .toArray();

// Get all elements in a building
const buildingElements = query
  .building('Main Building')
  .allContained()
  .toArray();

// Get spaces on a specific storey
const storeySpaces = query
  .storey('Level 1')
  .contains()
  .ofType('IFCSPACE')
  .toArray();
```

### Relationship Traversal

```typescript
// Get materials for a wall
const wallMaterials = query
  .entity(wallId)
  .materials()
  .toArray();

// Get elements related to a space
const spaceElements = query
  .entity(spaceId)
  .related('IfcRelSpaceBoundary')
  .toArray();

// Find what contains this element
const container = query
  .entity(elementId)
  .containedIn()
  .entity();
```

## Building Complex Queries

### Query Composition

```typescript
// Create reusable query parts
function externalElements(q: IfcQuery): IfcQuery {
  return q.whereProperty('Pset_*Common', 'IsExternal', '=', true);
}

function fireRated(q: IfcQuery, rating: number): IfcQuery {
  return q.whereProperty('Pset_*Common', 'FireRating', '>=', rating);
}

// Compose queries
const externalFireRatedWalls = fireRated(
  externalElements(query.walls()),
  60
).toArray();
```

### Query Unions

```typescript
// Combine results from multiple queries
const structuralElements = [
  ...query.walls().whereProperty('Pset_WallCommon', 'LoadBearing', '=', true).toArray(),
  ...query.columns().toArray(),
  ...query.beams().toArray(),
  ...query.slabs().toArray()
];
```

### Exclusion Patterns

```typescript
// All elements except spaces and openings
const physicalElements = query
  .all()
  .where(e =>
    e.type !== 'IFCSPACE' &&
    e.type !== 'IFCOPENINGELEMENT'
  )
  .toArray();
```

## SQL Queries

For complex analytics, use SQL:

```typescript
// Enable SQL mode
await query.enableSQL();

// Simple aggregation
const wallCounts = await query.sql(`
  SELECT type, COUNT(*) as count
  FROM entities
  WHERE type LIKE 'IFCWALL%'
  GROUP BY type
`);

// Join with properties
const wallsWithFireRating = await query.sql(`
  SELECT
    e.express_id,
    e.name,
    p.value as fire_rating
  FROM entities e
  JOIN properties p ON e.express_id = p.entity_id
  WHERE e.type LIKE 'IFCWALL%'
    AND p.pset_name = 'Pset_WallCommon'
    AND p.prop_name = 'FireRating'
`);

// Complex analysis
const floorAreaByStorey = await query.sql(`
  WITH storey_spaces AS (
    SELECT
      s.express_id as storey_id,
      s.name as storey_name,
      e.express_id as space_id
    FROM entities s
    JOIN relationships r ON s.express_id = r.to_id
    JOIN entities e ON r.from_id = e.express_id
    WHERE s.type = 'IFCBUILDINGSTOREY'
      AND e.type = 'IFCSPACE'
      AND r.rel_type = 'IfcRelContainedInSpatialStructure'
  )
  SELECT
    ss.storey_name,
    SUM(q.value) as total_area
  FROM storey_spaces ss
  JOIN quantities q ON ss.space_id = q.entity_id
  WHERE q.name = 'NetFloorArea'
  GROUP BY ss.storey_name
  ORDER BY total_area DESC
`);
```

## Visualization Integration

### Color by Query

!!! note "Color Support"
    Dynamic per-entity coloring is not yet supported in the public API.
    This example shows the concept - actual implementation requires extending the renderer.

```typescript
import { IfcParser, extractPropertiesOnDemand } from '@ifc-lite/parser';
import { IfcQuery } from '@ifc-lite/query';

// First, parse the IFC file to get store and buffer
const parser = new IfcParser();
const response = await fetch('model.ifc');
const buffer = new Uint8Array(await response.arrayBuffer());
const store = await parser.parseColumnar(buffer.buffer);

// Create query from parsed store
const query = new IfcQuery(store);

// Get walls and their fire ratings
const walls = query.walls().toArray();

// Create color map based on fire rating
const colorMap = new Map<number, string>();

for (const wall of walls) {
  // Extract properties on-demand using the store and buffer from parseColumnar
  const props = extractPropertiesOnDemand(store, wall.expressId, buffer);
  const fireRating = props?.['Pset_WallCommon']?.FireRating || 0;

  if (fireRating >= 90) {
    colorMap.set(wall.expressId, 'red');
  } else if (fireRating >= 60) {
    colorMap.set(wall.expressId, 'orange');
  } else if (fireRating >= 30) {
    colorMap.set(wall.expressId, 'yellow');
  }
}

console.log('Fire rating analysis:', colorMap);
```

### Isolate Query Results

```typescript
// Isolate external walls (show only these)
const externalWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .toArray();

const isolatedIds = new Set(externalWalls.map(w => w.expressId));
renderer.render({ isolatedIds });
```

### Selection from Query

```typescript
// Select all fire-rated elements
const fireRated = query
  .all()
  .whereProperty('Pset_*Common', 'FireRating', '>', 0)
  .toArray();

const selectedIds = new Set(fireRated.map(e => e.expressId));
renderer.render({ selectedIds });
```

## Performance Tips

### 1. Filter Early

```typescript
// Good: filter by type first
const result = query
  .walls()  // Narrow down first
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .toArray();

// Bad: filter all entities
const result = query
  .all()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .ofType('IFCWALL')  // Type filter after property filter
  .toArray();
```

### 2. Use Count for Checks

```typescript
// Good: just check count
const hasExternalWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .count() > 0;

// Bad: get all results just to check existence
const externalWalls = query
  .walls()
  .whereProperty('Pset_WallCommon', 'IsExternal', '=', true)
  .toArray();
const hasExternalWalls = externalWalls.length > 0;
```

### 3. Use SQL for Complex Analytics

```typescript
// For simple queries: Fluent API
const walls = query.walls().toArray();

// For aggregations: SQL
const stats = await query.sql(`
  SELECT type, COUNT(*), AVG(quantity) ...
`);
```

## Next Steps

- [Extending the Parser](extending-parser.md) - Custom processing
- [API Reference](../api/typescript.md) - Query API

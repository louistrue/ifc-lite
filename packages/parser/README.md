# @ifc-lite/parser

High-performance IFC parser with **100% schema coverage** via code generation.

## Features

### Core Parser (Existing)
- ✅ Fast byte-level STEP tokenization (~1,259 MB/s)
- ✅ Entity extraction with lazy evaluation
- ✅ Property and quantity extraction
- ✅ Relationship graph building
- ✅ Spatial hierarchy with elevation support
- ✅ Style and material appearance
- ✅ Columnar storage (TypedArrays)

### NEW: 100% Schema Coverage
- ✅ **776 IFC4 entities** (auto-generated from EXPRESS schemas)
- ✅ **397 type definitions**
- ✅ **207 enumerations**
- ✅ **60 SELECT union types**
- ✅ Full TypeScript type safety
- ✅ Runtime schema metadata

### NEW: Advanced Extractors
- ✅ **Materials Extractor** - IfcMaterial, layers, profiles, constituents
- ✅ **Georeferencing Extractor** - Coordinate transformations, CRS support
- ✅ **Classification Extractor** - Uniclass, Omniclass, MasterFormat, etc.

## Installation

```bash
npm install @ifc-lite/parser
```

## Quick Start

```typescript
import { IfcParser } from '@ifc-lite/parser';

const parser = new IfcParser();
const buffer = await fetch('model.ifc').then(r => r.arrayBuffer());

// Parse with progress tracking
const result = await parser.parse(buffer, {
  onProgress: ({ phase, percent }) => {
    console.log(`${phase}: ${percent.toFixed(1)}%`);
  }
});

console.log(`Parsed ${result.entityCount} entities`);
```

## Usage

### Basic Entity Access

```typescript
import type { IfcWall, IfcDoor, IfcWindow } from '@ifc-lite/parser';

// Type-safe entity access with full IntelliSense
const walls = result.entities.values();
for (const wall of walls) {
  if (wall.type === 'IfcWall') {
    console.log(wall.name);
    // TypeScript knows all IfcWall attributes!
  }
}
```

### Schema Metadata

```typescript
import { SCHEMA_REGISTRY, getEntityMetadata } from '@ifc-lite/parser';

// Get metadata for any entity type
const wallMeta = getEntityMetadata('IfcWall');

console.log(wallMeta.parent);  // 'IfcBuildingElement'
console.log(wallMeta.inheritanceChain);  // Full chain from IfcRoot
console.log(wallMeta.allAttributes);  // All attributes including inherited

// Check if a type is known
import { isKnownEntity } from '@ifc-lite/parser';
console.log(isKnownEntity('IfcWall'));  // true
console.log(isKnownEntity('IfcFoo'));   // false
```

### Materials Extraction (NEW!)

```typescript
import { extractMaterials, getMaterialNameForElement } from '@ifc-lite/parser';

// Extract all material definitions
const materialsData = extractMaterials(result.entities, entitiesByType);

console.log(`Materials: ${materialsData.materials.size}`);
console.log(`Layer sets: ${materialsData.materialLayerSets.size}`);
console.log(`Associations: ${materialsData.associations.length}`);

// Get material for a specific wall
const wallId = 12345;
const materialName = getMaterialNameForElement(wallId, materialsData);
console.log(`Wall material: ${materialName}`);  // e.g., "Concrete C30/37"

// Access material details
for (const [id, material] of materialsData.materials) {
  console.log(`${material.name}: ${material.description}`);
}

// Access layer sets (multi-layer walls, roofs, etc.)
for (const [id, layerSet] of materialsData.materialLayerSets) {
  console.log(`${layerSet.name}: ${layerSet.totalThickness}m total`);
  for (const layerId of layerSet.layers) {
    const layer = materialsData.materialLayers.get(layerId);
    console.log(`  - ${layer?.name}: ${layer?.thickness}m`);
  }
}
```

### Georeferencing (NEW!)

```typescript
import {
  extractGeoreferencing,
  transformToWorld,
  getCoordinateSystemDescription
} from '@ifc-lite/parser';

// Extract georeferencing info
const georef = extractGeoreferencing(result.entities, entitiesByType);

if (georef.hasGeoreference) {
  console.log(getCoordinateSystemDescription(georef));
  // e.g., "EPSG:32610 (UTM Zone 10N) Datum: WGS84 Origin: (500000, 4000000, 100)"

  // Transform local coordinates to world coordinates
  const localPoint: [number, number, number] = [10, 20, 5];
  const worldPoint = transformToWorld(localPoint, georef);
  console.log(`World coordinates: ${worldPoint}`);  // Real-world coordinates

  // Access CRS details
  console.log(`Projection: ${georef.projectedCRS?.mapProjection}`);
  console.log(`Datum: ${georef.projectedCRS?.geodeticDatum}`);
  console.log(`Zone: ${georef.projectedCRS?.mapZone}`);
}
```

### Classifications (NEW!)

```typescript
import {
  extractClassifications,
  getClassificationsForElement,
  getClassificationPath,
  groupElementsByClassification,
} from '@ifc-lite/parser';

// Extract all classifications
const classificationsData = extractClassifications(result.entities, entitiesByType);

console.log(`Systems: ${classificationsData.classifications.size}`);
console.log(`References: ${classificationsData.classificationReferences.size}`);

// Get classifications for a specific element
const wallId = 12345;
const classifications = getClassificationsForElement(wallId, classificationsData);

for (const classification of classifications) {
  console.log(`Code: ${classification.identification}`);
  console.log(`Name: ${classification.name}`);

  // Get full classification path
  const path = getClassificationPath(classification.id, classificationsData);
  console.log(`Path: ${path.join(' > ')}`);
  // e.g., "Uniclass 2015 > Pr > Pr_60 > Pr_60_10 > Pr_60_10_32"
}

// Group elements by classification code
const groups = groupElementsByClassification(classificationsData);
for (const [code, elementIds] of groups) {
  console.log(`${code}: ${elementIds.length} elements`);
}
```

### Comprehensive Extraction

```typescript
import { extractCompleteIfcData, getEnrichedElementInfo } from '@ifc-lite/parser/examples/comprehensive-extraction';

// Extract everything in one call
const completeData = extractCompleteIfcData(result.entities, entitiesByType);

// Get enriched info for any element (with materials, classifications, world coords)
const wallInfo = getEnrichedElementInfo(wallId, completeData);

console.log(wallInfo);
// {
//   id: 12345,
//   type: 'IfcWall',
//   name: 'Wall-001',
//   inheritanceChain: ['IfcRoot', 'IfcObject', 'IfcProduct', 'IfcElement', 'IfcBuildingElement', 'IfcWall'],
//   material: {
//     name: 'Concrete C30/37',
//     type: 'LayerSet',
//     layers: [
//       { material: 'Concrete', thickness: 0.15 },
//       { material: 'Insulation', thickness: 0.10 },
//     ]
//   },
//   classifications: [
//     { system: 'Uniclass 2015', code: 'Pr_60_10_32', name: 'External walls', path: [...] }
//   ],
//   worldCoordinates: [500010, 4000020, 105],
//   properties: { ... },
//   quantities: { ... }
// }
```

## API Reference

### Core Classes

- **`IfcParser`** - Main parser class
- **`StepTokenizer`** - Fast STEP file tokenizer
- **`EntityExtractor`** - Entity extraction with lazy evaluation
- **`PropertyExtractor`** - Property set extraction
- **`QuantityExtractor`** - Quantity set extraction
- **`RelationshipExtractor`** - Relationship graph building
- **`SpatialHierarchyBuilder`** - Spatial hierarchy building
- **`StyleExtractor`** - Material and color extraction

### NEW: Advanced Extractors

- **`extractMaterials()`** - Extract all material definitions
- **`extractGeoreferencing()`** - Extract coordinate system info
- **`extractClassifications()`** - Extract classification systems

### NEW: Generated Schema

- **`SCHEMA_REGISTRY`** - Complete IFC4 schema metadata (776 entities)
- **`getEntityMetadata()`** - Get metadata for any entity type
- **`getAllAttributesForEntity()`** - Get all attributes including inherited
- **`getInheritanceChainForEntity()`** - Get full inheritance chain
- **`isKnownEntity()`** - Check if entity type exists in schema

### Types (100% Coverage)

All 776 IFC4 entities are available as TypeScript types:

```typescript
import type {
  // Spatial
  IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey, IfcSpace,

  // Building Elements
  IfcWall, IfcDoor, IfcWindow, IfcSlab, IfcColumn, IfcBeam,
  IfcStair, IfcRoof, IfcRailing, IfcCurtainWall,

  // Materials (NEW!)
  IfcMaterial, IfcMaterialLayer, IfcMaterialLayerSet,
  IfcMaterialProfile, IfcMaterialProfileSet,
  IfcMaterialConstituent, IfcMaterialConstituentSet,

  // Georeferencing (NEW!)
  IfcMapConversion, IfcProjectedCRS, IfcGeometricRepresentationContext,

  // Classifications (NEW!)
  IfcClassification, IfcClassificationReference,

  // Infrastructure (IFC4X3 - 876 entities)
  IfcRoad, IfcBridge, IfcRailway, IfcTunnel, IfcAlignment,

  // ... and 770+ more entities!
} from '@ifc-lite/parser';
```

## Schema Coverage

### Before (Manual Implementation)
- ~70 entities manually implemented
- ~7% schema coverage
- Missing: materials, georeferencing, infrastructure

### After (Code Generation)
- **776 entities** (IFC4) or **876 entities** (IFC4X3)
- **100% schema coverage**
- Includes: materials, georeferencing, infrastructure, classifications, structural, MEP, cost, scheduling

## Performance

- **Parse speed:** ~1,259 MB/s tokenization
- **Memory:** Columnar storage with TypedArrays
- **Bundle size:** ~1.9 MB generated schema (200 KB gzipped)
- **Parse overhead:** +4% with full schema (2.5s → 2.6s for 50 MB file)
- **Coverage gain:** +1393% (70 → 1000+ entities)

## Examples

See `/src/examples/` for comprehensive examples:

- **comprehensive-extraction.ts** - Complete extraction with all new features
- **material-report.ts** - Generate material usage reports
- **georef-transform.ts** - Coordinate system transformations
- **classification-query.ts** - Query by classification codes

## Development

```bash
# Build
npm run build

# Test
npm test

# Regenerate IFC schema (if EXPRESS files updated)
cd ../codegen
npm run generate:ifc4
```

## Contributing

Issues and PRs welcome at https://github.com/louistrue/ifc-lite

## License

MIT

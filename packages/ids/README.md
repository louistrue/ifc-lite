# @ifc-lite/ids

IDS (Information Delivery Specification) support for IFC-Lite.

## Features

- **Full IDS 1.0 Support**: Parse and validate buildingSMART IDS XML files
- **All Facet Types**: Entity, Attribute, Property, Classification, Material, PartOf
- **Multi-Language Reports**: Human-readable translations in English, German, French
- **Deep Viewer Integration**: Color-coded results, bidirectional selection, entity isolation

## Installation

```bash
npm install @ifc-lite/ids
```

## Usage

```typescript
import { parseIDS, validateIDS, createTranslationService } from '@ifc-lite/ids';

// Parse IDS file
const idsSpec = parseIDS(xmlContent);

// Create translation service
const translator = createTranslationService('en');

// Validate against IFC data
const report = await validateIDS(idsSpec, ifcDataStore, { translator });

// Get human-readable results
for (const specResult of report.specificationResults) {
  console.log(`${specResult.specificationName}: ${specResult.passRate}% passed`);

  for (const entityResult of specResult.entityResults) {
    if (!entityResult.passed) {
      for (const reqResult of entityResult.requirementResults) {
        if (!reqResult.passed) {
          console.log(`  - ${translator.describeFailure(reqResult)}`);
        }
      }
    }
  }
}
```

## Supported Languages

- English (en)
- German (de)
- French (fr)

## IDS Facets

| Facet | Description |
|-------|-------------|
| Entity | Match by IFC entity type (e.g., IfcWall, IfcDoor) |
| Attribute | Match by IFC attribute value (Name, Description, etc.) |
| Property | Match by property set and property value |
| Classification | Match by classification system and code |
| Material | Match by material assignment |
| PartOf | Match by spatial/compositional relationship |

## Constraint Types

| Constraint | Description |
|------------|-------------|
| SimpleValue | Exact match |
| Pattern | Regex pattern matching |
| Enumeration | One of a list of values |
| Bounds | Numeric range (min/max inclusive/exclusive) |

## License

MPL-2.0

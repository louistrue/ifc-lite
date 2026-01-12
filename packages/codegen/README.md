# @ifc-lite/codegen

TypeScript code generator from IFC EXPRESS schemas.

## Overview

This package parses official IFC EXPRESS schema files (.exp) from buildingSMART and generates:
- TypeScript entity interfaces with full inheritance
- Schema registry with type metadata
- Attribute definitions and type information
- Enum definitions

## Why?

Instead of manually implementing 1000+ IFC entity types, we generate them automatically from the official schemas. This gives us:
- ✅ 100% schema coverage
- ✅ Automatic updates when schemas change
- ✅ Type-safe TypeScript
- ✅ Consistent with IFC standard

## Usage

### Generate code from schema

```bash
npm run generate:ifc4      # Generate from IFC4 schema
npm run generate:ifc4x3    # Generate from IFC4X3 schema
```

### Programmatic usage

```typescript
import { parseExpressSchema, generateTypeScript } from '@ifc-lite/codegen';

const schema = parseExpressSchema('./schemas/IFC4.exp');
const code = generateTypeScript(schema);
```

## Architecture

```
IFC4.exp (EXPRESS schema)
    ↓
ExpressParser
    ↓
Schema AST (entities, types, enums)
    ↓
TypeScriptGenerator
    ↓
Generated files:
  - entities.ts (interfaces)
  - schema-registry.ts (metadata)
  - types.ts (enums, selects)
```

## EXPRESS Schema Format

EXPRESS is a data modeling language defined in ISO 10303-11. Example:

```express
ENTITY IfcWall
  SUBTYPE OF (IfcBuildingElement);
  PredefinedType : OPTIONAL IfcWallTypeEnum;
END_ENTITY;
```

## Generated Output

```typescript
export interface IfcWall extends IfcBuildingElement {
  PredefinedType?: IfcWallTypeEnum;
}

export const SCHEMA_REGISTRY = {
  IfcWall: {
    parent: 'IfcBuildingElement',
    attributes: [
      { name: 'PredefinedType', type: 'IfcWallTypeEnum', optional: true }
    ]
  }
};
```

## Testing

The generator includes comprehensive tests:
- EXPRESS parser tests (tokenization, entity parsing, type parsing)
- TypeScript generator tests (interface generation, inheritance)
- Integration tests (generate from real schemas, validate output)

```bash
npm test
```

## Integration with Parser

This package is **standalone** and does not depend on `@ifc-lite/parser`. Once the generated code is validated, it can be integrated into the parser package.

## License

MIT

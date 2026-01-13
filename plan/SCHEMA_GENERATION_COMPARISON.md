# Schema Generation Approach Comparison

## Overview

This document compares three different approaches to generating code from IFC EXPRESS schemas:

| Aspect | **IfcOpenShell** | **web-ifc** | **ifc-lite** |
|--------|-----------------|-------------|--------------|
| Parser | BNF Grammar + Generated | Regex-based | Regex-based |
| Languages | Python → C++/Python | TypeScript → TS/C++ | TypeScript → TypeScript |
| Rule Support | ✅ Full (WHERE/UNIQUE) | ❌ None | ❌ Parsed but not executed |
| Complexity | Very High | Medium | Low |
| Maturity | Production (10+ years) | Production | Production |

---

## 1. IfcOpenShell Approach

### Architecture

```
express.bnf (BNF Grammar)
       ↓
bootstrap.py (Parser Generator)
       ↓
express_parser.py (Generated Parser)
       ↓
Schema AST (nodes.py, schema.py)
       ↓
┌──────┴──────┐
↓             ↓
C++ Codegen   Python Runtime
(schema_class.py)  (Late-bound)
       ↓             ↓
*.h/*.cpp     Dynamic entities
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `express.bnf` | Formal BNF grammar for EXPRESS language | ~500 |
| `bootstrap.py` | Generates parser from BNF | ~200 |
| `express_parser.py` | Generated recursive descent parser | ~3000 |
| `nodes.py` | AST node definitions | ~400 |
| `schema.py` | Schema representation classes | ~300 |
| `schema_class.py` | C++ code generator | ~800 |
| `rule_compiler.py` | WHERE clause → Python code | ~600 |
| `rule_executor.py` | Execute validation rules | ~300 |

### EXPRESS Parsing

**Formal Grammar-Based** using BNF notation:

```bnf
entity_decl = ENTITY entity_head entity_body END_ENTITY ';' ;
entity_head = entity_id subsuper ';' ;
entity_body = { explicit_attr } [ derive_clause ] [ inverse_clause ] [ unique_clause ] [ where_clause ] ;
explicit_attr = attribute_decl { ',' attribute_decl } ':' [ OPTIONAL ] parameter_type ';' ;
```

The parser is **generated** from this grammar, not hand-written.

### Schema Representation

```python
class Schema:
    """In-memory representation of parsed EXPRESS schema"""
    types: OrderedCaseInsensitiveDict[TypeDeclaration]
    entities: OrderedCaseInsensitiveDict[EntityDeclaration]
    rules: OrderedCaseInsensitiveDict[RuleDeclaration]
    functions: OrderedCaseInsensitiveDict[FunctionDeclaration]

    # Derived collections
    enumerations: dict  # TypeDeclaration wrapping EnumerationType
    selects: dict       # TypeDeclaration wrapping SelectType
    simpletypes: dict   # Primitive type wrappers

class EntityDeclaration:
    name: str
    supertypes: list[str]
    attributes: list[Attribute]
    derived: list[DerivedAttribute]
    inverse: list[InverseAttribute]
    where: list[WhereRule]
    unique: list[UniqueRule]
```

### Code Generation Strategy

**Two-mode generation**:

1. **Early-bound (C++)**: Compile-time code generation
   - Generates `Ifc2x3.h`, `Ifc4.h`, `Ifc4x3.h`
   - Type-safe C++ classes with factory methods
   - String pooling for attribute names
   - CRC32 hashing for type identification

2. **Late-bound (Python)**: Runtime schema instantiation
   - Dynamic entity creation
   - Schema introspection at runtime
   - Python wrapper API

```python
# C++ generation (Early-bound)
class EarlyBoundCodeWriter:
    def write_entity(self, entity):
        # Generate factory method
        code = f"entity* create_{entity.name}("
        for attr in entity.attributes:
            code += f"{self.cpp_type(attr.type)} {attr.name}, "
        code += ");"
        return code

# Python generation (Late-bound)
class LateBoundSchemaInstantiator:
    def instantiate_entity(self, entity):
        # Build runtime schema definition
        return f"schema.add_entity('{entity.name}', {entity.supertypes}, {entity.attributes})"
```

### Rule Compilation (Unique to IfcOpenShell)

**WHERE clauses** are compiled to executable Python:

```python
# EXPRESS WHERE clause
WHERE
    WR1 : (NOT(EXISTS(PredefinedType))) OR
          (PredefinedType <> IfcWallTypeEnum.USERDEFINED) OR
          ((PredefinedType = IfcWallTypeEnum.USERDEFINED) AND EXISTS(SELF\IfcObject.ObjectType));

# Compiled Python
def WR1(self):
    return (not exists(self.PredefinedType)) or \
           (self.PredefinedType != IfcWallTypeEnum.USERDEFINED) or \
           ((self.PredefinedType == IfcWallTypeEnum.USERDEFINED) and \
            exists(express_getattr(self, 'ObjectType')))
```

**Three-valued logic** (true/false/unknown) is preserved using `express_getattr()`.

### Strengths

1. **Formal grammar** ensures complete EXPRESS coverage
2. **Rule validation** enables IFC conformance checking
3. **Dual output** (C++ and Python) from single source
4. **Battle-tested** over 10+ years
5. **Function/Procedure support** for complex EXPRESS constructs

### Weaknesses

1. **High complexity** - ~6000+ lines of code generation code
2. **Build dependencies** - Requires parser generation step
3. **Maintenance burden** - Grammar changes require regeneration

---

## 2. web-ifc Approach

### Architecture

```
IFC2X3.exp, IFC4.exp, IFC4X3.exp
              ↓
gen_functional_types.ts (Main Generator)
gen_functional_types_helpers.ts (Parsing)
gen_functional_types_interfaces.ts (Type Gen)
              ↓
     ┌────────┼────────┐
     ↓        ↓        ↓
ifc-schema.ts  schema-functions.cpp  ifc-schema.h
(TypeScript)   (C++ Metadata)        (CRC32 Constants)
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `gen_functional_types.ts` | Main generator orchestration | ~800 |
| `gen_functional_types_helpers.ts` | EXPRESS parsing helpers | ~400 |
| `gen_functional_types_interfaces.ts` | TypeScript interface generation | ~200 |
| `schema_aliases.ts` | Type aliases | ~50 |

### EXPRESS Parsing

**Regex-based line-by-line parsing**:

```typescript
function parseElements(data: string): Entity[] {
    let lines = data.split(";");
    let entities: Entity[] = [];

    for (let line of lines) {
        // Detect ENTITY declaration
        if (line.includes("ENTITY")) {
            let entityMatch = line.match(/ENTITY\s+(\w+)/);
            // ... parse entity
        }

        // Detect TYPE declaration
        if (line.includes("TYPE")) {
            let typeMatch = line.match(/TYPE\s+(\w+)\s*=\s*(.*)/);
            // ... parse type
        }

        // Parse properties
        if (line.includes(":")) {
            let propMatch = line.match(/(\w+)\s*:\s*(OPTIONAL\s+)?(.*)/);
            // ... parse property
        }
    }

    return entities;
}
```

### Type Mapping

```typescript
function expTypeToTSType(t: string): string {
    switch(t) {
        case "REAL":
        case "NUMBER":
        case "INTEGER": return "number";
        case "STRING": return "string";
        case "BOOLEAN": return "boolean";
        case "LOGICAL": return "logical";
        case "BINARY": return "number";
        default: return t;
    }
}

function expTypeToTypeNum(t: string): number {
    // Type numbers for C++ interop
    if (t === "INTEGER") return 10;
    if (t === "REAL" || t === "NUMBER") return 4;
    if (t === "STRING") return 1;
    if (t === "BOOLEAN" || t === "LOGICAL") return 3;
    return 5; // REF (entity reference)
}
```

### Code Generation Output

**TypeScript schema** (`ifc-schema.ts`):

```typescript
// Entity constructors
export const Constructors: Record<number, new (...args: any[]) => any> = {
    [IFCWALL]: IfcWall,
    [IFCDOOR]: IfcDoor,
    // ...
};

// Inheritance definitions
export const InheritanceDef: Record<number, number> = {
    [IFCWALL]: IFCBUILDINGELEMENT,
    [IFCBUILDINGELEMENT]: IFCELEMENT,
    // ...
};

// Inverse property mappings
export const InversePropertyDef: Record<number, InversePropertyDefInfo[]> = {
    [IFCWALL]: [
        { for: IFCRELVOIDSELEMENT, forAtt: 0, ifcName: "HasOpenings" },
    ],
    // ...
};
```

**C++ header** (`ifc-schema.h`):

```cpp
// CRC32 constants for type identification
#define IFCWALL 3512223829
#define IFCDOOR 395920057
#define IFCBUILDINGELEMENT 1545765605
```

### CRC32 Type Hashing

```typescript
function crc32(str: string, crcTable: number[]): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Usage: crc32("IFCWALL".toUpperCase(), crcTable) → 3512223829
```

This enables fast type lookup without string comparison in the C++ WASM runtime.

### Inheritance Walking

```typescript
function walkParents(entity: Entity, entities: Entity[]): void {
    if (entity.parent) {
        let parent = entities.find(e => e.name === entity.parent);
        if (parent) {
            walkParents(parent, entities);
            // Inherit properties from parent
            for (let prop of parent.props) {
                if (!entity.props.find(p => p.name === prop.name)) {
                    entity.props.unshift(prop);
                }
            }
        }
    }
}
```

### Strengths

1. **Dual-target** (TypeScript + C++ WASM) from single generator
2. **CRC32 hashing** enables fast runtime type dispatch
3. **Relatively simple** - ~1400 lines total
4. **Functional approach** with FromRawLineData/ToRawLineData

### Weaknesses

1. **No rule validation** - WHERE/UNIQUE clauses ignored
2. **Regex parsing** may miss edge cases
3. **No formal grammar** - harder to verify completeness
4. **Schema-specific** - regeneration needed per IFC version

---

## 3. ifc-lite Approach

### Architecture

```
IFC4.exp / IFC4X3.exp
         ↓
express-parser.ts (Regex Parser)
         ↓
ExpressSchema AST
         ↓
typescript-generator.ts
         ↓
┌────────┼────────┬────────┐
↓        ↓        ↓        ↓
entities.ts  enums.ts  selects.ts  schema-registry.ts
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `express-parser.ts` | EXPRESS parsing to AST | ~440 |
| `typescript-generator.ts` | TypeScript code generation | ~500 |
| `cli.ts` | Command-line interface | ~50 |
| `generator.ts` | File output orchestration | ~100 |

### EXPRESS Parsing

**Regex-based with structured AST**:

```typescript
export interface ExpressSchema {
    name: string;
    entities: EntityDefinition[];
    types: TypeDefinition[];
    enums: EnumDefinition[];
    selects: SelectDefinition[];
}

export interface EntityDefinition {
    name: string;
    isAbstract: boolean;
    supertype?: string;
    attributes: AttributeDefinition[];
    derived?: DerivedAttribute[];
    inverse?: InverseAttribute[];
    whereRules?: string[];    // Captured but not executed
    uniqueRules?: string[];   // Captured but not executed
}
```

**Parsing implementation**:

```typescript
function parseEntities(content: string): EntityDefinition[] {
    const entityRegex = /ENTITY\s+(\w+)([\s\S]*?)END_ENTITY\s*;/g;
    // ... match and parse each entity
}

function parseAttribute(name: string, typeStr: string, optional: boolean): AttributeDefinition {
    // Handle LIST, ARRAY, SET with bounds
    if (typeStr.includes('LIST')) {
        const listMatch = typeStr.match(/LIST\s+\[(\d+|\?):(\d+|\?)\]\s+OF\s+(.*)/);
        // Extract bounds and inner type
    }
    // ... handle ARRAY, SET similarly
}

function parseNestedCollection(typeStr: string): string {
    // Recursively handle LIST [2:?] OF LIST [2:?] OF IfcCartesianPoint
    if (typeStr.match(/^(LIST|ARRAY|SET)\s+\[/)) {
        const match = typeStr.match(/^(?:LIST|ARRAY|SET)\s+\[(?:\d+|\?):(?:\d+|\?)\]\s+OF\s+(.*)/);
        return `${parseNestedCollection(match[1].trim())}[]`;
    }
    return typeStr;
}
```

### Code Generation

**Entity interfaces**:

```typescript
function generateEntityInterface(entity: EntityDefinition, schema: ExpressSchema): string {
    let code = `export interface ${entity.name}`;

    if (entity.supertype) {
        code += ` extends ${entity.supertype}`;
    }

    code += ` {\n`;

    for (const attr of entity.attributes) {
        code += `  ${attr.name}${attr.optional ? '?' : ''}: ${mapType(attr.type)}`;
        if (attr.isArray || attr.isList || attr.isSet) {
            code += '[]';
        }
        code += ';\n';
    }

    code += `}`;
    return code;
}
```

**Schema registry** (runtime metadata):

```typescript
export const SCHEMA_REGISTRY: SchemaRegistry = {
    name: 'IFC4_ADD2_TC1',

    entities: {
        IfcWall: {
            name: 'IfcWall',
            isAbstract: false,
            parent: 'IfcBuildingElement',
            attributes: [
                { name: 'PredefinedType', type: 'IfcWallTypeEnum', optional: true, ... },
            ],
            allAttributes: [/* includes inherited */],
            inheritanceChain: ['IfcRoot', 'IfcObjectDefinition', 'IfcObject', 'IfcProduct', 'IfcElement', 'IfcBuildingElement', 'IfcWall'],
        },
    },

    types: { IfcLabel: 'STRING', IfcReal: 'REAL', ... },
    enums: { IfcWallTypeEnum: ['MOVABLE', 'PARAPET', 'PARTITIONING', ...], ... },
    selects: { IfcValue: ['IfcMeasureValue', 'IfcSimpleValue', ...], ... },
};
```

### Generated Output Structure

```
generated/ifc4/
├── entities.ts       # 776 interfaces with inheritance
├── types.ts          # Type aliases (IfcLabel = string)
├── enums.ts          # 207 enumerations
├── selects.ts        # 60 union types
├── schema-registry.ts # Runtime metadata
└── index.ts          # Re-exports
```

### Utility Functions

```typescript
// Get entity metadata
export function getEntityMetadata(typeName: string): EntityMetadata | undefined;

// Get all attributes including inherited
export function getAllAttributesForEntity(typeName: string): AttributeMetadata[];

// Get inheritance chain
export function getInheritanceChainForEntity(typeName: string): string[];

// Check if type is known entity
export function isKnownEntity(typeName: string): boolean;
```

### Strengths

1. **Simplest implementation** - ~1000 lines total
2. **Pure TypeScript** - No C++ build step
3. **Rich metadata** - Inheritance chains, all attributes
4. **Type-safe output** - Full TypeScript interfaces
5. **Tree-shakeable** - Separate files per category

### Weaknesses

1. **No rule execution** - WHERE/UNIQUE captured but not validated
2. **TypeScript only** - No C++ output
3. **No function parsing** - EXPRESS FUNCTION/PROCEDURE ignored
4. **Regex limitations** - Complex nested constructs may fail

---

## 4. Side-by-Side Comparison

### Parser Approach

| Feature | IfcOpenShell | web-ifc | ifc-lite |
|---------|-------------|---------|----------|
| **Parser Type** | Generated from BNF | Hand-written regex | Hand-written regex |
| **Grammar Coverage** | 100% EXPRESS | ~80% (entities, types) | ~85% (entities, types, enums) |
| **Nested Collections** | ✅ Full | ✅ Basic | ✅ Recursive |
| **FUNCTION/PROCEDURE** | ✅ | ❌ | ❌ |
| **WHERE Clauses** | ✅ Compiled | ❌ Ignored | ⚠️ Captured |
| **UNIQUE Rules** | ✅ Compiled | ❌ Ignored | ⚠️ Captured |
| **DERIVE Clauses** | ✅ | ⚠️ Partial | ⚠️ Captured |

### Output Targets

| Target | IfcOpenShell | web-ifc | ifc-lite |
|--------|-------------|---------|----------|
| **C++ Headers** | ✅ | ✅ | ❌ |
| **C++ Implementation** | ✅ | ✅ | ❌ |
| **TypeScript** | ❌ | ✅ | ✅ |
| **Python** | ✅ | ❌ | ❌ |
| **Runtime Metadata** | ✅ | ✅ | ✅ |

### Type Information

| Info | IfcOpenShell | web-ifc | ifc-lite |
|------|-------------|---------|----------|
| **Inheritance** | ✅ | ✅ | ✅ |
| **All Attributes** | ✅ | ✅ | ✅ |
| **Array Bounds** | ✅ | ⚠️ Partial | ✅ |
| **Optional Flags** | ✅ | ✅ | ✅ |
| **Type Constraints** | ✅ | ❌ | ❌ |

### Runtime Features

| Feature | IfcOpenShell | web-ifc | ifc-lite |
|---------|-------------|---------|----------|
| **Type Lookup** | String-based | CRC32 hash | String-based |
| **Validation** | ✅ Rule execution | ❌ | ❌ |
| **Entity Creation** | ✅ Factory methods | ✅ Constructors | ❌ Read-only |
| **Serialization** | ✅ | ✅ ToRawLineData | ❌ |

---

## 5. What ifc-lite Could Learn

### From IfcOpenShell

1. **Rule Compilation** - Implement WHERE clause validation:
   ```typescript
   // Future: rule-compiler.ts
   function compileWhereRule(rule: string, entity: EntityDefinition): Function {
       // Parse EXPRESS boolean expression
       // Generate TypeScript validation function
       return new Function('entity', `return ${compiledExpression};`);
   }
   ```

2. **Formal Grammar** - Consider parser generator for robustness:
   ```
   // express.pegjs (PEG.js grammar)
   EntityDecl = "ENTITY" _ name:Identifier _ body:EntityBody _ "END_ENTITY" ";"
   EntityBody = SubtypeOf? Attributes DeriveClause? InverseClause? WhereClause?
   ```

3. **Function Support** - Parse EXPRESS functions for derived attributes:
   ```typescript
   interface FunctionDefinition {
       name: string;
       parameters: ParameterDef[];
       returnType: string;
       body: string;  // Or compiled AST
   }
   ```

### From web-ifc

1. **CRC32 Type Hashing** - Faster type dispatch:
   ```typescript
   // Fast numeric type lookup instead of string comparison
   export const TYPE_IDS: Record<string, number> = {
       IfcWall: 3512223829,
       IfcDoor: 395920057,
   };

   export const CONSTRUCTORS: Record<number, EntityConstructor> = {
       [TYPE_IDS.IfcWall]: IfcWall,
   };
   ```

2. **Serialization Support** - Write IFC files:
   ```typescript
   function toRawLineData(entity: any): (string | number | null)[] {
       const metadata = getEntityMetadata(entity.type);
       return metadata.allAttributes.map(attr => entity[attr.name] ?? null);
   }
   ```

3. **Dual C++/TS Output** - For WASM optimization:
   ```typescript
   // Generate both TypeScript and C++ header
   function generateCppHeader(schema: ExpressSchema): string {
       let code = '#pragma once\n\n';
       for (const entity of schema.entities) {
           code += `#define ${entity.name.toUpperCase()} ${crc32(entity.name)}\n`;
       }
       return code;
   }
   ```

---

## 6. Recommended Enhancements for ifc-lite

### Priority 1: CRC32 Type IDs

Add fast numeric type identification:

```typescript
// packages/codegen/src/crc32.ts
export function crc32(str: string): number {
    const table = buildCRC32Table();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generated output
export const TYPE_IDS = {
    IfcWall: 3512223829,
    IfcDoor: 395920057,
    // ...
} as const;
```

### Priority 2: IFC Writing Support

Add serialization for IFC authoring:

```typescript
// packages/codegen/src/serialization-generator.ts
function generateSerializer(entity: EntityDefinition): string {
    return `
export function serialize${entity.name}(entity: ${entity.name}): string {
    const values = [
        ${entity.attributes.map(a => `serializeValue(entity.${a.name})`).join(',\n        ')}
    ];
    return \`#\${entity.expressId}=${entity.name.toUpperCase()}(\${values.join(',')});\`;
}
`;
}
```

### Priority 3: Validation Rules

Parse and optionally execute WHERE clauses:

```typescript
// packages/codegen/src/rule-parser.ts
interface WhereRule {
    name: string;
    expression: string;
    compiled?: (entity: any) => boolean;
}

function parseWhereRule(rule: string): WhereRule {
    const match = rule.match(/(\w+)\s*:\s*(.*)/);
    return {
        name: match[1],
        expression: match[2],
        compiled: compileExpression(match[2]),
    };
}

// Usage
const isValid = SCHEMA_REGISTRY.entities.IfcWall.whereRules
    .every(rule => rule.compiled(wallEntity));
```

### Priority 4: Rust Schema Integration

Generate Rust code for the geometry engine:

```typescript
// packages/codegen/src/rust-generator.ts
function generateRustEnum(schema: ExpressSchema): string {
    let code = '#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]\n';
    code += 'pub enum IfcType {\n';
    for (const entity of schema.entities) {
        code += `    ${entity.name},\n`;
    }
    code += '}\n';
    return code;
}
```

---

## 7. Summary

| Approach | Best For | Complexity | Recommendation |
|----------|----------|------------|----------------|
| **IfcOpenShell** | Full IFC compliance, validation | Very High | Reference implementation |
| **web-ifc** | Browser WASM with writing | Medium | Good balance |
| **ifc-lite** | TypeScript-first, read-only | Low | Extend for writing |

### ifc-lite Path Forward

1. **Keep regex parser** - Works well for 95% of cases
2. **Add CRC32 type IDs** - Performance optimization
3. **Add serialization** - Enable IFC writing
4. **Consider rule validation** - For IFC conformance
5. **Generate Rust types** - Unify schema across languages

The current ifc-lite approach is pragmatic and effective. The main gaps are:
- No IFC writing capability
- No validation rules
- No C++/Rust output

These can be addressed incrementally without replacing the core regex-based parser.

# Code Style

Coding conventions and style guide for IFC-Lite.

## TypeScript

### Formatting

We use Prettier with these settings:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `IfcParser` |
| Interfaces | PascalCase | `ParseResult` |
| Functions | camelCase | `parseEntity()` |
| Variables | camelCase | `entityCount` |
| Constants | UPPER_SNAKE | `MAX_ENTITIES` |
| Files | kebab-case | `ifc-parser.ts` |

### Code Organization

```typescript
// 1. Imports (external first, then internal)
import { something } from 'external-package';
import { internal } from './internal';

// 2. Types and interfaces
interface MyInterface {
  property: string;
}

// 3. Constants
const MAX_VALUE = 100;

// 4. Main class/function
export class MyClass {
  // Properties first
  private value: number;

  // Constructor
  constructor() {}

  // Public methods
  public doSomething(): void {}

  // Private methods
  private helperMethod(): void {}
}

// 5. Helper functions
function helper(): void {}
```

### TypeScript Best Practices

```typescript
// Use explicit return types
function calculate(x: number): number {
  return x * 2;
}

// Prefer interfaces over types for objects
interface Entity {
  id: number;
  name: string;
}

// Use readonly where appropriate
interface ParseResult {
  readonly entities: Entity[];
  readonly count: number;
}

// Use null over undefined for explicit absence
function findEntity(id: number): Entity | null {
  return entities.get(id) ?? null;
}

// Avoid any - use unknown if type is truly unknown
function parse(data: unknown): Entity {
  // Validate and cast
}

// Use const assertions for literals
const ViewPresets = ['front', 'back', 'top'] as const;
type ViewPreset = typeof ViewPresets[number];
```

## Rust

### Formatting

We use rustfmt with default settings:

```bash
cargo fmt
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Structs | PascalCase | `EntityDecoder` |
| Enums | PascalCase | `IfcType` |
| Functions | snake_case | `parse_entity()` |
| Variables | snake_case | `entity_count` |
| Constants | UPPER_SNAKE | `MAX_ENTITIES` |
| Modules | snake_case | `entity_decoder` |

### Code Organization

```rust
//! Module documentation

// 1. Imports
use std::collections::HashMap;
use crate::parser::Token;

// 2. Constants
const MAX_ENTITIES: usize = 1_000_000;

// 3. Types
pub struct MyStruct {
    field: u32,
}

// 4. Implementations
impl MyStruct {
    /// Creates a new instance
    pub fn new() -> Self {
        Self { field: 0 }
    }

    /// Public method
    pub fn public_method(&self) -> u32 {
        self.field
    }

    /// Private helper
    fn private_helper(&self) -> u32 {
        self.field * 2
    }
}

// 5. Traits
pub trait MyTrait {
    fn do_something(&self);
}

// 6. Helper functions
fn helper_function() -> u32 {
    42
}
```

### Rust Best Practices

```rust
// Use Result for fallible operations
pub fn parse(input: &[u8]) -> Result<Entity, Error> {
    // ...
}

// Prefer borrowing over ownership
pub fn process(entity: &Entity) -> String {
    // ...
}

// Use iterators over index loops
for entity in entities.iter() {
    // ...
}

// Use ? for error propagation
pub fn decode(id: u32) -> Result<Entity, Error> {
    let location = self.index.get(id)?;
    let data = self.read_bytes(location)?;
    Ok(self.parse(data)?)
}

// Document public APIs
/// Parses an IFC entity from bytes.
///
/// # Arguments
/// * `input` - Raw byte slice containing the entity
///
/// # Returns
/// Parsed entity or error
///
/// # Example
/// ```
/// let entity = parse_entity(b"#1=IFCWALL();")?;
/// ```
pub fn parse_entity(input: &[u8]) -> Result<Entity, Error> {
    // ...
}
```

## Documentation

### TypeScript Documentation

Use JSDoc for public APIs:

```typescript
/**
 * Parses an IFC file from a buffer.
 *
 * @param buffer - The IFC file contents as ArrayBuffer
 * @param options - Optional parsing configuration
 * @returns Promise resolving to parse result
 *
 * @example
 * ```typescript
 * const result = await parser.parse(buffer);
 * console.log(`Parsed ${result.entityCount} entities`);
 * ```
 */
async parse(buffer: ArrayBuffer, options?: ParseOptions): Promise<ParseResult> {
  // ...
}
```

### Rust Documentation

Use doc comments for public APIs:

```rust
/// Parses an IFC file from bytes.
///
/// This function tokenizes the STEP file and extracts
/// all entities with their attributes.
///
/// # Arguments
///
/// * `input` - Raw byte slice containing the IFC file
///
/// # Returns
///
/// * `Ok(ParseResult)` - Successfully parsed result
/// * `Err(Error)` - Parse error with details
///
/// # Examples
///
/// ```
/// let content = std::fs::read("model.ifc")?;
/// let result = parse(&content)?;
/// println!("Found {} entities", result.entity_count);
/// ```
///
/// # Errors
///
/// Returns an error if:
/// - The file is not valid STEP/IFC format
/// - An entity has malformed attributes
pub fn parse(input: &[u8]) -> Result<ParseResult, Error> {
    // ...
}
```

## Commit Messages

Follow conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting |
| `refactor` | Code restructuring |
| `perf` | Performance improvement |
| `test` | Adding tests |
| `chore` | Maintenance |

### Examples

```
feat(parser): add streaming parse support

Implement streaming parser that emits events as entities
are parsed, reducing memory usage for large files.

Closes #123
```

```
fix(renderer): correct depth sorting for transparent meshes

Transparent meshes were rendering in wrong order causing
visual artifacts. Now sorted back-to-front before render.
```

## Pull Requests

### PR Title

Follow the same format as commit messages:

```
feat(parser): add streaming parse support
```

### PR Description

```markdown
## Summary

Brief description of changes.

## Changes

- Added streaming parser
- Updated tests
- Added documentation

## Testing

How was this tested?

## Screenshots

(if applicable)
```

## Linting

### TypeScript

```bash
# Run ESLint
pnpm lint

# Fix issues
pnpm lint --fix
```

### Rust

```bash
# Run Clippy
cargo clippy

# With warnings as errors
cargo clippy -- -D warnings
```

## Next Steps

- [Testing](testing.md) - Testing guide
- [Setup](setup.md) - Development setup

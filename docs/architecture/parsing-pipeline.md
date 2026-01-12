# Parsing Pipeline

Detailed architecture of the IFC-Lite parsing system.

## Overview

The parsing pipeline transforms STEP/IFC files into structured data:

```mermaid
flowchart TB
    subgraph Stage1["Stage 1: Tokenization"]
        Input["UTF-8 Bytes"]
        Lexer["STEP Lexer (nom)"]
        Tokens["Token Stream"]
        Input --> Lexer --> Tokens
    end

    subgraph Stage2["Stage 2: Entity Scanning"]
        Scanner["Entity Scanner"]
        Index["Entity Index"]
        Tokens --> Scanner --> Index
    end

    subgraph Stage3["Stage 3: Decoding"]
        Decoder["Entity Decoder"]
        Entities["Decoded Entities"]
        Index --> Decoder --> Entities
    end

    subgraph Stage4["Stage 4: Building"]
        Builder["Data Builder"]
        Tables["Columnar Tables"]
        Graph["Relationship Graph"]
        Entities --> Builder
        Builder --> Tables
        Builder --> Graph
    end

    style Stage1 fill:#6366f1,stroke:#312e81,color:#fff
    style Stage2 fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Stage3 fill:#10b981,stroke:#064e3b,color:#fff
    style Stage4 fill:#f59e0b,stroke:#7c2d12,color:#fff
```

## Stage 1: Tokenization

### Token Types

```mermaid
classDiagram
    class Token {
        <<enumeration>>
        Keyword
        String
        Integer
        Float
        EntityRef
        Enum
        Binary
        Asterisk
        Dollar
        OpenParen
        CloseParen
        Comma
        Semicolon
        Equals
    }

    class TokenValue {
        +string raw
        +number? intValue
        +number? floatValue
        +string? strValue
        +number? refId
    }

    Token --> TokenValue
```

### Lexer Architecture

```mermaid
flowchart LR
    subgraph Input["Input"]
        Bytes["bytes: &[u8]"]
    end

    subgraph Combinators["nom Combinators"]
        WS["multispace0"]
        Tag["tag(...)"]
        Alt["alt(...)"]
        Many["many0(...)"]
    end

    subgraph Output["Output"]
        Token["Token"]
        Remaining["&[u8]"]
    end

    Input --> Combinators --> Output
```

### Key Lexer Functions

```rust
// Entity reference: #123
fn entity_ref(input: &[u8]) -> IResult<&[u8], Token> {
    let (input, _) = tag(b"#")(input)?;
    let (input, num) = digit1(input)?;
    let id = parse_u32(num)?;
    Ok((input, Token::EntityRef(id)))
}

// String literal: 'Hello World'
fn string_literal(input: &[u8]) -> IResult<&[u8], Token> {
    let (input, _) = tag(b"'")(input)?;
    let (input, content) = take_until("'")(input)?;
    let (input, _) = tag(b"'")(input)?;
    Ok((input, Token::String(content)))
}

// Keyword: IFCWALL
fn keyword(input: &[u8]) -> IResult<&[u8], Token> {
    let (input, word) = alpha1(input)?;
    Ok((input, Token::Keyword(word)))
}
```

### Performance Optimizations

| Optimization | Technique | Benefit |
|--------------|-----------|---------|
| Zero-copy | Store byte slices | No allocation |
| SIMD search | memchr crate | 10x faster search |
| Fast numbers | lexical-core | 5x faster parsing |
| Branch prediction | Ordered alternatives | Better CPU prediction |

## Stage 2: Entity Scanning

### Scanner State Machine

```mermaid
stateDiagram-v2
    [*] --> Scanning
    Scanning --> FoundHash: '#' byte
    FoundHash --> ParsingId: digit
    ParsingId --> ParsingId: digit
    ParsingId --> FoundEquals: '='
    FoundEquals --> ParsingType: UPPER
    ParsingType --> ParsingType: UPPER/digit
    ParsingType --> Indexed: '('
    Indexed --> Scanning: store index
    Scanning --> [*]: EOF
```

### Entity Index Structure

```mermaid
classDiagram
    class EntityIndex {
        +HashMap~u32, EntityLocation~ locations
        +Vec~u32~ orderedIds
        +u32 count
        +get(id: u32) EntityLocation
        +iter() Iterator
    }

    class EntityLocation {
        +u32 expressId
        +usize offset
        +usize length
        +IfcType type
    }

    EntityIndex "1" --> "*" EntityLocation
```

### Scanning Algorithm

```rust
pub fn scan_entities(input: &[u8]) -> EntityIndex {
    let mut index = EntityIndex::new();
    let mut pos = 0;

    while pos < input.len() {
        // Find next entity marker
        if let Some(hash_pos) = memchr(b'#', &input[pos..]) {
            pos += hash_pos;

            // Parse entity ID
            let (id, id_end) = parse_entity_id(&input[pos..]);

            // Find '=' and type name
            if let Some(type_start) = find_type_start(&input[pos + id_end..]) {
                let type_name = extract_type_name(&input[pos + id_end + type_start..]);

                // Store location
                index.insert(id, EntityLocation {
                    expressId: id,
                    offset: pos,
                    type: IfcType::from_name(type_name),
                });
            }

            pos += 1;
        } else {
            break;
        }
    }

    index
}
```

## Stage 3: Entity Decoding

### Decoder Architecture

```mermaid
flowchart TB
    subgraph Input["Input"]
        Index["Entity Index"]
        Buffer["File Buffer"]
    end

    subgraph Decode["Decode Process"]
        Lookup["Lookup Location"]
        Slice["Get Byte Slice"]
        Parse["Parse Attributes"]
        Resolve["Resolve References"]
    end

    subgraph Output["Output"]
        Entity["DecodedEntity"]
    end

    Index --> Lookup
    Buffer --> Slice
    Lookup --> Slice
    Slice --> Parse --> Resolve --> Entity
```

### Lazy vs Eager Decoding

```mermaid
flowchart LR
    subgraph Eager["Eager Decoding"]
        E1["Parse All"]
        E2["Store All"]
        E3["High Memory"]
    end

    subgraph Lazy["Lazy Decoding (IFC-Lite)"]
        L1["Index Only"]
        L2["Decode on Access"]
        L3["Low Memory"]
    end
```

### Attribute Value Types

```mermaid
classDiagram
    class AttributeValue {
        <<enumeration>>
        Null
        Integer(i64)
        Float(f64)
        String(String)
        Boolean(bool)
        Enum(String)
        EntityRef(u32)
        List(Vec~AttributeValue~)
        Derived
    }
```

## Stage 4: Data Building

### Builder Pipeline

```mermaid
flowchart TB
    subgraph Decode["Decoded Entities"]
        E1["Entity 1"]
        E2["Entity 2"]
        E3["Entity N"]
    end

    subgraph Classify["Classification"]
        Spatial["Spatial Elements"]
        Product["Building Products"]
        Rel["Relationships"]
        Props["Property Sets"]
    end

    subgraph Build["Build Tables"]
        ET["Entity Table"]
        PT["Property Table"]
        QT["Quantity Table"]
        RG["Relationship Graph"]
    end

    Decode --> Classify --> Build
```

### Columnar Table Building

```rust
pub struct EntityTableBuilder {
    express_ids: Vec<u32>,
    type_enums: Vec<u16>,
    global_id_indices: Vec<u32>,
    name_indices: Vec<u32>,
    flags: Vec<u8>,
}

impl EntityTableBuilder {
    pub fn add(&mut self, entity: &DecodedEntity, strings: &mut StringTable) {
        self.express_ids.push(entity.express_id);
        self.type_enums.push(entity.type_enum);
        self.global_id_indices.push(
            strings.intern(&entity.global_id)
        );
        self.name_indices.push(
            entity.name.map(|n| strings.intern(n)).unwrap_or(0)
        );
        self.flags.push(entity.compute_flags());
    }

    pub fn build(self) -> EntityTable {
        EntityTable {
            express_ids: Uint32Array::from(self.express_ids),
            type_enums: Uint16Array::from(self.type_enums),
            // ...
        }
    }
}
```

### Relationship Graph Building

```mermaid
flowchart TB
    subgraph Input["Relationship Entities"]
        Contains["IfcRelContainedIn..."]
        Aggregates["IfcRelAggregates"]
        Associates["IfcRelAssociates..."]
    end

    subgraph Process["Processing"]
        Extract["Extract (from, to, type)"]
        Sort["Sort by 'from' ID"]
        Build["Build CSR"]
    end

    subgraph Output["CSR Graph"]
        Offsets["offsets[]"]
        Edges["edges[]"]
        Types["types[]"]
    end

    Input --> Extract --> Sort --> Build --> Output
```

## Streaming Architecture

```mermaid
sequenceDiagram
    participant File
    participant Chunker
    participant Parser
    participant Builder
    participant Client

    File->>Chunker: Read file
    loop For each chunk
        Chunker->>Parser: Chunk bytes
        Parser->>Parser: Tokenize
        Parser->>Parser: Scan entities
        Parser->>Builder: Entity batch
        Builder->>Client: Progress event
    end
    Builder->>Client: Complete event
```

### Chunk Processing

```typescript
interface StreamConfig {
  chunkSize: number;      // Bytes per chunk (default: 1MB)
  batchSize: number;      // Entities per batch (default: 100)
  onProgress: (p: Progress) => void;
  onBatch: (b: EntityBatch) => void;
}

async function parseStreaming(
  buffer: ArrayBuffer,
  config: StreamConfig
): Promise<ParseResult> {
  const totalSize = buffer.byteLength;
  let offset = 0;

  while (offset < totalSize) {
    const chunk = buffer.slice(offset, offset + config.chunkSize);
    const entities = await parseChunk(chunk);

    config.onBatch({ entities });
    config.onProgress({ percent: (offset / totalSize) * 100 });

    offset += config.chunkSize;
  }
}
```

## Error Handling

### Error Types

```mermaid
classDiagram
    class ParseError {
        <<abstract>>
        +string message
        +number? line
        +number? column
    }

    class TokenError {
        +string expected
        +string found
    }

    class SchemaError {
        +string entityType
        +string reason
    }

    class ValidationError {
        +number entityId
        +string violation
    }

    ParseError <|-- TokenError
    ParseError <|-- SchemaError
    ParseError <|-- ValidationError
```

### Error Recovery

```mermaid
flowchart TD
    Error["Parse Error"]
    Check{"Recoverable?"}
    Skip["Skip to next entity"]
    Log["Log warning"]
    Continue["Continue parsing"]
    Throw["Throw error"]

    Error --> Check
    Check -->|Yes| Skip
    Skip --> Log
    Log --> Continue
    Check -->|No| Throw
```

## Performance Metrics

| File Size | Tokenize | Scan | Decode | Build | Total |
|-----------|----------|------|--------|-------|-------|
| 10 MB | 8ms | 15ms | 200ms | 50ms | ~300ms |
| 50 MB | 40ms | 75ms | 800ms | 200ms | ~1.1s |
| 100 MB | 80ms | 150ms | 1.5s | 400ms | ~2.1s |

### Throughput

- **Tokenization**: ~1,259 MB/s
- **Entity scanning**: ~650 MB/s
- **Full parsing**: ~50 MB/s

## Next Steps

- [Geometry Pipeline](geometry-pipeline.md) - Geometry processing
- [Rendering Pipeline](rendering-pipeline.md) - WebGPU rendering
- [API Reference](../api/rust.md) - Parser API

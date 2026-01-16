# IFClite Documentation

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } __Get Started Quickly__

    ---

    Install IFClite and parse your first IFC file in under 5 minutes.

    [:octicons-arrow-right-24: Quick Start](guide/quickstart.md)

-   :material-book-open-variant:{ .lg .middle } __User Guide__

    ---

    Learn how to use all features of IFClite for parsing, geometry, and rendering.

    [:octicons-arrow-right-24: User Guide](guide/parsing.md)

-   :material-cog:{ .lg .middle } __Architecture__

    ---

    Understand the system design and how data flows through IFClite.

    [:octicons-arrow-right-24: Architecture](architecture/overview.md)

-   :material-api:{ .lg .middle } __API Reference__

    ---

    Complete API documentation for TypeScript and Rust.

    [:octicons-arrow-right-24: API Reference](api/typescript.md)

</div>

## What is IFClite?

**IFClite** is a high-performance, browser-native IFC (Industry Foundation Classes) platform. It provides:

- **Fast Parsing**: Zero-copy STEP tokenization at ~1,259 MB/s
- **Streaming Geometry**: Progressive mesh processing with first triangles in 300-500ms
- **WebGPU Rendering**: Modern GPU-accelerated 3D visualization
- **Tiny Bundle**: Only ~86 KB total (93% smaller than alternatives)
- **Full Schema Support**: 100% IFC4 coverage (776 entities)

## System Overview

```mermaid
flowchart TB
    subgraph Input["Input Layer"]
        IFC[("IFC File")]
    end

    subgraph Parser["Parsing Layer (Rust/WASM)"]
        direction TB
        STEP["STEP Tokenizer<br/>nom-based"]
        Scanner["Entity Scanner<br/>zero-copy"]
        Decoder["Entity Decoder<br/>lazy parsing"]
        STEP --> Scanner --> Decoder
    end

    subgraph Storage["Storage Layer"]
        direction LR
        Columnar["Columnar Tables<br/>TypedArrays"]
        Graph["Relationship Graph<br/>CSR Format"]
        Buffers["Geometry Buffers<br/>GPU-ready"]
    end

    subgraph Query["Query Layer"]
        direction LR
        Fluent["Fluent API"]
        SQL["SQL (DuckDB)"]
        Traverse["Graph Traversal"]
    end

    subgraph Output["Output Layer"]
        direction LR
        Renderer["WebGPU Renderer"]
        Analytics["Analytics<br/>Parquet"]
        Export["Export<br/>glTF/JSON-LD"]
    end

    IFC --> Parser
    Parser --> Storage
    Storage --> Query
    Query --> Output

    style Input fill:#6366f1,stroke:#312e81,color:#fff
    style Parser fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Storage fill:#16a34a,stroke:#14532d,color:#fff
    style Query fill:#ea580c,stroke:#7c2d12,color:#fff
    style Output fill:#c026d3,stroke:#701a75,color:#fff
```

## Quick Example

=== "TypeScript"

    ```typescript
    import { IfcParser } from '@ifc-lite/parser';
    import { Renderer } from '@ifc-lite/renderer';

    // Parse IFC file
    const parser = new IfcParser();
    const file = await fetch('model.ifc').then(r => r.arrayBuffer());
    const result = await parser.parse(file);

    // Query entities
    const walls = result.entities.filter(e => e.type === 'IFCWALL');
    console.log(`Found ${walls.length} walls`);

    // Render geometry
    const canvas = document.getElementById('viewer');
    const renderer = new Renderer(canvas);
    await renderer.loadGeometry(result.geometry);
    renderer.render();
    ```

=== "Rust"

    ```rust
    use ifc_lite_core::{parse_stream, StreamConfig, ParseEvent};

    // Parse IFC file
    let content = std::fs::read_to_string("model.ifc")?;
    let config = StreamConfig::default();

    // Stream parse events
    for event in parse_stream(&content, config) {
        match event {
            ParseEvent::Entity { id, type_name, .. } => {
                println!("Entity #{}: {}", id, type_name);
            }
            ParseEvent::Progress { percent } => {
                println!("Progress: {}%", percent);
            }
            _ => {}
        }
    }
    ```

## Key Features

| Feature | Description |
|---------|-------------|
| **Zero-Copy Parsing** | Direct memory access without data copying |
| **Streaming Pipeline** | Progressive geometry processing |
| **WebGPU Rendering** | Modern GPU acceleration |
| **Columnar Storage** | Memory-efficient TypedArray storage |
| **Full IFC4X3 Schema** | 876 entities, 449 types, 211 enums |
| **Cross-Platform** | Browser, Node.js, and native Rust |

## Performance Comparison

```mermaid
xychart-beta
    title "WASM Size (MB)"
    x-axis ["IFClite", "web-ifc", "IfcOpenShell"]
    y-axis "Size (MB)" 0 --> 16
    bar [0.65, 1.1, 15]
```

## Browser Support

| Browser | Version | WebGPU |
|---------|---------|--------|
| Chrome | 113+ | :material-check: |
| Edge | 113+ | :material-check: |
| Firefox | 127+ | :material-check: |
| Safari | 18+ | :material-check: |

## Next Steps

<div class="grid cards" markdown>

-   [:material-download: __Installation__](guide/installation.md)

    Install IFClite in your project

-   [:material-play: __Quick Start__](guide/quickstart.md)

    Parse your first IFC file

-   [:material-school: __Tutorials__](tutorials/building-viewer.md)

    Build a complete IFC viewer

-   [:material-github: __Source Code__](https://github.com/louistrue/ifc-lite)

    View on GitHub

</div>


# Architecture Overview

This document describes the high-level architecture of IFC-Lite.

## System Architecture

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        App["Web Application"]
        CLI["CLI Tools"]
        Scripts["Scripts/Automation"]
    end

    subgraph API["API Layer"]
        TSApi["TypeScript API"]
        RustApi["Rust API"]
        WasmApi["WASM Bindings"]
    end

    subgraph Core["Core Layer"]
        Parser["Parser"]
        Geometry["Geometry"]
        Query["Query Engine"]
        Export["Export"]
    end

    subgraph Storage["Storage Layer"]
        Columnar["Columnar Tables"]
        Graph["Relationship Graph"]
        Buffers["GPU Buffers"]
    end

    Client --> API
    API --> Core
    Core --> Storage

    TSApi --> WasmApi
    WasmApi --> RustApi

    style Client fill:#e0e7ff,stroke:#4f46e5
    style API fill:#dbeafe,stroke:#3b82f6
    style Core fill:#dcfce7,stroke:#22c55e
    style Storage fill:#fef3c7,stroke:#f59e0b
```

## Design Principles

### 1. Zero-Copy Where Possible

Data flows through the system with minimal copying:

```mermaid
flowchart LR
    subgraph Traditional["Traditional Approach"]
        T1["File Buffer"]
        T2["Parse to Objects"]
        T3["Convert to Arrays"]
        T4["Upload to GPU"]
        T1 -->|copy| T2 -->|copy| T3 -->|copy| T4
    end

    subgraph IFCLite["IFC-Lite Approach"]
        I1["File Buffer"]
        I2["Direct Index"]
        I3["TypedArrays"]
        I4["GPU Upload"]
        I1 -->|reference| I2 -->|view| I3 -->|share| I4
    end
```

### 2. Streaming First

Process data incrementally:

```mermaid
sequenceDiagram
    participant File
    participant Parser
    participant Processor
    participant Renderer
    participant User

    File->>Parser: Chunk 1
    Parser->>Processor: Entities 1-100
    Processor->>Renderer: Meshes 1-50
    Renderer->>User: First render

    File->>Parser: Chunk 2
    Parser->>Processor: Entities 101-200
    Processor->>Renderer: Meshes 51-100
    Note over User: User sees progressive loading

    File->>Parser: Chunk N
    Parser->>Processor: All entities
    Processor->>Renderer: All meshes
    Renderer->>User: Complete render
```

### 3. Columnar Storage

Store data in columnar format for cache-efficient access:

```mermaid
graph LR
    subgraph RowBased["Row-Based (Traditional)"]
        R1["Entity 1: id=1, type=WALL, name='A'"]
        R2["Entity 2: id=2, type=DOOR, name='B'"]
        R3["Entity 3: id=3, type=WALL, name='C'"]
    end

    subgraph Columnar["Columnar (IFC-Lite)"]
        C1["IDs: [1, 2, 3, ...]"]
        C2["Types: [WALL, DOOR, WALL, ...]"]
        C3["Names: ['A', 'B', 'C', ...]"]
    end
```

### 4. Hybrid Data Model

Combine the best of different data structures:

| Data Structure | Use Case | Access Pattern |
|----------------|----------|----------------|
| Columnar Tables | Bulk queries, filtering | Sequential scan |
| CSR Graph | Relationship traversal | Adjacency lookup |
| Lazy Parsing | On-demand attribute access | Random access |

## Package Architecture

```mermaid
graph TB
    subgraph Rust["Rust Crates"]
        Core["ifc-lite-core<br/>Parsing"]
        Geo["ifc-lite-geometry<br/>Triangulation"]
        Wasm["ifc-lite-wasm<br/>Bindings"]
    end

    subgraph TS["TypeScript Packages"]
        Parser["@ifc-lite/parser"]
        Geometry["@ifc-lite/geometry"]
        Renderer["@ifc-lite/renderer"]
        Query["@ifc-lite/query"]
        Data["@ifc-lite/data"]
        Export["@ifc-lite/export"]
    end

    subgraph Apps["Applications"]
        Viewer["Viewer App"]
    end

    Wasm --> Core
    Wasm --> Geo
    Parser --> Wasm
    Geometry --> Wasm
    Renderer --> Geometry
    Query --> Data
    Export --> Data
    Viewer --> Parser
    Viewer --> Renderer
    Viewer --> Query
```

## Data Flow

### Parse Flow

```mermaid
flowchart TB
    Input["IFC File<br/>(ArrayBuffer)"]

    subgraph Tokenize["1. Tokenize"]
        STEP["STEP Lexer"]
        Tokens["Token Stream"]
    end

    subgraph Scan["2. Scan"]
        EntityScan["Entity Scanner"]
        Index["Entity Index"]
    end

    subgraph Decode["3. Decode"]
        Decoder["Entity Decoder"]
        Attrs["Attributes"]
    end

    subgraph Store["4. Store"]
        Tables["Columnar Tables"]
        Graph["Relationship Graph"]
    end

    Output["ParseResult"]

    Input --> Tokenize
    Tokenize --> Scan
    Scan --> Decode
    Decode --> Store
    Store --> Output
```

### Render Flow

```mermaid
flowchart TB
    subgraph Input["Input"]
        Meshes["Mesh Data"]
        Camera["Camera State"]
    end

    subgraph Process["Processing"]
        Cull["Frustum Culling"]
        Sort["Depth Sort"]
        Batch["Batching"]
    end

    subgraph Upload["GPU Upload"]
        Vertex["Vertex Buffers"]
        Index["Index Buffers"]
        Uniform["Uniforms"]
    end

    subgraph Render["Render"]
        Pass["Render Pass"]
        Draw["Draw Calls"]
    end

    Output["Canvas"]

    Input --> Process
    Process --> Upload
    Upload --> Render
    Render --> Output
```

## Memory Architecture

```mermaid
graph TB
    subgraph JS["JavaScript Heap"]
        Strings["String Table"]
        Metadata["Entity Metadata"]
        Query["Query Results"]
    end

    subgraph Wasm["WASM Linear Memory"]
        Parser["Parser State"]
        Geometry["Geometry Processing"]
        Buffers["Mesh Buffers"]
    end

    subgraph GPU["GPU Memory"]
        VBO["Vertex Buffers"]
        IBO["Index Buffers"]
        UBO["Uniform Buffers"]
    end

    Wasm -->|"Zero-copy view"| JS
    Wasm -->|"Direct upload"| GPU
```

### Memory Efficiency

| Component | Memory Strategy |
|-----------|-----------------|
| Strings | Deduplicated string table (30% reduction) |
| Entity IDs | Uint32Array (fixed-size) |
| Types | Uint16Array enum (2 bytes vs ~20 for string) |
| Properties | Lazy parsing (on-demand) |
| Geometry | Streaming + dispose after upload |

## Threading Model

```mermaid
flowchart LR
    subgraph Main["Main Thread"]
        UI["UI Events"]
        Render["Rendering"]
        Query["Queries"]
    end

    subgraph Worker["Web Worker (Optional)"]
        Parse["Parsing"]
        Geo["Geometry"]
    end

    Main <-->|"Transferable"| Worker
```

### Current Implementation

- **Parsing**: Main thread (streaming reduces blocking)
- **Geometry**: Main thread (batched processing)
- **Rendering**: Main thread (WebGPU)

### Planned

- **Parsing**: Web Worker with streaming
- **Geometry**: Worker pool for parallel processing
- **Rendering**: Main thread (required for WebGPU)

## Extension Points

```mermaid
graph TB
    subgraph Core["Core System"]
        Parser["Parser"]
        Geometry["Geometry"]
        Renderer["Renderer"]
    end

    subgraph Extensions["Extension Points"]
        CustomParser["Custom Parsers"]
        CustomProcessor["Custom Processors"]
        CustomRenderer["Custom Renderers"]
        Plugins["Plugins"]
    end

    CustomParser -.->|extends| Parser
    CustomProcessor -.->|extends| Geometry
    CustomRenderer -.->|extends| Renderer
    Plugins -.->|hooks| Core
```

### Adding Custom Geometry Processor

```typescript
import { GeometryProcessor, ProcessorRegistry } from '@ifc-lite/geometry';

class CustomProcessor extends GeometryProcessor {
  canProcess(entity: Entity): boolean {
    return entity.type === 'IFCMYCUSTOMTYPE';
  }

  process(entity: Entity): Mesh {
    // Custom processing logic
    return mesh;
  }
}

ProcessorRegistry.register(new CustomProcessor());
```

## Technology Stack

```mermaid
graph TB
    subgraph Languages["Languages"]
        Rust["Rust"]
        TS["TypeScript"]
        WGSL["WGSL (Shaders)"]
    end

    subgraph Runtime["Runtime"]
        WASM["WebAssembly"]
        WebGPU["WebGPU"]
        Browser["Browser"]
    end

    subgraph Build["Build Tools"]
        Cargo["Cargo"]
        Vite["Vite"]
        WasmPack["wasm-pack"]
    end

    Rust --> WASM
    TS --> Browser
    WGSL --> WebGPU
    Cargo --> Rust
    Vite --> TS
    WasmPack --> WASM
```

## Next Steps

- [Data Flow](data-flow.md) - Detailed data flow diagrams
- [Parsing Pipeline](parsing-pipeline.md) - Parser architecture
- [Geometry Pipeline](geometry-pipeline.md) - Geometry processing
- [Rendering Pipeline](rendering-pipeline.md) - WebGPU rendering

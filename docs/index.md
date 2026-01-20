# IFClite Documentation

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } __Get Started Quickly__

    ---

    Create a new project with `create-ifc-lite` or parse your first IFC file in under 5 minutes.

    [:octicons-arrow-right-24: Quick Start](guide/quickstart.md)

-   :material-server:{ .lg .middle } __Server or Client?__

    ---

    Choose between client-side WASM parsing or server-based processing with caching.

    [:octicons-arrow-right-24: Server Guide](guide/server.md)

-   :material-cog:{ .lg .middle } __Architecture__

    ---

    Understand the system design, data flow, and server/client paradigms.

    [:octicons-arrow-right-24: Architecture](architecture/overview.md)

-   :material-api:{ .lg .middle } __API Reference__

    ---

    Complete API documentation for all 12 TypeScript packages.

    [:octicons-arrow-right-24: API Reference](api/typescript.md)

</div>

## What is IFClite?

**IFClite** is a high-performance IFC (Industry Foundation Classes) platform that runs in browsers, on servers, and as native desktop applications. It provides:

| Feature | Description |
|---------|-------------|
| **Two Paradigms** | Client-side WASM parsing for offline use, or server-based processing with intelligent caching |
| **IFC4 + IFC5** | Full IFC4X3 support (876 entities) plus native IFC5 (IFCX) JSON format parsing |
| **Streaming Pipeline** | Progressive geometry processing with first triangles in 300-500ms |
| **WebGPU Rendering** | Modern GPU-accelerated 3D with section planes, snap detection, and selection |
| **Tiny Bundle** | ~650 KB WASM (~260 KB gzipped) - 40% smaller than alternatives |
| **Cross-Platform** | Browser, Node.js, native Rust, and Tauri desktop applications |

## Choose Your Path

```mermaid
flowchart TD
    Start[Start Here] --> Q1{Single file,<br/>one-time view?}

    Q1 -->|Yes| Client[Client-Side<br/>@ifc-lite/parser]
    Q1 -->|No| Q2{Need caching for<br/>repeat access?}

    Q2 -->|Yes| Server[Server + Client<br/>@ifc-lite/server-client]
    Q2 -->|No| Q3{Large files<br/>>100MB?}

    Q3 -->|Yes| ServerStream[Server with Streaming]
    Q3 -->|No| Client

    Client --> Desktop{Native desktop<br/>app needed?}
    Desktop -->|Yes| Tauri[Tauri Desktop App]
    Desktop -->|No| Done[Ready to Build!]

    Server --> Done
    ServerStream --> Done
    Tauri --> Done

    style Start fill:#6366f1,stroke:#312e81,color:#fff
    style Client fill:#10b981,stroke:#064e3b,color:#fff
    style Server fill:#f59e0b,stroke:#7c2d12,color:#fff
    style ServerStream fill:#f59e0b,stroke:#7c2d12,color:#fff
    style Tauri fill:#a855f7,stroke:#581c87,color:#fff
    style Done fill:#22c55e,stroke:#14532d,color:#fff
```

## System Overview

IFClite supports two processing paradigms:

=== "Client-Side (WASM)"

    Process IFC files entirely in the browser using WebAssembly. Best for offline use, privacy-sensitive data, and simple deployments.

    ```mermaid
    flowchart LR
        IFC[IFC File] --> WASM[WASM Parser]
        WASM --> Tables[Columnar Tables]
        WASM --> Geometry[Geometry Buffers]
        Tables --> Query[Query API]
        Geometry --> Renderer[WebGPU Renderer]

        style IFC fill:#6366f1,stroke:#312e81,color:#fff
        style WASM fill:#2563eb,stroke:#1e3a8a,color:#fff
        style Tables fill:#16a34a,stroke:#14532d,color:#fff
        style Geometry fill:#16a34a,stroke:#14532d,color:#fff
        style Query fill:#ea580c,stroke:#7c2d12,color:#fff
        style Renderer fill:#c026d3,stroke:#701a75,color:#fff
    ```

=== "Server-Side (Rust)"

    Process IFC files on a high-performance Rust server with parallel processing and intelligent caching. Best for team collaboration, large files, and production deployments.

    ```mermaid
    flowchart LR
        subgraph Client
            Upload[Upload IFC]
            Viewer[WebGPU Viewer]
        end

        subgraph Server
            Parse[Parallel Parse]
            Cache[(Content Cache)]
        end

        Upload -->|hash check| Cache
        Cache -->|hit| Viewer
        Upload -->|miss| Parse
        Parse --> Cache
        Cache --> Viewer

        style Upload fill:#6366f1,stroke:#312e81,color:#fff
        style Parse fill:#10b981,stroke:#064e3b,color:#fff
        style Cache fill:#f59e0b,stroke:#7c2d12,color:#fff
        style Viewer fill:#a855f7,stroke:#581c87,color:#fff
    ```

## Quick Examples

=== "Create New Project"

    ```bash
    # Create a new project (recommended)
    npx create-ifc-lite my-app
    cd my-app && npm install && npm run parse

    # Or create a React viewer
    npx create-ifc-lite my-viewer --template react
    cd my-viewer && npm install && npm run dev

    # Or create a server backend
    npx create-ifc-lite my-backend --template server
    cd my-backend && npm run server:start
    ```

=== "Client-Side Parsing"

    ```typescript
    import { IfcParser } from '@ifc-lite/parser';
    import { Renderer } from '@ifc-lite/renderer';

    // Parse IFC file in browser
    const parser = new IfcParser();
    const store = await parser.parseColumnar(buffer, {
      onProgress: ({ phase, percent }) => console.log(`${phase}: ${percent}%`)
    });

    // Query entities
    const walls = store.entityIndex.byType.get('IFCWALL') ?? [];
    console.log(`Found ${walls.length} walls`);

    // Render geometry
    const renderer = new Renderer(canvas);
    await renderer.init();
    // ... load geometry and render
    ```

=== "Server + Client"

    ```typescript
    import { IfcServerClient } from '@ifc-lite/server-client';

    // Connect to server
    const client = new IfcServerClient({ baseUrl: 'https://your-server.com' });

    // Parse with intelligent caching (skips upload if cached)
    const result = await client.parseParquet(file);

    // Or stream for large files
    for await (const event of client.parseStream(file)) {
      if (event.type === 'batch') {
        renderer.addMeshes(event.meshes);
      }
    }
    ```

=== "IFC5 (IFCX) Format"

    ```typescript
    import { parseAuto } from '@ifc-lite/parser';

    // Auto-detect IFC4 (STEP) or IFC5 (IFCX JSON)
    const result = await parseAuto(buffer);

    if (result.format === 'ifcx') {
      // IFC5 with ECS composition and USD geometry
      console.log('IFC5 file with', result.meshes.length, 'meshes');
    } else {
      // IFC4 STEP format
      console.log('IFC4 file with', result.store.entityCount, 'entities');
    }
    ```

## Key Features

### Parsing & Data

| Feature | Description |
|---------|-------------|
| **Zero-Copy Parsing** | Direct memory access at ~1,259 MB/s tokenization |
| **100% Schema Coverage** | All 876 IFC4X3 entities with full TypeScript types |
| **IFC5 (IFCX) Support** | Native JSON-based format with ECS composition and USD geometry |
| **On-Demand Properties** | Lazy property extraction for responsive large file handling |
| **Streaming Pipeline** | Progressive geometry with first triangles in 300-500ms |

### Server Architecture

| Feature | Description |
|---------|-------------|
| **Content-Addressable Cache** | SHA-256 file hashing - skip upload on cache hit |
| **Parallel Processing** | Rayon thread pool for multi-core geometry extraction |
| **Parquet Format** | 15-50x smaller payloads than JSON |
| **SSE Streaming** | Progressive geometry batches for instant rendering |
| **Full Data Model** | Properties, quantities, and hierarchy computed upfront |

### Rendering & Interaction

| Feature | Description |
|---------|-------------|
| **WebGPU Renderer** | Modern GPU acceleration with depth testing and frustum culling |
| **Section Planes** | Interactive model slicing with semantic axes (down/front/side) |
| **Magnetic Snapping** | Vertex, edge, and face snapping with "stick and slide" behavior |
| **GPU Picking** | Depth-aware object selection supporting 100K+ meshes |
| **Zero-Copy Upload** | Direct WASM-to-GPU buffers, 60-70% less RAM |

### Desktop & Export

| Feature | Description |
|---------|-------------|
| **Tauri Desktop** | Native app with multi-threaded parsing (no 4GB WASM limit) |
| **Binary Cache** | `.ifc-lite` format for 5-10x faster reload |
| **Export Formats** | glTF/GLB, Apache Parquet, JSON-LD, CSV |

## Package Ecosystem

### TypeScript Packages

| Package | Description | Status |
|---------|-------------|--------|
| `create-ifc-lite` | Project scaffolding CLI | :material-check-circle: Stable |
| `@ifc-lite/parser` | STEP tokenizer & entity extraction | :material-check-circle: Stable |
| `@ifc-lite/ifcx` | IFC5 (IFCX) parser | :material-progress-clock: Beta |
| `@ifc-lite/geometry` | Geometry processing bridge | :material-check-circle: Stable |
| `@ifc-lite/renderer` | WebGPU rendering pipeline | :material-check-circle: Stable |
| `@ifc-lite/cache` | Binary cache for instant loading | :material-check-circle: Stable |
| `@ifc-lite/server-client` | Server SDK with caching & streaming | :material-check-circle: Stable |
| `@ifc-lite/server-bin` | Native server binary wrapper | :material-check-circle: Stable |
| `@ifc-lite/query` | Fluent & SQL query system | :material-progress-clock: Beta |
| `@ifc-lite/data` | Columnar data structures | :material-check-circle: Stable |
| `@ifc-lite/spatial` | Spatial indexing & culling | :material-progress-clock: Beta |
| `@ifc-lite/export` | Export (glTF, Parquet, etc.) | :material-progress-clock: Beta |

### Rust Crates

| Crate | Description | Status |
|-------|-------------|--------|
| `ifc-lite-core` | STEP/IFC parsing | :material-check-circle: Stable |
| `ifc-lite-geometry` | Mesh triangulation | :material-check-circle: Stable |
| `ifc-lite-wasm` | WASM bindings | :material-check-circle: Stable |
| `ifc-lite-server` | HTTP server (Axum) | :material-check-circle: Stable |

## Performance

### Bundle Size

| Library | WASM Size | Gzipped |
|---------|-----------|---------|
| **IFClite** | **0.65 MB** | **0.26 MB** |
| web-ifc | 1.1 MB | 0.4 MB |
| IfcOpenShell | 15 MB | - |

### Parse Performance

| Model Size | Client (WASM) | Server (Native) |
|------------|---------------|-----------------|
| 10 MB | ~100-200ms | ~50-100ms |
| 50 MB | ~600-700ms | ~300-400ms |
| 100+ MB | ~1.5-2s | ~600-800ms |
| 327 MB | ~17s (first batch 1.2s) | ~5-7s |

### Server Caching Impact

| Scenario | First Load | Cached Load |
|----------|------------|-------------|
| 50 MB file | ~800ms | ~50ms (cache hit) |
| 169 MB file | ~7s | ~100ms (cache hit) |
| Skip upload | - | Yes (hash check) |

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

    Multiple ways to install: npm, Cargo, Docker, or create-ifc-lite

-   [:material-play: __Quick Start__](guide/quickstart.md)

    Parse your first IFC file with client or server

-   [:material-server: __Server Guide__](guide/server.md)

    Set up server-based processing with caching

-   [:material-school: __Tutorials__](tutorials/building-viewer.md)

    Build a complete IFC viewer from scratch

-   [:material-file-document: __Parsing Guide__](guide/parsing.md)

    Deep dive into parsing modes and IFC5 support

-   [:material-github: __Source Code__](https://github.com/louistrue/ifc-lite)

    View on GitHub

</div>

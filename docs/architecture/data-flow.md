# Data Flow

Detailed data flow through the IFC-Lite system.

## Complete Data Flow

```mermaid
flowchart TB
    subgraph Input["Input"]
        File["IFC File"]
        URL["URL"]
        Buffer["ArrayBuffer"]
    end

    subgraph Parse["Parse Stage"]
        Tokenize["Tokenize STEP"]
        Scan["Scan Entities"]
        Decode["Decode Attributes"]
        Build["Build Index"]
    end

    subgraph Store["Storage Stage"]
        Entities["Entity Table"]
        Properties["Property Table"]
        Quantities["Quantity Table"]
        Relations["Relationship Graph"]
    end

    subgraph Geometry["Geometry Stage"]
        Extract["Extract Geometry"]
        Triangulate["Triangulate"]
        Transform["Transform"]
        Buffer2["Build Buffers"]
    end

    subgraph Render["Render Stage"]
        Upload["GPU Upload"]
        Cull["Frustum Cull"]
        Draw["Draw"]
        Display["Display"]
    end

    Input --> Parse
    Parse --> Store
    Store --> Geometry
    Geometry --> Render

    style Input fill:#6366f1,stroke:#312e81,color:#fff
    style Parse fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Store fill:#10b981,stroke:#064e3b,color:#fff
    style Geometry fill:#f59e0b,stroke:#7c2d12,color:#fff
    style Render fill:#a855f7,stroke:#581c87,color:#fff
```

## Parsing Data Flow

### Token Flow

```mermaid
flowchart LR
    subgraph Input["Input"]
        Bytes["UTF-8 Bytes"]
    end

    subgraph Lexer["Lexer"]
        WS["Skip Whitespace"]
        Match["Match Token"]
        Emit["Emit Token"]
    end

    subgraph Tokens["Token Types"]
        Keyword["KEYWORD"]
        String["STRING"]
        Number["NUMBER"]
        EntityRef["#123"]
        Punctuation["( ) , ; ="]
    end

    Bytes --> WS --> Match --> Emit --> Tokens
```

### Entity Parsing

```mermaid
sequenceDiagram
    participant Input as Input Buffer
    participant Scanner as Entity Scanner
    participant Index as Entity Index
    participant Decoder as Attribute Decoder

    Input->>Scanner: Scan for #123=
    Scanner->>Scanner: Extract type name
    Scanner->>Index: Store (id, offset, type)

    Note over Index: Lazy storage

    Index->>Decoder: Request entity #123
    Decoder->>Input: Read from offset
    Decoder->>Decoder: Parse attributes
    Decoder-->>Index: Return decoded entity
```

### Memory Layout

```mermaid
graph TB
    subgraph File["File Buffer (ArrayBuffer)"]
        Header["HEADER Section"]
        Data["DATA Section"]
        End["END-ISO..."]
    end

    subgraph Index["Entity Index"]
        I1["#1 → offset 1234, IFCPROJECT"]
        I2["#2 → offset 2345, IFCSITE"]
        I3["#3 → offset 3456, IFCWALL"]
    end

    Data --> I1
    Data --> I2
    Data --> I3
```

## Storage Data Flow

### Columnar Tables

```mermaid
flowchart LR
    subgraph Decoded["Decoded Entities"]
        E1["Entity 1"]
        E2["Entity 2"]
        E3["Entity 3"]
    end

    subgraph Columns["Columnar Storage"]
        IDs["expressIds: Uint32Array<br/>[1, 2, 3, ...]"]
        Types["typeEnums: Uint16Array<br/>[5, 12, 8, ...]"]
        Names["nameIndices: Uint32Array<br/>[42, 0, 15, ...]"]
        Flags["flags: Uint8Array<br/>[3, 1, 3, ...]"]
    end

    subgraph Strings["String Table"]
        S1["'Project Name'"]
        S2["'Wall-001'"]
        S3["..."]
    end

    E1 --> IDs
    E2 --> IDs
    E3 --> IDs
    Names --> Strings
```

### Relationship Graph

```mermaid
graph LR
    subgraph CSR["CSR Format"]
        Offsets["offsets: [0, 2, 5, 7, ...]"]
        Edges["edges: [2, 3, 4, 5, 6, 7, 8, ...]"]
        Types["types: [1, 1, 2, 2, 2, 3, 3, ...]"]
    end

    subgraph Query["Query: Get children of #1"]
        Start["offsets[1] = 0"]
        End["offsets[2] = 2"]
        Children["edges[0..2] = [2, 3]"]
    end

    Offsets --> Start
    Offsets --> End
    Edges --> Children
```

## Geometry Data Flow

### Processing Pipeline

```mermaid
flowchart TB
    subgraph Extract["1. Extract"]
        Entity["IFC Entity"]
        Shape["Shape Representation"]
        Placement["Local Placement"]
    end

    subgraph Route["2. Route"]
        Router["Geometry Router"]
        ExtProc["Extrusion Processor"]
        BrepProc["Brep Processor"]
        CSGProc["CSG Processor"]
    end

    subgraph Triangulate["3. Triangulate"]
        Profile["Profile → 2D Points"]
        Earcut["Earcut Triangulation"]
        Normals["Compute Normals"]
    end

    subgraph Output["4. Output"]
        Positions["Float32Array positions"]
        NormalsOut["Float32Array normals"]
        Indices["Uint32Array indices"]
    end

    Extract --> Route
    Route --> Triangulate
    Triangulate --> Output
```

### Coordinate Transformation

```mermaid
flowchart LR
    subgraph Local["Local Coordinates"]
        LP["Profile Points<br/>(2D)"]
    end

    subgraph Transform["Transformations"]
        Extrude["Extrude to 3D"]
        Place["Apply Placement"]
        Shift["Origin Shift"]
    end

    subgraph World["World Coordinates"]
        WP["World Points<br/>(3D Float32)"]
    end

    LP --> Extrude --> Place --> Shift --> WP
```

## Render Data Flow

### Buffer Upload

```mermaid
flowchart TB
    subgraph CPU["CPU Memory"]
        Mesh["Mesh Data"]
        Positions["positions: Float32Array"]
        Normals["normals: Float32Array"]
        Indices["indices: Uint32Array"]
    end

    subgraph Transfer["Transfer"]
        Map["Map GPU Buffer"]
        Write["Write Data"]
        Unmap["Unmap Buffer"]
    end

    subgraph GPU["GPU Memory"]
        VBO["Vertex Buffer"]
        IBO["Index Buffer"]
        UBO["Uniform Buffer"]
    end

    CPU --> Transfer --> GPU
```

### Render Pass

```mermaid
flowchart TB
    subgraph Setup["Setup"]
        Pass["Begin Render Pass"]
        Pipeline["Set Pipeline"]
        Bind["Bind Groups"]
    end

    subgraph Draw["Draw Loop"]
        ForEach["For Each Mesh"]
        Cull["Frustum Cull"]
        SetBuffers["Set Buffers"]
        DrawCall["Draw Indexed"]
    end

    subgraph Finish["Finish"]
        End["End Pass"]
        Submit["Submit Commands"]
        Present["Present Frame"]
    end

    Setup --> Draw --> Finish
```

### Frame Timeline

```mermaid
gantt
    title Frame Timeline (16.67ms @ 60fps)
    dateFormat X
    axisFormat %L ms

    section CPU
    Update Camera    :a1, 0, 1
    Frustum Cull     :a2, 1, 2
    Update Uniforms  :a3, 2, 3
    Build Commands   :a4, 3, 5

    section GPU
    Vertex Shader    :b1, 5, 8
    Rasterization    :b2, 8, 12
    Fragment Shader  :b3, 12, 15
    Present          :b4, 15, 17
```

## Query Data Flow

### Fluent Query

```mermaid
flowchart LR
    subgraph Build["Build Query"]
        Start["query"]
        Type[".walls()"]
        Filter[".whereProperty()"]
        Select[".select()"]
    end

    subgraph Execute["Execute"]
        Plan["Query Plan"]
        Scan["Column Scan"]
        Filter2["Apply Filters"]
        Project["Project Fields"]
    end

    subgraph Result["Result"]
        Array["Entity[]"]
    end

    Build --> Execute --> Result
```

### SQL Query

```mermaid
flowchart TB
    subgraph Input["Input"]
        SQL["SQL Query String"]
    end

    subgraph DuckDB["DuckDB-WASM"]
        Parse["Parse SQL"]
        Optimize["Optimize Plan"]
        Execute["Execute"]
    end

    subgraph Data["Data Sources"]
        Entities["entities table"]
        Properties["properties table"]
        Quantities["quantities table"]
    end

    subgraph Output["Output"]
        Rows["Result Rows"]
    end

    SQL --> DuckDB
    Data --> DuckDB
    DuckDB --> Rows
```

## Export Data Flow

### glTF Export

```mermaid
flowchart TB
    subgraph Input["Input"]
        ParseResult["ParseResult"]
        Meshes["Mesh Data"]
        Props["Properties"]
    end

    subgraph Convert["Conversion"]
        Nodes["Build Node Tree"]
        Buffers["Pack Buffers"]
        Materials["Export Materials"]
        Extras["Add Extras (props)"]
    end

    subgraph Output["Output"]
        JSON[".gltf JSON"]
        BIN[".bin Binary"]
        GLB[".glb (combined)"]
    end

    Input --> Convert
    Convert --> Output
```

## Data Size Estimates

| Stage | Data Size (50MB IFC) | Notes |
|-------|---------------------|-------|
| File Buffer | 50 MB | Original file |
| Entity Index | ~2 MB | Just offsets + types |
| Columnar Tables | ~5 MB | Deduped, compact |
| Relationship Graph | ~1 MB | CSR format |
| Geometry Buffers | ~20 MB | Triangulated meshes |
| GPU Buffers | ~20 MB | Mirrors CPU |

## Next Steps

- [Parsing Pipeline](parsing-pipeline.md) - Parser details
- [Geometry Pipeline](geometry-pipeline.md) - Geometry details
- [Rendering Pipeline](rendering-pipeline.md) - Renderer details

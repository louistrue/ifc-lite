# Geometry Processing

Guide to geometry extraction and processing in IFC-Lite.

## Overview

IFC-Lite processes IFC geometry through a streaming pipeline:

```mermaid
flowchart TB
    subgraph Input["IFC Geometry Types"]
        Extrusion["ExtrudedAreaSolid"]
        Brep["FacetedBrep"]
        Clipping["BooleanClipping"]
        Mapped["MappedItem"]
    end

    subgraph Router["Geometry Router"]
        Detect["Type Detection"]
        Select["Processor Selection"]
    end

    subgraph Processors["Specialized Processors"]
        ExtProc["Extrusion Processor"]
        BrepProc["Brep Processor"]
        CSGProc["CSG Processor"]
        MapProc["Instance Processor"]
    end

    subgraph Output["GPU-Ready Output"]
        Mesh["Triangle Mesh"]
        Buffers["Vertex Buffers"]
    end

    Input --> Router
    Router --> Processors
    Extrusion --> ExtProc
    Brep --> BrepProc
    Clipping --> CSGProc
    Mapped --> MapProc
    Processors --> Output

    style Input fill:#6366f1,stroke:#312e81,color:#fff
    style Router fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Processors fill:#10b981,stroke:#064e3b,color:#fff
    style Output fill:#a855f7,stroke:#581c87,color:#fff
```

## Geometry Quality Modes

| Mode | Curve Segments | Use Case |
|------|---------------|----------|
| `FAST` | 8 | Quick preview, mobile devices |
| `BALANCED` | 16 | Default, good quality/performance |
| `HIGH` | 32 | Maximum quality, detailed models |

```typescript
import { IfcParser, GeometryQuality } from '@ifc-lite/parser';

const parser = new IfcParser();

// Fast mode for quick loading
const fastResult = await parser.parse(buffer, {
  geometryQuality: GeometryQuality.FAST
});

// High quality for detailed viewing
const highResult = await parser.parse(buffer, {
  geometryQuality: GeometryQuality.HIGH
});
```

## Mesh Data Structure

```mermaid
classDiagram
    class Mesh {
        +number expressId
        +Float32Array positions
        +Float32Array normals
        +Uint32Array indices
        +Float32Array? uvs
        +number[] color
        +Matrix4 transform
    }

    class GeometryResult {
        +Mesh[] meshes
        +BoundingBox bounds
        +number triangleCount
        +number vertexCount
    }

    class BoundingBox {
        +Vector3 min
        +Vector3 max
        +Vector3 center
        +Vector3 size
    }

    GeometryResult "1" --> "*" Mesh
    GeometryResult "1" --> "1" BoundingBox
```

### Accessing Mesh Data

```typescript
const result = await parser.parse(buffer);

// Get all meshes
for (const mesh of result.geometry.meshes) {
  console.log(`Entity #${mesh.expressId}:`);
  console.log(`  Vertices: ${mesh.positions.length / 3}`);
  console.log(`  Triangles: ${mesh.indices.length / 3}`);
  console.log(`  Color: rgba(${mesh.color.join(', ')})`);
}

// Get mesh by entity ID
const wallMesh = result.geometry.getMesh(wallEntity.expressId);

// Access bounds
console.log(`Model bounds:`, result.geometry.bounds);
console.log(`Center:`, result.geometry.bounds.center);
```

## Streaming Geometry

Process geometry incrementally for large files:

```mermaid
sequenceDiagram
    participant Parser
    participant Processor as Geometry Processor
    participant Collector as Mesh Collector
    participant GPU as WebGPU

    loop Batch Processing
        Parser->>Processor: Entity batch
        Processor->>Processor: Triangulate
        Processor->>Collector: Mesh batch
        Collector->>GPU: Upload buffers
        Note over GPU: Render visible meshes
    end
```

### Streaming Example

```typescript
import { IfcParser, GeometryBatch } from '@ifc-lite/parser';

const parser = new IfcParser();
const renderer = new Renderer(canvas);

await parser.parseStreaming(buffer, {
  batchSize: 100,

  onBatch: async (batch: GeometryBatch) => {
    // Upload meshes to GPU
    for (const mesh of batch.meshes) {
      await renderer.addMesh(mesh);
    }

    // Update bounds
    if (batch.bounds) {
      renderer.updateBounds(batch.bounds);
    }

    // Render current state
    renderer.render();
  },

  onComplete: () => {
    renderer.fitToView();
  }
});
```

## Coordinate Handling

IFC files often use large georeferenced coordinates that cause precision issues:

```mermaid
flowchart LR
    subgraph Problem["Problem"]
        Large["Large Coordinates<br/>(6-7 digit values)"]
        Precision["Float32 Precision Loss"]
        Jitter["Visual Jitter"]
        Large --> Precision --> Jitter
    end

    subgraph Solution["Solution"]
        Detect["Detect Large Coords"]
        Shift["Auto-Shift to Origin"]
        Store["Store Offset"]
        Detect --> Shift --> Store
    end

    Problem --> Solution

    style Problem fill:#dc2626,stroke:#7f1d1d,color:#fff
    style Solution fill:#16a34a,stroke:#14532d,color:#fff
```

### Auto Origin Shift

```typescript
const result = await parser.parse(buffer, {
  autoOriginShift: true
});

// Access the computed shift
if (result.coordinateShift) {
  console.log(`Origin shifted by:`, result.coordinateShift);
  // { x: 487234.5, y: 5234891.2, z: 0 }
}

// Convert local coordinates back to world
function toWorldCoords(localPos: Vector3): Vector3 {
  return {
    x: localPos.x + result.coordinateShift.x,
    y: localPos.y + result.coordinateShift.y,
    z: localPos.z + result.coordinateShift.z
  };
}
```

## Geometry Processors

### Extrusion Processor

Handles `IfcExtrudedAreaSolid` entities:

```mermaid
flowchart LR
    subgraph Input
        Profile["2D Profile"]
        Direction["Extrusion Direction"]
        Depth["Extrusion Depth"]
    end

    subgraph Process
        Triangulate["Triangulate Profile<br/>(earcutr)"]
        Extrude["Generate Side Faces"]
        Cap["Create End Caps"]
    end

    subgraph Output
        Mesh["3D Mesh"]
    end

    Profile --> Triangulate
    Triangulate --> Extrude
    Direction --> Extrude
    Depth --> Extrude
    Extrude --> Cap
    Cap --> Mesh

    style Input fill:#6366f1,stroke:#312e81,color:#fff
    style Process fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Output fill:#a855f7,stroke:#581c87,color:#fff
```

### Brep Processor

Handles `IfcFacetedBrep` entities:

```typescript
// Brep processing is straightforward - faces are already triangulated
// in most cases, or need simple fan triangulation

const brepMesh = processBrep({
  faces: brepEntity.faces,
  vertices: brepEntity.vertices
});
```

### Boolean Operations

Handles `IfcBooleanClippingResult`:

```mermaid
flowchart LR
    First["First Operand"]
    Second["Second Operand"]
    Op["Boolean Operation<br/>(Difference/Union/Intersection)"]
    Result["Result Mesh"]

    First --> Op
    Second --> Op
    Op --> Result

    style First fill:#6366f1,stroke:#312e81,color:#fff
    style Second fill:#6366f1,stroke:#312e81,color:#fff
    style Op fill:#2563eb,stroke:#1e3a8a,color:#fff
    style Result fill:#a855f7,stroke:#581c87,color:#fff
```

## Custom Geometry Processing

Extend geometry processing for custom needs:

```typescript
import { GeometryProcessor, ProcessorRegistry } from '@ifc-lite/geometry';

// Create custom processor
class CustomProfileProcessor extends GeometryProcessor {
  canProcess(entity: Entity): boolean {
    return entity.type === 'IFCARBITRARYCLOSEDPROFILEDEF';
  }

  process(entity: Entity): Mesh {
    // Custom triangulation logic
    const points = this.extractPoints(entity);
    const triangles = this.triangulate(points);
    return this.buildMesh(triangles);
  }
}

// Register processor
ProcessorRegistry.register(new CustomProfileProcessor());
```

## Instancing

IFC often uses mapped representations for repeated elements:

```typescript
// Detect instanced geometry
const instances = result.geometry.getInstances(mesh.expressId);

if (instances.length > 1) {
  console.log(`Mesh is instanced ${instances.length} times`);

  // Get transformation matrices for each instance
  const transforms = instances.map(i => i.transform);

  // Use GPU instancing for efficient rendering
  renderer.addInstancedMesh(mesh, transforms);
}
```

## Performance Optimization

### Memory-Efficient Processing

```typescript
// Process in chunks to limit memory
await parser.parseStreaming(buffer, {
  batchSize: 50,
  memoryLimit: 512, // MB

  onBatch: async (batch) => {
    // Process and upload
    await renderer.addMeshes(batch.meshes);

    // Clear batch from memory
    batch.dispose();
  }
});
```

### Skip Unnecessary Geometry

```typescript
// Skip spaces and openings for faster loading
const result = await parser.parse(buffer, {
  excludeTypes: [
    'IFCSPACE',
    'IFCOPENINGELEMENT',
    'IFCFLOWSEGMENT' // Skip MEP if not needed
  ]
});
```

## Geometry Statistics

```typescript
const result = await parser.parse(buffer);
const stats = result.geometry.getStatistics();

console.log('Geometry Statistics:');
console.log(`  Total meshes: ${stats.meshCount}`);
console.log(`  Total triangles: ${stats.triangleCount}`);
console.log(`  Total vertices: ${stats.vertexCount}`);
console.log(`  Instanced meshes: ${stats.instancedCount}`);
console.log(`  Memory usage: ${stats.memoryMB.toFixed(1)} MB`);

// Breakdown by entity type
for (const [type, count] of Object.entries(stats.byType)) {
  console.log(`  ${type}: ${count} meshes`);
}
```

## Next Steps

- [Rendering Guide](rendering.md) - Display geometry with WebGPU
- [Parsing Guide](parsing.md) - Parse options and streaming
- [API Reference](../api/typescript.md) - Complete API docs

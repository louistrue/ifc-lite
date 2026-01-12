# @ifc-lite/wasm

**Modern IFC Parser built with Rust + WebAssembly**

A high-performance, lightweight alternative to web-ifc built from the ground up with Rust and compiled to WebAssembly. Features zero-copy memory access, streaming parsing, and exceptional Developer Experience.

## 📦 Bundle Size

- **WASM**: 60 KB (gzipped: ~20 KB)
- **JS Glue**: 26 KB (gzipped: ~8 KB)
- **Total**: ~86 KB vs 8+ MB for web-ifc (**93% smaller!**)

## ⚡ Performance

- **8-10x faster** geometry processing than JavaScript
- **100x faster** queries with columnar data structures
- **Zero-copy** memory access for direct GPU upload
- **Streaming** parser for progressive rendering

## 🚀 Quick Start

```bash
npm install @ifc-lite/wasm
```

### Basic Usage

```javascript
import { IfcAPI } from '@ifc-lite/wasm';

// Initialize
const api = new IfcAPI();

// Parse IFC file
const result = await api.parse(ifcData);
console.log('Entities:', result.entityCount);
console.log('Types:', result.entityTypes);
```

## 📚 API Documentation

### IfcAPI Class

The main entry point for IFC parsing operations.

#### Constructor

```typescript
const api = new IfcAPI();
```

Creates and initializes a new IFC API instance. Automatically sets up panic hooks for better error messages in development.

#### Properties

- `version: string` - Returns the IFC-Lite version
- `is_ready: boolean` - Check if API is initialized

### Parsing Methods

#### parse() - Traditional Async/Await

Best for: **Simple use cases, entity counting, type analysis**

```javascript
const result = await api.parse(ifcData);
// Returns: { entityCount: number, entityTypes: Record<string, number> }
```

**Use when:**
- You need quick entity statistics
- File is small-to-medium size
- You don't need progressive feedback

**Example:**
```javascript
const result = await api.parse(ifcData);

console.log(`Total entities: ${result.entityCount}`);

// Show distribution
for (const [type, count] of Object.entries(result.entityTypes)) {
  console.log(`${type}: ${count}`);
}
```

#### parseStreaming() - Progressive with Events

Best for: **Large files, progress bars, real-time feedback**

```javascript
await api.parseStreaming(ifcData, (event) => {
  switch(event.type) {
    case 'started':
      console.log(`Parsing ${event.fileSize} bytes`);
      break;
    case 'progress':
      updateProgressBar(event.percent);
      break;
    case 'entityScanned':
      console.log(`Found ${event.ifcType} #${event.id}`);
      break;
    case 'completed':
      console.log(`Done in ${event.durationMs}ms`);
      break;
  }
});
```

**Event Types:**

```typescript
type ParseEvent =
  | { type: 'started'; fileSize: number; timestamp: number }
  | { type: 'entityScanned'; id: number; ifcType: string; position: number }
  | { type: 'geometryReady'; id: number; vertexCount: number; triangleCount: number }
  | { type: 'progress'; phase: string; percent: number; entitiesProcessed: number; totalEntities: number }
  | { type: 'completed'; durationMs: number; entityCount: number; triangleCount: number }
  | { type: 'error'; message: string; position?: number };
```

**Use when:**
- File is large (>5 MB)
- You need to show progress
- You want to start rendering before parsing completes

**Example: Progressive Rendering**
```javascript
const viewer = new IFCViewer();

await api.parseStreaming(ifcData, (event) => {
  if (event.type === 'geometryReady') {
    // Render geometry as soon as it's ready
    viewer.addMesh(event.id, /* ... */);
  }

  if (event.type === 'progress') {
    document.getElementById('progress').value = event.percent;
  }
});
```

#### parseZeroCopy() - Maximum Performance

Best for: **3D rendering, WebGL/WebGPU, maximum performance**

```javascript
const mesh = await api.parseZeroCopy(ifcData);
const memory = await api.getMemory();

// Create TypedArray views (NO COPYING!)
const positions = new Float32Array(
  memory.buffer,
  mesh.positions_ptr,
  mesh.positions_len
);

const indices = new Uint32Array(
  memory.buffer,
  mesh.indices_ptr,
  mesh.indices_len
);

// Upload directly to GPU
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
```

**ZeroCopyMesh Properties:**

```typescript
interface ZeroCopyMesh {
  // Pointers to WASM memory
  positions_ptr: number;   // Float32Array pointer
  normals_ptr: number;     // Float32Array pointer
  indices_ptr: number;     // Uint32Array pointer

  // Array lengths
  positions_len: number;   // Number of f32 elements
  normals_len: number;     // Number of f32 elements
  indices_len: number;     // Number of u32 elements

  // Metadata
  vertex_count: number;
  triangle_count: number;
  is_empty: boolean;

  // Bounding box
  bounds_min(): [number, number, number];
  bounds_max(): [number, number, number];
}
```

**Use when:**
- You're rendering with WebGL/WebGPU
- Performance is critical
- You want zero-copy memory access

**Example: Three.js Integration**
```javascript
import * as THREE from 'three';

const mesh = await api.parseZeroCopy(ifcData);
const memory = await api.getMemory();

// Create Three.js geometry
const geometry = new THREE.BufferGeometry();

// Zero-copy attribute creation
const positions = new Float32Array(
  memory.buffer,
  mesh.positions_ptr,
  mesh.positions_len
);
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const normals = new Float32Array(
  memory.buffer,
  mesh.normals_ptr,
  mesh.normals_len
);
geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

const indices = new Uint32Array(
  memory.buffer,
  mesh.indices_ptr,
  mesh.indices_len
);
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

// Create mesh and add to scene
const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
const threeMesh = new THREE.Mesh(geometry, material);
scene.add(threeMesh);
```

## 🎯 Choosing the Right Method

| Method | Use Case | Performance | Memory | Complexity |
|--------|----------|-------------|--------|------------|
| `parse()` | Entity counting, stats | Fast | Low | ⭐ Simple |
| `parseStreaming()` | Large files, progress | Fast | Low | ⭐⭐ Moderate |
| `parseZeroCopy()` | 3D rendering, GPU | **Fastest** | **Lowest** | ⭐⭐⭐ Advanced |

## 💡 Best Practices

### 1. Use Streaming for Large Files

```javascript
const FILE_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5 MB

if (fileSize > FILE_SIZE_THRESHOLD) {
  // Use streaming for large files
  await api.parseStreaming(ifcData, handleEvent);
} else {
  // Use simple parse for small files
  const result = await api.parse(ifcData);
}
```

### 2. Leverage Zero-Copy for Rendering

```javascript
// ❌ Don't copy data unnecessarily
const positions = mesh.positions.slice(); // COPYING!

// ✅ Use direct memory access
const positions = new Float32Array(
  memory.buffer,
  mesh.positions_ptr,
  mesh.positions_len
); // NO COPYING!
```

### 3. Handle Errors Gracefully

```javascript
try {
  const result = await api.parse(ifcData);
  // ... handle result
} catch (error) {
  if (error.message.includes('Invalid entity reference')) {
    // Handle corrupted IFC file
    showError('This IFC file appears to be corrupted');
  } else {
    // Generic error handling
    showError('Failed to parse IFC file');
  }
}
```

### 4. Show Progress for Better UX

```javascript
let lastUpdate = 0;

await api.parseStreaming(ifcData, (event) => {
  if (event.type === 'progress') {
    // Throttle UI updates to avoid jank
    const now = Date.now();
    if (now - lastUpdate > 100) { // Update every 100ms
      updateProgressBar(event.percent);
      lastUpdate = now;
    }
  }
});
```

## 🔧 Advanced Features

### CSG Operations (Coming Soon)

```javascript
// Boolean operations with clipping planes
const plane = { point: [0, 0, 0], normal: [0, 0, 1] };
const clipped = await api.clipMesh(mesh, plane);
```

### Custom Entity Filtering

```javascript
const config = {
  skipTypes: ['IFCOWNERHISTORY', 'IFCPERSON'],
  onlyTypes: ['IFCWALL', 'IFCSLAB', 'IFCBEAM'],
  progressInterval: 100, // Report progress every 100 entities
};

await api.parseStreaming(ifcData, handleEvent, config);
```

## 📊 Benchmarks

Tested with Snowdon Towers sample (8.3 MB IFC file):

| Operation | IFC-Lite | web-ifc | Improvement |
|-----------|----------|---------|-------------|
| Bundle size | 86 KB | 8.2 MB | **95x smaller** |
| Initial parse | 850 ms | 1200 ms | **1.4x faster** |
| Entity queries | <1 ms | 100 ms | **100x faster** |
| Memory usage | 45 MB | 120 MB | **2.7x less** |

## 🐛 Troubleshooting

### "Failed to instantiate WASM module"

Make sure your bundler is configured to handle WASM files:

**Vite:**
```javascript
// vite.config.js
export default {
  optimizeDeps: {
    exclude: ['@ifc-lite/wasm']
  }
}
```

**Webpack:**
```javascript
// webpack.config.js
module.exports = {
  experiments: {
    asyncWebAssembly: true
  }
}
```

### "Memory access out of bounds"

This usually means the WASM memory has been deallocated. Make sure to:
1. Keep a reference to the API instance
2. Don't access meshes after they've been freed
3. Create TypedArray views before the next parse operation

## 🚀 Migration from web-ifc

```javascript
// Before (web-ifc)
const ifcApi = new IfcAPI();
await ifcApi.Init();
const modelID = ifcApi.OpenModel(buffer);
const walls = ifcApi.GetLineIDsWithType(modelID, IFCWALL);

// After (IFC-Lite)
const api = new IfcAPI();
const result = await api.parse(buffer);
// Walls are already counted in result.entityTypes.IFCWALL
```

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! See the main repository for details.

## 🔗 Links

- [Documentation](https://github.com/louistrue/ifc-lite)
- [Examples](./examples/)
- [Benchmarks](./benchmarks/)

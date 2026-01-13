# IFC-Lite Performance Optimization Plan

## Executive Summary

**Current State**: IFC-Lite is ~1.09x faster than web-ifc overall (1.37s vs 1.49s)
**Target**: 5-10x faster than web-ifc for large files

This plan outlines modern optimization techniques to achieve dramatic performance improvements.

---

## Phase 1: Low-Hanging Fruit (Expected: 2-3x improvement)

### 1.1 Enable wasm-opt Optimization

**Current Issue**: `wasm-opt = false` in Cargo.toml disables critical WASM optimizations!

```toml
# rust/wasm-bindings/Cargo.toml - CHANGE THIS:
[package.metadata.wasm-pack.profile.release]
wasm-opt = ["-O4", "--enable-simd", "--enable-bulk-memory"]
```

**Impact**: 10-30% smaller binary, 10-20% faster execution

### 1.2 WASM SIMD for Vector Math

Modern browsers support WASM SIMD. Use it for transform operations.

```rust
// Add to Cargo.toml
[dependencies]
wide = "0.7"  # Portable SIMD

// Or use nalgebra's SIMD backend
[dependencies.nalgebra]
version = "0.33"
features = ["std", "simba"]  # Enable SIMD
```

**Hot paths to SIMD-ify**:
- `apply_transform()` - Matrix-vector multiplication
- `calculate_normals()` - Cross products, normalization
- `bounds()` - Min/max operations

**Expected Impact**: 2-4x faster geometry processing

### 1.3 MappedItem Cache (Geometry Instancing)

Many IFC files have repeated geometry via `IfcMappedItem`. Cache the base geometry.

```rust
// In GeometryRouter
struct GeometryRouter {
    schema: IfcSchema,
    processors: HashMap<IfcType, Arc<dyn GeometryProcessor>>,
    // NEW: Cache for MappedItem source geometry
    mapped_item_cache: FxHashMap<u32, Arc<Mesh>>,
}

impl GeometryRouter {
    fn process_mapped_item(&mut self, ...) -> Result<Mesh> {
        let source_id = /* get RepresentationMap ID */;

        // Check cache first
        if let Some(cached) = self.mapped_item_cache.get(&source_id) {
            // Clone and transform cached mesh
            let mut mesh = cached.as_ref().clone();
            apply_transform(&mut mesh, &transform);
            return Ok(mesh);
        }

        // Process and cache
        let mesh = self.process_source(...)?;
        self.mapped_item_cache.insert(source_id, Arc::new(mesh.clone()));
        Ok(mesh)
    }
}
```

**Expected Impact**: 3-10x faster for files with repeated elements (most real-world files)

---

## Phase 2: Parallelization (Expected: 3-5x improvement)

### 2.1 Web Workers Parallelization (JavaScript Level)

Process building elements in parallel using Web Workers.

```javascript
// worker-pool.js
class IfcWorkerPool {
    constructor(workerCount = navigator.hardwareConcurrency) {
        this.workers = Array(workerCount).fill(null).map(() =>
            new Worker('ifc-worker.js')
        );
        this.taskQueue = [];
    }

    async parseParallel(ifcContent) {
        // 1. Quick scan to find entity boundaries (main thread)
        const entityRanges = this.scanEntityRanges(ifcContent);

        // 2. Split entities across workers
        const chunks = this.splitIntoChunks(entityRanges, this.workers.length);

        // 3. Process in parallel
        const meshPromises = chunks.map((chunk, i) =>
            this.workers[i].postMessage({
                content: ifcContent,
                ranges: chunk
            })
        );

        // 4. Combine results
        const meshes = await Promise.all(meshPromises);
        return this.combineMeshes(meshes);
    }
}
```

**Expected Impact**: Near-linear scaling with core count (4-8x on typical machines)

### 2.2 wasm-bindgen-rayon (Native WASM Threading)

Enable native threading in WASM using SharedArrayBuffer.

```toml
# Cargo.toml
[dependencies]
rayon = "1.8"
wasm-bindgen-rayon = "1.2"

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen-rayon = "1.2"
```

```rust
// In api.rs
use rayon::prelude::*;

pub fn parse_meshes_parallel(&self, content: String) -> MeshCollection {
    let entity_index = build_entity_index(&content);
    let entities: Vec<_> = entity_index.iter().collect();

    // Process entities in parallel
    let meshes: Vec<_> = entities
        .par_iter()
        .filter_map(|(id, (start, end))| {
            let decoder = EntityDecoder::new(&content);
            // Process entity...
        })
        .collect();

    MeshCollection::from_vec(meshes)
}
```

**Note**: Requires `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers.

**Expected Impact**: 4-8x faster on multi-core machines

---

## Phase 3: Memory & Algorithm Optimizations (Expected: 1.5-2x improvement)

### 3.1 Structure of Arrays (SoA) Layout

Change mesh layout for SIMD-friendly memory access.

```rust
// Current (AoS - bad for SIMD)
pub struct Mesh {
    positions: Vec<f32>,  // [x,y,z, x,y,z, ...]
    normals: Vec<f32>,    // [nx,ny,nz, ...]
    indices: Vec<u32>,
}

// Better (SoA - SIMD friendly)
pub struct MeshSoA {
    pos_x: Vec<f32>,
    pos_y: Vec<f32>,
    pos_z: Vec<f32>,
    norm_x: Vec<f32>,
    norm_y: Vec<f32>,
    norm_z: Vec<f32>,
    indices: Vec<u32>,
}
```

**Why**: SIMD operations can process 4-8 vertices at once when data is contiguous.

### 3.2 Arena Allocator for Temporary Data

Reduce allocation overhead in hot paths.

```rust
use bumpalo::Bump;

pub fn process_element(&self, ..., arena: &Bump) -> Result<Mesh> {
    // Allocate temporary buffers in arena (very fast)
    let temp_points: &mut Vec<Point3<f64>> = arena.alloc(Vec::new());

    // Process...

    // Arena is reset after processing (one deallocation for all temps)
}
```

**Expected Impact**: 20-40% reduction in allocation overhead

### 3.3 Lazy Entity Decoding with Byte Slices

Don't parse entities until needed, and avoid string allocations.

```rust
// Instead of storing parsed tokens, store byte slices
pub struct LazyEntity<'a> {
    id: u32,
    ifc_type: IfcType,
    raw_attributes: &'a [u8],  // Unparsed attribute bytes
}

impl<'a> LazyEntity<'a> {
    // Parse on demand
    fn get_ref(&self, index: usize) -> Option<u32> {
        // Fast: scan for #NNN pattern at position
    }

    fn get_float(&self, index: usize) -> Option<f64> {
        // Fast: parse float from bytes
    }
}
```

**Expected Impact**: 30-50% faster parsing for files where not all attributes are used

---

## Phase 4: Advanced Techniques (Expected: 2-3x improvement)

### 4.1 Pre-computed Entity Index File Format

Create a companion `.ifcidx` file for instant loading.

```rust
// Index file format:
// Header: magic, version, entity_count
// For each entity: id (u32), type_hash (u32), offset (u64), length (u32)

pub struct IfcIndex {
    entities: Vec<EntityIndexEntry>,
    type_lookup: FxHashMap<IfcType, Vec<usize>>,
}

impl IfcIndex {
    pub fn load_or_build(ifc_path: &Path) -> Self {
        let idx_path = ifc_path.with_extension("ifcidx");

        if idx_path.exists() && is_newer_than(idx_path, ifc_path) {
            // Load pre-computed index (instant)
            Self::load_from_file(idx_path)
        } else {
            // Build and save for next time
            let index = Self::build_from_ifc(ifc_path);
            index.save_to_file(idx_path);
            index
        }
    }
}
```

**Expected Impact**: Near-instant repeat loads (100x+ faster)

### 4.2 Streaming Progressive Loading

Load and display geometry progressively.

```rust
pub struct StreamingParser {
    content: String,
    position: usize,
    batch_size: usize,
}

impl StreamingParser {
    pub async fn next_batch(&mut self) -> Option<Vec<Mesh>> {
        // Process batch_size entities
        // Yield back to event loop
        // Return meshes for immediate display
    }
}
```

```javascript
// Usage
const parser = new StreamingParser(ifcContent);
while (true) {
    const batch = await parser.nextBatch();
    if (!batch) break;
    viewer.addMeshes(batch);
    await new Promise(r => setTimeout(r, 0)); // Allow UI updates
}
```

**Expected Impact**: Perceived instant loading, progressive refinement

### 4.3 GPU Compute for Geometry (WebGPU)

Use WebGPU compute shaders for heavy operations.

```rust
// WebGPU compute shader for transform
@compute @workgroup_size(64)
fn transform_vertices(
    @builtin(global_invocation_id) id: vec3<u32>,
    @storage @read positions_in: array<vec4<f32>>,
    @storage @read_write positions_out: array<vec4<f32>>,
    @uniform transform: mat4x4<f32>
) {
    let idx = id.x;
    positions_out[idx] = transform * positions_in[idx];
}
```

**Operations to GPU-accelerate**:
- Mesh transforms (millions of vertices)
- Normal calculations
- Bounding box calculations
- CSG operations (future)

**Expected Impact**: 10-100x faster for large meshes

---

## Phase 5: Profile-Guided Optimization (Expected: 10-20% improvement)

### 5.1 Rust PGO (Profile-Guided Optimization)

```bash
# 1. Build with instrumentation
RUSTFLAGS="-Cprofile-generate=/tmp/pgo-data" \
    cargo build --release

# 2. Run benchmarks to collect profile
./benchmark-suite

# 3. Merge profile data
llvm-profdata merge -o /tmp/pgo-data/merged.profdata /tmp/pgo-data

# 4. Build with profile data
RUSTFLAGS="-Cprofile-use=/tmp/pgo-data/merged.profdata" \
    cargo build --release
```

### 5.2 BOLT (Binary Optimization and Layout Tool)

Post-link optimization for better instruction cache usage.

```bash
# Requires LLVM BOLT
llvm-bolt target/release/ifc-lite.wasm -o ifc-lite-bolted.wasm \
    -data=/tmp/bolt-profile.fdata -reorder-blocks=cache+ \
    -reorder-functions=hfsort
```

---

## Implementation Priority Matrix

| Optimization | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| Enable wasm-opt | Low | High | **P0** |
| MappedItem Cache | Low | High | **P0** |
| WASM SIMD | Medium | High | **P1** |
| Web Workers | Medium | Very High | **P1** |
| wasm-bindgen-rayon | High | Very High | **P1** |
| SoA Layout | Medium | Medium | **P2** |
| Arena Allocator | Medium | Medium | **P2** |
| Lazy Decoding | High | Medium | **P2** |
| Pre-computed Index | Medium | High | **P2** |
| Streaming Loading | Medium | Medium | **P3** |
| WebGPU Compute | High | Very High | **P3** |
| PGO | Medium | Low | **P4** |

---

## Quick Wins Checklist

- [ ] Enable `wasm-opt` with `-O4 --enable-simd`
- [ ] Add `MappedItem` geometry cache
- [ ] Enable nalgebra SIMD features
- [ ] Add `#[inline]` to all hot path functions
- [ ] Pre-allocate all vectors with `with_capacity`
- [ ] Use `FxHashMap` everywhere instead of `HashMap`
- [ ] Remove unnecessary `.clone()` calls
- [ ] Use `&str` instead of `String` where possible

---

## Benchmark Targets

| File Size | Current | Target | Improvement |
|-----------|---------|--------|-------------|
| Small (<1MB) | 5-20ms | <5ms | 4x |
| Medium (1-5MB) | 20-50ms | <15ms | 3x |
| Large (5-20MB) | 500-700ms | <100ms | 5-7x |
| Very Large (>20MB) | >1s | <200ms | 5x+ |

---

## Conclusion

By implementing these optimizations in phases, we can achieve:

- **Phase 1**: 2-3x faster (immediate)
- **Phase 2**: Additional 3-5x (parallel processing)
- **Phase 3**: Additional 1.5-2x (memory optimization)
- **Phase 4**: Additional 2-3x (advanced techniques)

**Total potential**: 10-30x faster than current implementation, 5-15x faster than web-ifc.

The key insight is that **parallelization** (Web Workers + wasm-bindgen-rayon) will provide the largest gains for large files, while **caching** (MappedItem) will help files with repeated geometry.

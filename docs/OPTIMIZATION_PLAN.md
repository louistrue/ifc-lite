# IFC-Lite Performance Optimization Plan

## Executive Summary

Based on comprehensive analysis of the codebase and benchmark results, this document outlines a structured plan to make IFC-Lite significantly faster. The optimizations are organized into three phases with expected cumulative improvements of **60-80%**.

**Current Benchmark Results:**
- Overall speedup vs web-ifc: 1.09x (9% faster)
- Median speedup: 1.13x
- Wins: IFC-Lite 10, web-ifc 7

**Target After Optimizations:**
- Overall speedup vs web-ifc: **2.5-3.5x**
- Consistent wins on all file types

---

## Phase 1: Quick Wins (20-30% improvement)

### 1.1 Use Cow<str> for AttributeValue
**File:** `rust/core/src/schema_gen.rs:36-58`
**Impact:** 20-40% reduction in attribute decoding time
**Effort:** Medium

**Problem:** Every string token allocates via `to_string()`:
```rust
Token::String(s) => AttributeValue::String(s.to_string()),  // Allocates
Token::Enum(e) => AttributeValue::Enum(e.to_string()),      // Allocates
```

**Solution:**
```rust
use std::borrow::Cow;

pub enum AttributeValue<'a> {
    String(Cow<'a, str>),    // Zero-copy when possible
    Enum(Cow<'a, str>),
    // ...
}

impl<'a> AttributeValue<'a> {
    pub fn from_token(token: &Token<'a>) -> Self {
        match token {
            Token::String(s) => AttributeValue::String(Cow::Borrowed(s)),
            Token::Enum(e) => AttributeValue::Enum(Cow::Borrowed(e)),
            // ...
        }
    }
}
```

---

### 1.2 Replace Cache Cloning with Arc
**File:** `rust/core/src/decoder.rs:145,190`
**Impact:** 50-80% faster repeated lookups
**Effort:** Low

**Problem:** Every cache hit clones entire DecodedEntity:
```rust
pub fn get_cached(&self, entity_id: u32) -> Option<DecodedEntity> {
    self.cache.get(&entity_id).cloned()  // Full clone!
}
```

**Solution:**
```rust
use std::sync::Arc;

pub struct EntityDecoder<'a> {
    cache: FxHashMap<u32, Arc<DecodedEntity>>,
}

pub fn get_cached(&self, entity_id: u32) -> Option<Arc<DecodedEntity>> {
    self.cache.get(&entity_id).cloned()  // Arc clone = cheap refcount
}
```

---

### 1.3 Fix Token Parser Ordering
**File:** `rust/core/src/parser.rs:198-208`
**Impact:** 5-10% faster tokenization
**Effort:** Low

**Problem:** Current order tests expensive patterns first:
```rust
alt((
    float,        // EXPENSIVE: tries . matching for every number
    integer,
    entity_ref,
    // ...
))
```

**Solution:** Reorder to test cheapest patterns first:
```rust
alt((
    null,         // Single char: $
    derived,      // Single char: *
    entity_ref,   // Single char: # + digits
    integer,      // Digits only
    enum_value,   // Single char: .
    string_literal,
    typed_value,
    list,
    float,        // Most expensive - last
))
```

---

### 1.4 Optimize Event Serialization with serde-wasm-bindgen
**File:** `rust/wasm-bindings/src/api.rs:359-437`
**Impact:** 5-10% speedup on streaming parse
**Effort:** Low

**Problem:** 23+ `Reflect::set()` FFI calls per event:
```rust
fn parse_event_to_js(event: &ParseEvent) -> JsValue {
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"type".into(), &"started".into()).unwrap();
    js_sys::Reflect::set(&obj, &"fileSize".into(), &(*file_size as f64).into()).unwrap();
    // ... 21 more Reflect::set calls
}
```

**Solution:**
```rust
use serde::Serialize;
use serde_wasm_bindgen;

#[derive(Serialize)]
pub enum ParseEvent {
    #[serde(rename = "started")]
    Started { file_size: usize, timestamp: u64 },
    // ...
}

fn parse_event_to_js(event: &ParseEvent) -> JsValue {
    serde_wasm_bindgen::to_value(event).unwrap()  // Single FFI call
}
```

---

### 1.5 Remove TypedArray Copies in MeshDataJs
**File:** `rust/wasm-bindings/src/zero_copy.rs:32-45`
**Impact:** 5-8% faster mesh retrieval
**Effort:** Low

**Problem:** Every getter creates a copy:
```rust
pub fn positions(&self) -> js_sys::Float32Array {
    js_sys::Float32Array::from(&self.positions[..])  // Creates copy
}
```

**Solution:** Expose raw pointers for true zero-copy:
```rust
#[wasm_bindgen(getter)]
pub fn positions_ptr(&self) -> *const f32 {
    self.positions.as_ptr()
}

#[wasm_bindgen(getter)]
pub fn positions_len(&self) -> usize {
    self.positions.len()
}
```

JavaScript side:
```javascript
const view = new Float32Array(
    memory.buffer,
    mesh.positions_ptr,
    mesh.positions_len
);
```

---

## Phase 2: Major Gains (30-40% additional improvement)

### 2.1 SIMD String Parsing with memchr
**File:** `rust/core/src/parser.rs:56-100`
**Impact:** 2-3x faster string parsing
**Effort:** Medium

**Problem:** Manual byte-by-byte iteration:
```rust
while i < bytes.len() {
    if bytes[i] as char == quote {
        if i + 1 < bytes.len() && bytes[i + 1] as char == quote {
            i += 2;
            continue;
        } else {
            return Ok((&input[i..], &input[..i]));
        }
    }
    i += 1;
}
```

**Solution:** Use memchr for SIMD-accelerated scanning:
```rust
use memchr::memchr;

fn parse_string_content(input: &str, quote: char) -> IResult<&str, &str> {
    let bytes = input.as_bytes();
    let quote_byte = quote as u8;
    let mut pos = 0;

    while let Some(found) = memchr(quote_byte, &bytes[pos..]) {
        let idx = pos + found;
        // Check for escaped quote (doubled)
        if idx + 1 < bytes.len() && bytes[idx + 1] == quote_byte {
            pos = idx + 2;  // Skip escaped quote
            continue;
        }
        return Ok((&input[idx..], &input[..idx]));
    }
    Err(nom::Err::Incomplete(nom::Needed::Unknown))
}
```

---

### 2.2 Use SmallVec for Token::List
**File:** `rust/core/src/parser.rs:36`
**Impact:** 30-50% reduction in allocations
**Effort:** Medium

**Problem:** Every list allocates a Vec:
```rust
pub enum Token<'a> {
    List(Vec<Token<'a>>),  // Each list allocates heap
}
```

**Solution:** Use SmallVec for lists < 16 items (95% of IFC lists):
```rust
use smallvec::SmallVec;

pub enum Token<'a> {
    List(SmallVec<[Token<'a>; 16]>),  // Stack-allocated for small lists
}
```

---

### 2.3 Chunk-Based Transform Processing
**Files:** `rust/geometry/src/router.rs:396-425`, `rust/geometry/src/extrusion.rs:126-160`
**Impact:** 15-20% faster mesh transformations
**Effort:** Low

**Problem:** Repeated f32↔f64 conversions with manual indexing:
```rust
for i in (0..mesh.positions.len()).step_by(3) {
    let point = Point3::new(
        mesh.positions[i] as f64,
        mesh.positions[i + 1] as f64,
        mesh.positions[i + 2] as f64,
    );
    // ...
}
```

**Solution:** Use chunks for better cache locality:
```rust
mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
    let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
    let transformed = transform.transform_point(&point);
    chunk[0] = transformed.x as f32;
    chunk[1] = transformed.y as f32;
    chunk[2] = transformed.z as f32;
});
```

---

### 2.4 Single-Pass Processing
**File:** `rust/wasm-bindings/src/api.rs:200-254`
**Impact:** 10-15% faster parse_meshes
**Effort:** High

**Problem:** File scanned 5-6 times:
```rust
build_entity_index(&content);           // Pass 1
build_geometry_style_index(...);        // Pass 2
build_element_style_index(...);         // Pass 3
EntityScanner::new(&content);           // Pass 4
// Main processing                      // Pass 5
```

**Solution:** Unified single-pass processor:
```rust
pub struct SinglePassProcessor<'a> {
    content: &'a str,
    entity_index: EntityIndex,
    style_index: StyleIndex,
    meshes: Vec<MeshData>,
}

impl<'a> SinglePassProcessor<'a> {
    pub fn process(content: &'a str) -> MeshCollection {
        let mut processor = Self::new(content);

        // Single pass through entities
        for entity in EntityScanner::new(content) {
            processor.index_entity(&entity);
            processor.collect_style(&entity);
            processor.process_geometry(&entity);
        }

        processor.into_collection()
    }
}
```

---

### 2.5 Consolidate Circle Generation
**File:** `rust/geometry/src/profiles.rs` (multiple locations)
**Impact:** 20-25% faster profile processing
**Effort:** Medium

**Problem:** Circle generation duplicated 4+ times across 200+ lines.

**Solution:** Extract to shared utility:
```rust
// rust/geometry/src/utils.rs
pub fn generate_circle_points(
    radius: f64,
    segments: usize,
    center: Point2<f64>,
    start_angle: f64,
    end_angle: f64,
) -> Vec<Point2<f64>> {
    let angle_step = (end_angle - start_angle) / segments as f64;
    (0..=segments)
        .map(|i| {
            let angle = start_angle + i as f64 * angle_step;
            Point2::new(
                center.x + radius * angle.cos(),
                center.y + radius * angle.sin(),
            )
        })
        .collect()
}
```

---

### 2.6 Accept Binary Input
**File:** `rust/wasm-bindings/src/api.rs`
**Impact:** 5-10% speedup, 50% memory reduction
**Effort:** Low

**Problem:** All methods require String conversion:
```rust
pub fn parse(&self, content: String) -> Promise
```

**Solution:** Add binary input methods:
```rust
#[wasm_bindgen(js_name = parseBinary)]
pub fn parse_binary(&self, content: Vec<u8>) -> Promise {
    // Skip UTF-8 validation, use lossy conversion
    let ifc_string = String::from_utf8_lossy(&content);
    self.parse_internal(&ifc_string)
}
```

---

## Phase 3: Advanced Optimizations (10-20% additional improvement)

### 3.1 Cache Processor Instances
**File:** `rust/geometry/src/processors.rs:777-800`
**Impact:** 8-12% faster geometry processing
**Effort:** Low

**Problem:** New processor created per item:
```rust
IfcType::IfcExtrudedAreaSolid => {
    let processor = ExtrudedAreaSolidProcessor::new(schema.clone());
    processor.process(&item, decoder, schema)?
}
```

**Solution:** Use thread-local cached processors:
```rust
thread_local! {
    static EXTRUSION_PROCESSOR: RefCell<Option<ExtrudedAreaSolidProcessor>> = RefCell::new(None);
}

fn get_extrusion_processor(schema: &Arc<IfcSchema>) -> ExtrudedAreaSolidProcessor {
    EXTRUSION_PROCESSOR.with(|cell| {
        cell.borrow_mut()
            .get_or_insert_with(|| ExtrudedAreaSolidProcessor::new(schema.clone()))
            .clone()
    })
}
```

---

### 3.2 Parallel Geometry Processing
**Files:** `rust/geometry/src/router.rs`, `rust/wasm-bindings/src/api.rs`
**Impact:** 30-50% faster on multi-core (large files)
**Effort:** High

**Solution:** Use rayon for parallel processing:
```rust
use rayon::prelude::*;

pub fn process_all_meshes(entities: &[Entity]) -> Vec<MeshData> {
    entities
        .par_iter()  // Parallel iterator
        .filter_map(|entity| process_entity(entity).ok())
        .collect()
}
```

Note: Requires careful handling of shared state and WASM thread support.

---

### 3.3 Arena Allocation for Tokens
**File:** `rust/core/src/parser.rs`
**Impact:** 20-30% faster parsing
**Effort:** High

**Solution:** Use bumpalo arena for token allocation:
```rust
use bumpalo::Bump;

pub struct TokenArena<'bump> {
    arena: &'bump Bump,
}

pub enum Token<'bump> {
    List(bumpalo::collections::Vec<'bump, Token<'bump>>),
    String(&'bump str),
    // ...
}
```

---

### 3.4 Profile Triangulation Optimization
**File:** `rust/geometry/src/profile.rs:42-76`
**Impact:** 8% faster triangulation
**Effort:** Medium

**Problem:** Flatten/unflatten cycle:
```rust
let mut vertices = Vec::with_capacity(...);
for p in &self.outer {
    vertices.push(p.x);
    vertices.push(p.y);
}
// ... pass to earcutr ...
// ... reconstruct Point2 vec ...
```

**Solution:** Keep flattened format or create specialized wrapper:
```rust
pub struct FlattenedProfile {
    vertices: Vec<f64>,  // Already flat
    hole_indices: Vec<usize>,
}

impl FlattenedProfile {
    pub fn triangulate(&self) -> Result<Vec<u32>, Error> {
        earcutr::earcut(&self.vertices, &self.hole_indices, 2)
    }
}
```

---

### 3.5 Optimize MeshCollection Iteration
**File:** `rust/wasm-bindings/src/zero_copy.rs:96-103`
**Impact:** 10% faster mesh iteration
**Effort:** Medium

**Problem:** Every `.get()` clones all geometry:
```rust
pub fn get(&self, index: usize) -> Option<MeshDataJs> {
    self.meshes.get(index).map(|m| MeshDataJs {
        positions: m.positions.clone(),  // Full clone!
        // ...
    })
}
```

**Solution:** Lazy evaluation with pointer references:
```rust
pub struct MeshRef {
    collection_ptr: *const MeshCollection,
    index: usize,
}

impl MeshRef {
    pub fn positions_ptr(&self) -> *const f32 {
        unsafe {
            (*self.collection_ptr).meshes[self.index].positions.as_ptr()
        }
    }
}
```

---

## Implementation Priority Matrix

| Optimization | Phase | Impact | Effort | Priority |
|-------------|-------|--------|--------|----------|
| Cow<str> for AttributeValue | 1 | 20-40% | Medium | **Critical** |
| Arc for cache | 1 | 50-80% | Low | **Critical** |
| Token parser ordering | 1 | 5-10% | Low | High |
| Event serialization | 1 | 5-10% | Low | High |
| Remove TypedArray copies | 1 | 5-8% | Low | High |
| SIMD string parsing | 2 | 2-3x | Medium | **Critical** |
| SmallVec for lists | 2 | 30-50% | Medium | High |
| Chunk-based transforms | 2 | 15-20% | Low | High |
| Single-pass processing | 2 | 10-15% | High | High |
| Circle generation | 2 | 20-25% | Medium | Medium |
| Binary input | 2 | 5-10% | Low | Medium |
| Cache processors | 3 | 8-12% | Low | Medium |
| Parallel processing | 3 | 30-50% | High | Future |
| Arena allocation | 3 | 20-30% | High | Future |

---

## Expected Results

### After Phase 1 (Quick Wins)
- Parsing: 30-40% faster
- Memory: 20% reduction
- Overall: **1.4-1.6x faster** than current

### After Phase 2 (Major Gains)
- Parsing: 60-70% faster
- Geometry: 40-50% faster
- Overall: **2.0-2.5x faster** than current

### After Phase 3 (Advanced)
- Full pipeline: 70-80% faster
- Overall: **2.5-3.5x faster** than current
- Consistent wins over web-ifc on all file types

---

## Benchmark Tracking

Run benchmarks after each optimization:
```bash
cd tests/benchmark && node run-benchmark.mjs
```

Key metrics to track:
- Total processing time per file
- Memory peak usage
- Vertices/triangles per second
- Win/loss ratio vs web-ifc

---

## Files to Modify

### Phase 1
- `rust/core/src/schema_gen.rs`
- `rust/core/src/decoder.rs`
- `rust/core/src/parser.rs`
- `rust/wasm-bindings/src/api.rs`
- `rust/wasm-bindings/src/zero_copy.rs`
- `rust/wasm-bindings/Cargo.toml` (add serde-wasm-bindgen)

### Phase 2
- `rust/core/src/parser.rs`
- `rust/geometry/src/router.rs`
- `rust/geometry/src/extrusion.rs`
- `rust/geometry/src/profiles.rs`
- `rust/geometry/src/utils.rs` (new)
- `rust/wasm-bindings/src/api.rs`
- `rust/core/Cargo.toml` (add smallvec)

### Phase 3
- `rust/geometry/src/processors.rs`
- `rust/geometry/src/profile.rs`
- `rust/wasm-bindings/src/zero_copy.rs`
- `rust/core/Cargo.toml` (add bumpalo, rayon)

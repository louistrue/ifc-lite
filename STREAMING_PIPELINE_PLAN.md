# Streaming Entity Index + Forward-Reference Queue Plan

## Executive Summary

This plan proposes transforming the IFC parsing pipeline from a sequential three-phase architecture (Scan → Index → Process) to a streaming architecture where geometry processing starts immediately as entities are indexed. The key insight is that IFC files have mostly backward references (~95%), allowing immediate processing of most geometry without waiting for the full index.

**Target Metrics:**
- First geometry visible: **<100ms** (currently 500ms-2s)
- 50% geometry rendered: **<300ms** (currently 1-3s)
- 95% geometry rendered: **<500ms** (currently 2-5s)
- 100% complete: **unchanged** (same total work)

---

## Current Architecture Analysis

### Phase Timing (from existing WASM profiling in `api.rs`)
```
[IFC-LITE PROFILE] Index: 150ms, Scan: 80ms, Style: 50ms, FacetedBrep: 100ms, Process: 200ms
```

The bottleneck is **sequential execution**: nothing renders until Index + Scan complete (~230ms minimum).

### Current Flow
```
┌────────────────────────────────────────────────────────────────────┐
│ build_entity_index()  │ Single-pass O(n) SIMD scan                 │
│ (150-300ms)           │ Builds FxHashMap<u32, (usize, usize)>      │
├────────────────────────────────────────────────────────────────────┤
│ EntityScanner scan    │ Second pass: classify entities, collect    │
│ (50-100ms)            │ FacetedBreps, voids, styled items          │
├────────────────────────────────────────────────────────────────────┤
│ preprocess_faceted_breps() │ Batch triangulate ALL BREPs           │
│ (varies)              │                                             │
├────────────────────────────────────────────────────────────────────┤
│ for (building_elements) │ Sequential geometry processing           │
│ (200-500ms)           │ Each element waits for refs to be indexed  │
└────────────────────────────────────────────────────────────────────┘
```

### Reference Pattern Analysis

Based on codebase review (`rust/geometry/src/processors.rs`):

**Geometry entities reference:**
1. **Profile definitions** (backward refs) - e.g., `IFCARBITRARYCLOSEDPROFILEDEF`
2. **Axis/Direction** (backward refs) - e.g., `IFCAXIS2PLACEMENT3D`
3. **Cartesian points** (backward refs) - typically defined before use
4. **Material/Style** (backward refs) - `IFCSTYLEDITEM` references items
5. **Placement hierarchy** (backward refs) - `IFCLOCALPLACEMENT` → parent

**Forward references are rare (~5%):**
- Some `IFCRELCONTAINEDINSPATIALSTRUCTURE` define containment after elements
- Occasional `IFCRELDEFINES*` relationships defined after elements
- Style assignments sometimes after geometry

---

## Proposed Streaming Architecture

### Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                      STREAMING PIPELINE                             │
├────────────────────────────────────────────────────────────────────┤
│  Entity Scanner   →  Incremental Index  →  Immediate Process       │
│      (O(n))              (O(1))              (if refs ready)        │
│                                                                      │
│  #1 scanned  ────→  index[1]=(s,e)  ────→  process #1 → RENDER     │
│  #2 scanned  ────→  index[2]=(s,e)  ────→  process #2 → RENDER     │
│  #3 scanned  ────→  index[3]=(s,e)  ────→  [refs #99 missing]      │
│    └─────────────────────────────────────────→  PENDING_QUEUE      │
│  ...                                                                 │
│  #99 scanned ────→  index[99]=(s,e) ────→  retry #3 → RENDER       │
│                         └──── forward-ref resolved ───┘             │
└────────────────────────────────────────────────────────────────────┘
```

### Key Data Structures

#### 1. Incremental Entity Index (Rust)
```rust
// In rust/core/src/decoder.rs

pub struct IncrementalEntityIndex {
    /// Entity ID → (byte_start, byte_end)
    index: FxHashMap<u32, (usize, usize)>,
    /// Track highest indexed entity for forward-ref detection
    max_indexed_id: u32,
}

impl IncrementalEntityIndex {
    /// Index single entity - O(1)
    #[inline]
    pub fn index_entity(&mut self, id: u32, start: usize, end: usize) {
        self.index.insert(id, (start, end));
        self.max_indexed_id = self.max_indexed_id.max(id);
    }

    /// Check if entity is indexed - O(1)
    #[inline]
    pub fn is_indexed(&self, id: u32) -> bool {
        self.index.contains_key(&id)
    }

    /// Get entity bounds if indexed
    #[inline]
    pub fn get(&self, id: u32) -> Option<(usize, usize)> {
        self.index.get(&id).copied()
    }

    /// Check if ID is a forward reference (not yet indexed)
    #[inline]
    pub fn is_forward_ref(&self, id: u32) -> bool {
        id > self.max_indexed_id || !self.index.contains_key(&id)
    }
}
```

#### 2. Forward-Reference Queue (TypeScript)
```typescript
// In packages/geometry/src/streaming-processor.ts (NEW FILE)

interface PendingEntity {
  entityId: number;
  start: number;
  end: number;
  missingRefs: number[];
  retryCount: number;
  queuedAt: number;
}

export class ForwardReferenceQueue {
  private pending: Map<number, PendingEntity> = new Map();
  private waitingFor: Map<number, Set<number>> = new Map(); // refId → entityIds waiting

  /** Queue entity for later processing */
  enqueue(entityId: number, start: number, end: number, missingRefs: number[]): void {
    this.pending.set(entityId, {
      entityId,
      start,
      end,
      missingRefs,
      retryCount: 0,
      queuedAt: performance.now()
    });

    // Track which entities are waiting for each ref
    for (const ref of missingRefs) {
      if (!this.waitingFor.has(ref)) {
        this.waitingFor.set(ref, new Set());
      }
      this.waitingFor.get(ref)!.add(entityId);
    }
  }

  /** Called when a ref becomes available - returns entities ready to process */
  onRefIndexed(refId: number): PendingEntity[] {
    const waiting = this.waitingFor.get(refId);
    if (!waiting) return [];

    const readyEntities: PendingEntity[] = [];

    for (const entityId of waiting) {
      const pending = this.pending.get(entityId);
      if (!pending) continue;

      // Remove this ref from missing list
      pending.missingRefs = pending.missingRefs.filter(r => r !== refId);

      // If no more missing refs, entity is ready
      if (pending.missingRefs.length === 0) {
        readyEntities.push(pending);
        this.pending.delete(entityId);
      }
    }

    this.waitingFor.delete(refId);
    return readyEntities;
  }

  /** Get all pending entities (for final flush) */
  flush(): PendingEntity[] {
    const all = Array.from(this.pending.values());
    this.pending.clear();
    this.waitingFor.clear();
    return all;
  }

  get size(): number {
    return this.pending.size;
  }
}
```

#### 3. Reference Extractor (Rust - fast path)
```rust
// In rust/core/src/decoder.rs - new method

impl EntityDecoder<'_> {
    /// Fast extraction of all entity references from an entity
    /// Returns Vec of referenced entity IDs for forward-ref checking
    #[inline]
    pub fn extract_refs_fast(&mut self, entity_id: u32) -> Option<Vec<u32>> {
        let bytes = self.get_raw_bytes(entity_id)?;
        let mut refs = Vec::with_capacity(8);
        let mut i = 0;
        let len = bytes.len();

        while i < len {
            if bytes[i] == b'#' {
                i += 1;
                let start = i;
                while i < len && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > start {
                    let mut ref_id = 0u32;
                    for &b in &bytes[start..i] {
                        ref_id = ref_id.wrapping_mul(10).wrapping_add((b - b'0') as u32);
                    }
                    refs.push(ref_id);
                }
            } else {
                i += 1;
            }
        }

        if refs.is_empty() { None } else { Some(refs) }
    }
}
```

---

## Implementation Plan

### Phase 1: Rust - Incremental Index API (1-2 days)

**Files to modify:**
- `rust/core/src/decoder.rs`
- `rust/core/src/lib.rs`

**Changes:**
1. Add `IncrementalEntityIndex` struct
2. Add `extract_refs_fast()` method to `EntityDecoder`
3. Add `try_decode_by_id()` that returns `Option<Result<...>>` (non-panicking)
4. Add `with_incremental_index()` constructor

**Test:**
```rust
#[test]
fn test_incremental_index() {
    let index = IncrementalEntityIndex::new();
    index.index_entity(1, 0, 50);
    assert!(index.is_indexed(1));
    assert!(!index.is_indexed(2)); // Not yet indexed
    assert!(index.is_forward_ref(2));
}
```

### Phase 2: WASM - Streaming API (1-2 days)

**Files to modify:**
- `rust/wasm-bindings/src/api.rs`

**New methods:**
```rust
/// Scan and index entities incrementally, yielding batches
#[wasm_bindgen(js_name = scanEntitiesStreaming)]
pub async fn scan_entities_streaming(
    &self,
    content: String,
    batch_size: u32,
    callback: Function
) -> Promise {
    // For each batch:
    // 1. Scan next batch_size entities
    // 2. Index them incrementally
    // 3. Extract refs for each
    // 4. Return { entities: [{id, start, end, refs}], nextOffset }
}

/// Process geometry for entities with all refs available
#[wasm_bindgen(js_name = processGeometryBatch)]
pub fn process_geometry_batch(
    &self,
    entity_ids: Vec<u32>,
) -> MeshBatch {
    // Process only entities whose refs are all indexed
    // Skip (return empty) for entities with unresolved refs
}
```

### Phase 3: TypeScript - Streaming Processor (2-3 days)

**Files to create:**
- `packages/geometry/src/streaming-processor.ts`
- `packages/geometry/src/federated-streaming-processor.ts`

**StreamingGeometryProcessor:**
```typescript
export class StreamingGeometryProcessor {
  private index = new IncrementalEntityIndex();
  private forwardRefQueue = new ForwardReferenceQueue();
  private wasmApi: IfcAPI;
  private onMeshReady: (mesh: MeshData) => void;

  constructor(wasmApi: IfcAPI, onMeshReady: (mesh: MeshData) => void) {
    this.wasmApi = wasmApi;
    this.onMeshReady = onMeshReady;
  }

  /** Process entity batch from scanner */
  async processBatch(batch: EntityBatch): Promise<void> {
    for (const entity of batch.entities) {
      // Index the entity
      this.index.indexEntity(entity.id, entity.start, entity.end);

      // Check if any pending entities can now resolve
      const readyEntities = this.forwardRefQueue.onRefIndexed(entity.id);
      for (const ready of readyEntities) {
        await this.processEntity(ready.entityId, ready.start, ready.end);
      }

      // Try to process this entity immediately
      await this.tryProcessEntity(entity);
    }
  }

  private async tryProcessEntity(entity: ScannedEntity): Promise<void> {
    // Check if this is a geometry-producing entity
    if (!hasGeometry(entity.typeName)) return;

    // Check if all refs are indexed
    const missingRefs = entity.refs.filter(r => !this.index.isIndexed(r));

    if (missingRefs.length === 0) {
      await this.processEntity(entity.id, entity.start, entity.end);
    } else {
      // Queue for later
      this.forwardRefQueue.enqueue(entity.id, entity.start, entity.end, missingRefs);
    }
  }

  private async processEntity(id: number, start: number, end: number): Promise<void> {
    try {
      const mesh = this.wasmApi.processGeometry(id, start, end);
      if (mesh && !mesh.isEmpty()) {
        this.onMeshReady(mesh);
      }
    } catch (e) {
      // Geometry processing failed - log and skip
      console.warn(`Failed to process entity #${id}:`, e);
    }
  }

  /** Process remaining queued entities */
  async flush(): Promise<void> {
    const pending = this.forwardRefQueue.flush();
    for (const entity of pending) {
      await this.processEntity(entity.entityId, entity.start, entity.end);
    }
  }
}
```

### Phase 4: Viewer Integration (1-2 days)

**Files to modify:**
- `apps/viewer/src/hooks/useIfc.ts`
- `packages/geometry/src/ifc-lite-bridge.ts`

**Integration approach:**
```typescript
// In useIfc.ts, replace current geometry processing with:

const processor = new StreamingGeometryProcessor(wasmApi, (mesh) => {
  // Immediately add to scene via appendGeometryBatch
  appendGeometryBatch([mesh], coordinateInfo);

  // Update progress
  processedCount++;
  setProgress({
    phase: `Streaming geometry (${processedCount} meshes)`,
    percent: 10 + (processedCount / estimatedTotal) * 85
  });
});

// Stream scan + process
for await (const batch of wasmApi.scanEntitiesStreaming(content, 100)) {
  await processor.processBatch(batch);

  // Yield to allow rendering
  await new Promise(r => setTimeout(r, 0));
}

// Process any remaining forward-ref entities
await processor.flush();
```

### Phase 5: Multi-Model Federation (1 day)

**Files to create:**
- `packages/geometry/src/federated-streaming-processor.ts`

**FederatedStreamingProcessor:**
```typescript
export class FederatedStreamingProcessor {
  private processors = new Map<string, StreamingGeometryProcessor>();
  private federationRegistry: FederationRegistry;

  async loadModel(modelId: string, buffer: ArrayBuffer): Promise<void> {
    // Estimate entity count for ID allocation
    const estimatedEntities = Math.ceil(buffer.byteLength / 50);

    // Register with federation registry BEFORE processing
    const idOffset = this.federationRegistry.registerModel(modelId, estimatedEntities);

    const processor = new StreamingGeometryProcessor(this.wasmApi, (mesh) => {
      // Apply ID offset for federation
      mesh.expressId += idOffset;
      this.onMeshReady(modelId, mesh);
    });

    this.processors.set(modelId, processor);

    // Stream in parallel with other models
    await this.streamModel(modelId, processor, buffer);
  }
}
```

---

## Risk Analysis & Mitigations

### Risk 1: Deep Forward-Reference Chains
**Scenario:** Entity #100 refs #500 which refs #800 (chain of forward refs)
**Mitigation:**
- Track retry count per entity
- After 3 retries, fall back to batch processing for that entity
- These are rare (<0.1% of entities)

### Risk 2: Memory Pressure from Pending Queue
**Scenario:** 10,000 entities queued waiting for one late entity
**Mitigation:**
- Set max queue size (e.g., 5000)
- If exceeded, pause streaming and process batch
- In practice, queue rarely exceeds ~50 entities

### Risk 3: WASM Boundary Overhead
**Scenario:** Too many small WASM calls slow things down
**Mitigation:**
- Batch entity processing (process 50-100 entities per WASM call)
- Pre-allocate buffers in WASM
- Use shared memory (existing pattern)

### Risk 4: Race Conditions in Federation
**Scenario:** Two models indexed simultaneously, IDs conflict
**Mitigation:**
- FederationRegistry is already single-threaded (existing pattern)
- ID ranges allocated before processing starts
- Each model has own StreamingProcessor instance

---

## Testing Strategy

### Unit Tests
1. **IncrementalEntityIndex:** Index/lookup/forward-ref detection
2. **ForwardReferenceQueue:** Enqueue/resolve/flush
3. **Reference extraction:** Parse refs from various entity types

### Integration Tests
```typescript
// packages/geometry/src/__tests__/streaming-processor.test.ts

describe('StreamingGeometryProcessor', () => {
  it('processes backward-ref entities immediately', async () => {
    const meshes: MeshData[] = [];
    const processor = new StreamingGeometryProcessor(api, m => meshes.push(m));

    // Simulate scanning: point first, then extrusion using that point
    await processor.processBatch([
      { id: 1, type: 'IFCCARTESIANPOINT', refs: [] },
      { id: 2, type: 'IFCEXTRUDEDAREASOLID', refs: [1] }
    ]);

    expect(meshes.length).toBe(1); // Extrusion processed immediately
  });

  it('queues forward-ref entities and processes after resolution', async () => {
    const meshes: MeshData[] = [];
    const processor = new StreamingGeometryProcessor(api, m => meshes.push(m));

    // Simulate forward ref: extrusion defined before point
    await processor.processBatch([
      { id: 1, type: 'IFCEXTRUDEDAREASOLID', refs: [2] }
    ]);
    expect(meshes.length).toBe(0); // Queued, not processed

    await processor.processBatch([
      { id: 2, type: 'IFCCARTESIANPOINT', refs: [] }
    ]);
    expect(meshes.length).toBe(1); // Now processed
  });
});
```

### Performance Tests
```typescript
// tests/benchmark/streaming-benchmark.spec.ts

test('time-to-first-geometry < 100ms for 50MB file', async () => {
  const file = await loadTestFile('medium-building.ifc');

  let firstGeometryTime = 0;
  const processor = new StreamingGeometryProcessor(api, () => {
    if (firstGeometryTime === 0) {
      firstGeometryTime = performance.now() - startTime;
    }
  });

  const startTime = performance.now();
  for await (const batch of api.scanEntitiesStreaming(file, 100)) {
    await processor.processBatch(batch);
    if (firstGeometryTime > 0) break; // Got first geometry
  }

  expect(firstGeometryTime).toBeLessThan(100);
});
```

---

## Verification Metrics

### Performance Benchmarks
```bash
# Run with existing benchmark infrastructure
pnpm -r test -- --grep "streaming"

# Profile specific file
node tests/benchmark/profile-phases.mjs --file test-data/large-building.ifc

# Expected output:
# [STREAMING PROFILE]
#   First geometry: 45ms
#   50% geometry: 180ms
#   95% geometry: 380ms
#   100% complete: 1200ms (same as before)
#   Forward refs queued: 847 (3.2%)
#   Max queue depth: 23
```

### Compatibility Checks
- [ ] All existing tests pass
- [ ] Federation works with streaming
- [ ] Server path still works (unchanged)
- [ ] Cache path still works (unchanged)
- [ ] IFCX path still works (unchanged)

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `rust/core/src/decoder.rs` | Add `IncrementalEntityIndex`, `extract_refs_fast()` |
| `rust/core/src/lib.rs` | Export new types |
| `rust/wasm-bindings/src/api.rs` | Add `scanEntitiesStreaming()`, `processGeometryBatch()` |
| `packages/geometry/src/streaming-processor.ts` | **NEW** - Core streaming logic |
| `packages/geometry/src/federated-streaming-processor.ts` | **NEW** - Multi-model coordinator |
| `packages/geometry/src/ifc-lite-bridge.ts` | Add streaming API wrapper |
| `apps/viewer/src/hooks/useIfc.ts` | Use streaming processor |

---

## Alternative Considered: Skip Indexing Entirely

Could process geometry without pre-indexing by doing targeted seeks for each reference.

**Rejected because:**
- Each seek is O(n) worst case (linear scan for entity)
- 100 refs × 1M entities = catastrophic performance
- Current approach: O(n) once, then O(1) lookups
- Forward-reference queue gives best of both worlds

---

## Success Criteria

1. **First geometry in <100ms** for files up to 100MB
2. **95% geometry in <500ms** for files up to 100MB
3. **No regression** in total processing time
4. **Queue depth rarely exceeds 100** (validates reference pattern analysis)
5. **All existing tests pass** (backward compatible)

---

## Implementation Order

1. **Week 1:**
   - Rust: IncrementalEntityIndex + extract_refs_fast()
   - WASM: scanEntitiesStreaming API

2. **Week 2:**
   - TypeScript: StreamingGeometryProcessor
   - TypeScript: ForwardReferenceQueue
   - Integration: useIfc.ts streaming path

3. **Week 3:**
   - FederatedStreamingProcessor
   - Performance tuning (batch sizes, queue limits)
   - Comprehensive testing

4. **Week 4:**
   - Edge case handling
   - Documentation
   - Performance benchmarks

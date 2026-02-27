# IFC Viewer Load Time Analysis — 326 MB File

**Baseline:** `ThreeJS` example: **8.7 s** · Main WebGPU viewer: **~20 s** · Delta: **~11.3 s overhead**

---

## 1. Timeline Comparison

```
ThreeJS example (8.7 s total)
───────────────────────────────────────────────────────────────────
0ms      161ms          1463ms                    4945ms     8708ms
│ file   │ WASM init    │ 78 batches stream        │ parser    │ DONE
└────────┴──────────────┴──────────────────────────┴───────────┘

Main WebGPU viewer (~20 s total)
───────────────────────────────────────────────────────────────────
0ms  161ms  ~600ms            ~5s         ~11s           ~20s
│file │WASM  │ streaming       │ parser     │ BVH + cache  │ DONE
│     │+GPU  │ + React renders │ (parallel) │ write        │
│     │init  │ per batch       │ competing  │ (blocking)   │
└─────┴──────┴─────────────────┴────────────┴──────────────┘
```

---

## 2. Bottleneck #1 — `appendGeometryBatch`: O(n²) spread operator

**Estimated cost: ~2–4 s**

**Location:** `apps/viewer/src/store/slices/dataSlice.ts:77`

```typescript
// Called 78 times for a 39k-mesh model
const allMeshes = [...state.geometryResult.meshes, ...meshes]; // ← THE BOMB
const totalTriangles = allMeshes.reduce(...);  // ← recomputed every call
const totalVertices  = allMeshes.reduce(...);  // ← recomputed every call
```

Every batch appends to the store by spreading the **entire accumulated array** into a new one. On batch 78 that's spreading ~38 650 objects. Total allocations across 78 batches grow as `n(n+1)/2` — classic O(n²). For 39 146 meshes at ~200 bytes each, the last few calls each allocate **~7 MB of JS objects** just for the array, then two full `.reduce()` passes recalculate totals that could be incremented.

**Fix:** Use a mutable ref outside Zustand for the accumulation array during streaming; only commit the final result to the store. Or track `totalTriangles`/`totalVertices` as running counters, never recompute.

---

## 3. Bottleneck #2 — React re-renders × 78 batches

**Estimated cost: ~2–3 s**

`appendGeometryBatch` calls Zustand `set()` on every throttled batch. For a 326 MB file `getRenderIntervalMs` returns **200 ms** = ~5 renders/s, giving ≈78 batch calls over 4.9 s of streaming (matching the log). Each `set()` triggers reconciliation for **every component subscribed to `geometryResult`** — the entire renderer pipeline, hierarchy panel, properties panel, status bar, etc.

**Location:** `apps/viewer/src/utils/localParsingUtils.ts:179`

```typescript
// 326 MB → 200ms interval → ~24 throttled React re-renders during streaming
if (fileSizeMB > 100) return 200;
```

The Three.js example: **0 React re-renders during streaming.** Batches go directly into a local array, scene update is a single `scene.add()`.

**Fix:** Use a `ref` + a custom renderer subscription pattern. Push meshes directly to the renderer without touching Zustand state during streaming. Commit to the store **once** at `'complete'`.

---

## 4. Bottleneck #3 — Data store parser competing on main thread during streaming

**Estimated cost: ~1–2 s extra geometry time**

**Location:** `apps/viewer/src/hooks/useIfcLoader.ts:328`

```typescript
setTimeout(startDataModelParsing, 0); // fires immediately after first event loop tick
```

`ColumnarParser.parseLite()` (the JS tokenizer) runs on the **main thread** in parallel with geometry streaming. Both compete for CPU time. The Three.js example runs the parser **sequentially after** geometry completes — that's why geometry finishes at 4.9 s vs the viewer's ~5+ s despite using the same WASM.

The parser for a 326 MB file scans ~39k entity refs (`StepTokenizer.scanEntities()`) — an O(n) loop over the raw buffer. Running this concurrently steals cycles from the WASM ↔ JS bridge.

**Fix:** Start the parser only at the `'complete'` event, as the Three.js example does. Or move it to a Web Worker entirely.

---

## 5. Bottleneck #4 — IndexedDB cache write (the biggest single-shot cost)

**Estimated cost: ~3–5 s, off critical path but blocks GC**

**Location:** `apps/viewer/src/hooks/useIfcCache.ts:255–265`

```typescript
const cacheBuffer = await writer.write(cacheDataStore, geometry, sourceBuffer, {
  includeGeometry: true  // ← serializes all 39k meshes + all Float32Arrays
});
await setCached(cacheKey, cacheBuffer, ...sourceBuffer);  // ← writes raw IFC too
```

For a 326 MB IFC file:

- `includeGeometry: true` serializes all `positions`, `normals`, `indices` Float32Arrays for 39 146 meshes (~2 843k vertices × 3 floats × 4 bytes = **~34 MB** of positions alone, plus normals and indices: **~100 MB+** binary)
- Then it also stores the **326 MB raw IFC source buffer** in IndexedDB (`sourceBuffer`)
- Total IndexedDB write: likely **400–500 MB**, serialized synchronously on the main thread before `await`

The cache write uses `BinaryCacheWriter.write()` which is a blocking JS loop, then hands the result to IndexedDB. While async at the IDB layer, the serialization itself is synchronous and expensive. This fires after `'complete'` and competes with the post-load React reconciliation.

`CACHE_SIZE_THRESHOLD = 10 * 1024 * 1024` (10 MB) — so **every** file above 10 MB gets cached. For 326 MB this is very expensive.

**Fix options:**

1. Raise the threshold to e.g. 50 MB, or skip caching files > 200 MB
2. Serialize in a Web Worker
3. Do not store `sourceBuffer` in the cache for files above a threshold
4. Use `requestIdleCallback` with proper chunking

---

## 6. Bottleneck #5 — BVH spatial index build: O(n log n) on 39k meshes

**Estimated cost: ~0.5–1 s**

**Location:** `apps/viewer/src/hooks/useIfcLoader.ts:470`

```typescript
const spatialIndex = buildSpatialIndex(allMeshes); // AABB per mesh + BVH tree
```

`buildSpatialIndex` iterates all 39 146 meshes, computes an AABB for each by scanning its `positions` Float32Array (min/max of 2 843k floats), then constructs a BVH tree. Total float comparisons: **~8.5 million** for the AABB pass alone. This runs inside `dataStorePromise.then()` but is still synchronous on the main thread.

Currently deferred with `requestIdleCallback(..., { timeout: 2000 })` so it shouldn't block first render. But it runs during user interaction if idle time isn't available.

**Fix:** Move to a Web Worker. AABB computation is embarrassingly parallel.

---

## 7. Bottleneck #6 — WebGPU pipeline initialization

**Estimated cost: ~300–700 ms on cold start**

**Location:** `apps/viewer/src/components/viewer/Viewport.tsx:492`

```typescript
await renderer.init(); // WebGPU device + shader compilation
```

WebGPU requires explicit shader compilation via `device.createRenderPipeline()`. Unlike WebGL where GLSL compilation is hidden inside driver calls during first draw, WebGPU exposes this cost upfront. For the first load this is ~300–700 ms depending on GPU/driver. The ThreeJS example uses WebGL which compiles lazily and faster.

This is partially mitigated by pipeline caching in drivers but is a real first-load cost.

---

## 8. Bottleneck #7 — `applyColorUpdatesToMeshes` applied to full accumulated array

**Estimated cost: ~0.2–0.5 s per colorUpdate event**

**Location:** `apps/viewer/src/hooks/useIfcLoader.ts:387–388`

```typescript
applyColorUpdatesToMeshes(allMeshes,     event.updates); // maps over ALL seen meshes
applyColorUpdatesToMeshes(pendingMeshes, event.updates); // maps over pending batch
```

When a `colorUpdate` event arrives mid-stream, it maps over **all accumulated meshes so far** — not just the batch. If this fires when 30k meshes have already been accumulated, it's a `.forEach()` of 30k objects plus a `Map.get()` per mesh.

Plus a final pass at `'complete'`:

```typescript
applyColorUpdatesToMeshes(allMeshes, cumulativeColorUpdates); // all 39k meshes again
```

---

## 9. Bottleneck #8 — `updateMeshColors` in Zustand: full meshes array clone

**Location:** `apps/viewer/src/store/slices/dataSlice.ts:102`

```typescript
const updatedMeshes = state.geometryResult.meshes.map(mesh => {  // ← clones all 39k
  const newColor = clonedUpdates.get(mesh.expressId);
  if (newColor) return { ...mesh, color: newColor };  // ← spreads each changed mesh
  return mesh;
});
```

If called during streaming with a large accumulated array, this is O(n) over all meshes allocated into a new array, triggering another React reconciliation.

---

## 10. Minor contributors

| Item | Cost | Location |
|------|------|----------|
| `resetViewerState()` syncs ~50 props | ~30 ms | `store/index.ts:125` |
| `setProgress()` calls × 10+ during load | ~20 ms React | `useIfcLoader.ts` throughout |
| `detectFormat()` on 326 MB buffer | ~5 ms | `useIfcLoader.ts:112` |
| `processAdaptive` overhead vs `processStreaming` | negligible for 326 MB (uses streaming path) | `geometry/src/index.ts:472` |
| Zustand `updateCoordinateInfo` on each batch | ~5 ms | `useIfcLoader.ts:456` |

---

## 11. Full cost breakdown (estimated)

| # | Bottleneck | Est. cost | Blocking? | Fixable? |
|---|-----------|-----------|-----------|----------|
| 1 | `appendGeometryBatch` O(n²) spread | 2–4 s | Yes | High priority |
| 2 | React re-renders × batches | 2–3 s | Yes | High priority |
| 3 | Parser competing on main thread | 1–2 s | Yes | Easy win |
| 4 | IndexedDB cache write (400–500 MB) | 3–5 s | No (post-load) | Threshold/worker |
| 5 | BVH spatial index (39k meshes) | 0.5–1 s | No (idle) | Worker |
| 6 | WebGPU pipeline compilation | 0.3–0.7 s | Yes (startup) | Hard, driver |
| 7 | `applyColorUpdatesToMeshes` all meshes | 0.2–0.5 s | Yes | Medium |
| 8 | `updateMeshColors` full array clone | 0.1–0.3 s | Yes | Medium |
| 9 | Minor state updates | ~0.1 s | Yes | Low |

**Total recoverable on critical path: ~5–9 s** — enough to reach parity with the Three.js baseline.

---

## 12. Prioritized action plan

### P0 — Fix `appendGeometryBatch` (biggest single win)

Use a **local mutable array** for streaming accumulation; call `setGeometryResult(final)` once at `'complete'`. Eliminates the O(n²) spreads and all mid-stream React reconciliations at once.

### P0 — Defer parser to after `'complete'`

Change `setTimeout(startDataModelParsing, 0)` to fire only inside the `'complete'` branch. Zero code complexity, ~1–2 s free.

### P1 — Raise/skip cache for huge files

Set `CACHE_SIZE_THRESHOLD` to e.g. 100 MB, or skip storing `sourceBuffer` for files > 150 MB. The IFC source is already on disk — caching it in IDB for a 326 MB file costs more than it saves.

### P1 — Move BVH + parser to Web Workers

Both are CPU-bound, pure-JS, and have no DOM/renderer dependencies. Worker-ising them removes all remaining main-thread competition.

### P2 — Colour updates: lazy accumulation

Accumulate colour update maps during streaming; apply a single pass at `'complete'` rather than re-scanning all accumulated meshes on every `colorUpdate` event.

### P2 — Reduce `setProgress` frequency

Batch progress updates; a single `setProgress` per second during streaming instead of per batch saves ~10 React reconciliations for large files.

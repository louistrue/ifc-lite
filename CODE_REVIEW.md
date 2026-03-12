# IFC-Lite Code Review

**Date:** 2026-03-12
**Scope:** Full codebase (~434K lines across 622 files)
**Stack:** TypeScript monorepo (28 packages, 4 apps) + Rust/WASM (3 crates)

---

## Executive Summary

The codebase is well-architected at the macro level: modular packages, clean separation of Rust performance layer from TypeScript API, good build/release automation. However, several **god files**, **tightly coupled store slices**, **duplicated utilities**, and **type safety gaps** have accumulated. The issues below are ordered by impact.

---

## 1. God Files (Files > 500 lines, excluding generated)

These files have grown beyond single-responsibility and are the highest-priority refactor targets.

| File | Lines | Issue |
|------|-------|-------|
| `packages/parser/src/columnar-parser.ts` | 1,770 | Parsing + property/material/classification/georef extraction all in one file |
| `packages/create/src/ifc-creator.ts` | 2,455 | Every IFC entity creation method in a single class |
| `apps/viewer/src/components/viewer/PropertiesPanel.tsx` | 1,513 | UI + data fetching + editing logic |
| `apps/viewer/src/components/viewer/PropertyEditor.tsx` | 1,462 | Complex form state + validation + mutation |
| `apps/viewer/src/components/viewer/Drawing2DCanvas.tsx` | 1,411 | Canvas rendering + annotation tools + measurement |
| `apps/viewer/src/components/viewer/ChatPanel.tsx` | 1,402 | Chat UI + LLM integration + message handling |
| `apps/viewer/src/components/viewer/LensPanel.tsx` | 1,366 | Lens UI + rule management + color logic |
| `packages/renderer/src/scene.ts` | 1,285 | Batch management (8+ Maps), merge, color, streaming |
| `packages/renderer/src/index.ts` | 1,235 | Main renderer class |
| `packages/export/src/step-exporter.ts` | 1,064 | STEP serialization |
| `apps/viewer/src/components/viewer/useMouseControls.ts` | 1,050 | Mouse input handling |
| `packages/renderer/src/pipeline.ts` | 1,044 | Render pipeline + 400-line inline WGSL shader |
| `apps/viewer/src/components/viewer/MainToolbar.tsx` | 994 | Toolbar with all tool actions |
| `apps/viewer/src/lib/llm/script-preflight.ts` | 990 | LLM script validation |
| `apps/viewer/src/lib/llm/script-edit-ops.ts` | 954 | LLM script editing |
| `packages/renderer/src/snap-detector.ts` | 936 | Snap geometry with 228-line method |
| `server/chat/chat-handler.ts` | 923 | Chat API handler |
| `packages/server-client/src/client.ts` | 893 | API client |

### Recommended Refactors

**columnar-parser.ts (1,770 lines)** - Split into:
- `columnar-parser.ts` - Core parsing orchestration (~400 lines)
- `columnar-property-extractor.ts` - Property/quantity extraction
- `columnar-material-extractor.ts` - Material resolution
- `columnar-classification-extractor.ts` - Classification chain walking
- `columnar-georef-extractor.ts` - Georeference extraction

**scene.ts (1,285 lines)** - Split into:
- `scene.ts` - Core scene management
- `batch-manager.ts` - BatchedMesh management (8 Maps)
- `color-manager.ts` - Color overrides and material updates

**pipeline.ts (1,044 lines)** - Extract:
- `shaders/main.wgsl` - Shader source as separate file
- `pipeline.ts` - Pipeline configuration only

**Viewer components (PropertiesPanel, PropertyEditor, Drawing2DCanvas, ChatPanel, LensPanel)** - Each should be decomposed into smaller subcomponents. For example, PropertiesPanel could become:
- `PropertiesPanel.tsx` - Layout shell
- `PropertySetView.tsx` - Property set rendering
- `QuantitySetView.tsx` - Quantity rendering
- `PropertySearch.tsx` - Search/filter logic

---

## 2. Store Architecture (Zustand Slices)

The viewer store has **20 slices totaling 7,839 lines**, with **13 of 19 production slices exceeding 200 lines**.

### Critical Issues

#### A. Drawing2DSlice is a god slice (666 lines)
Manages 8 separate sub-domains in one slice:
- Drawing generation state
- Display options
- Graphic override presets/rules
- 2D measurements
- Polygon area tool
- Text annotations
- Cloud annotations
- Annotation selection

**Refactor:** Split into `drawing2DSlice`, `annotation2DSlice`, `graphicOverrideSlice`.

#### B. Pinboard/Visibility tight coupling
`pinboardSlice.ts` directly writes to visibility state (`isolatedEntities`, `hiddenEntities`) owned by `visibilitySlice.ts`. Both slices claim ownership of the same state.

```typescript
// pinboardSlice.ts lines 221-232 — writes visibility state
set((state) => {
  const isolatedEntities = basketToGlobalIds(next, state.models);
  const hiddenEntities = new Set<number>(state.hiddenEntities);
  return { pinboardEntities: next, isolatedEntities, hiddenEntities };
});
```

**Fix:** Establish single owner for isolation/visibility state. Pinboard should dispatch actions to visibility slice, not write its state directly.

#### C. Pinboard/Selection coupling
`pinboardSlice.ts` calls `get().clearEntitySelection()` in 5 places, creating a hard dependency on selection slice internals.

#### D. Dual selection APIs (legacy burden)
`selectionSlice.ts` maintains both single-model (`setSelectedEntityId`) and multi-model (`setSelectedEntity`) APIs simultaneously. 15 methods total, creating sync risks.

**Fix:** Deprecate legacy single-model API; provide thin adapter if needed.

#### E. Centralized reset is fragile
`store/index.ts` has `resetViewerState()` manually resetting 40+ properties. Each slice should own its own `reset()`.

#### F. Derived state stored as state
- `getActiveOverrideRules()` computes from `activePresetId` + `customOverrideRules` — should be a memoized selector
- `basketToGlobalIds()` in pinboard — always derivable from pinboard entities + model offsets

### Slice Size Summary

| Slice | Lines | Status |
|-------|-------|--------|
| drawing2DSlice.ts | 666 | Split into 3 |
| mutationSlice.ts | 656 | Repetitive set patterns |
| sheetSlice.ts | 565 | Split into sub-slices |
| pinboardSlice.ts | 473 | Cross-slice coupling |
| chatSlice.ts | 468 | 14 localStorage ops |
| scriptSlice.ts | 465 | Complex editor state |
| bcfSlice.ts | 372 | Repetitive update patterns |
| idsSlice.ts | 310 | Derived state stored |
| visibilitySlice.ts | 303 | Legacy/multi-model duplication |
| measurementSlice.ts | 293 | Screen coord complexity |
| selectionSlice.ts | 263 | Dual API burden |
| lensSlice.ts | 226 | Acceptable |
| modelSlice.ts | 211 | Singleton coupling |

---

## 3. Parser Package Issues

### A. Duplicated helper functions across extractors

The same utility functions are copy-pasted across 3 files:

| Function | Locations |
|----------|-----------|
| `getString()` | material-extractor.ts:348, georef-extractor.ts:266, classification-extractor.ts:290 |
| `getReference()` | material-extractor.ts:372, georef-extractor.ts:282, classification-extractor.ts:296 |
| `getNumber()` | material-extractor.ts:354, georef-extractor.ts:272 |
| `getReferences()` | material-extractor.ts:381, classification-extractor.ts:305 |

**Fix:** Extract to shared `packages/parser/src/attribute-helpers.ts`.

### B. Functions exceeding 100 lines

| Function | File:Line | Lines | Issue |
|----------|-----------|-------|-------|
| `parseLite()` | columnar-parser.ts:200 | ~350 | Orchestrates entire parse pipeline |
| `resolveMaterial()` | columnar-parser.ts:1036 | ~135 | 5-case switch, 6-level nesting |
| `parsePropertyValue()` | columnar-parser.ts:1254 | ~105 | 43-line default case |
| `extractMaterials()` | material-extractor.ts:103 | ~92 | 7x copy-paste extraction loop |

### C. Deep nesting (6+ levels)

`columnar-parser.ts:1079-1087` and `1121-1129` both have 6-level nesting for material name resolution through entity attributes. Pattern: `switch > case > for > if > if > if`.

**Fix:** Extract material resolution into a helper: `resolveNestedMaterialName(entity, entities)`.

### D. Repetitive extraction pattern

`material-extractor.ts:119-179` repeats the same 6-line pattern 7 times:
```typescript
const ids = entitiesByType.get('IfcMaterialXxx') || [];
for (const id of ids) {
  const entity = entities.get(id);
  if (entity) { data.xxx.set(id, extractXxx(entity)); }
}
```

**Fix:** Generic `extractAll(type, extractor, targetMap)` function.

---

## 4. Type Safety

### Metrics
- **68 `as any` occurrences** across 20 files
- **52 `: any` annotations** across 21 files
- Total: **120 `any` usages** (excluding test files and generated code)

### Worst offenders (non-test files)

| File | Count | Issue |
|------|-------|-------|
| query/duckdb-integration.ts | 9 | DuckDB interop |
| server-client/parquet-decoder.ts | 8 | Parquet WASM interop |
| sandbox/bridge-schema.ts | 6 | QuickJS bridge |
| parser/style-extractor.ts | 6 | Color/material params all `any` |
| parser/index.ts | 6 | WASM API typed as `any` |
| parser/entity-extractor.ts | 4 | Attribute parsing |
| parser/relationship-extractor.ts | 3 | relatingObject/relatedObjects |

### Notable type safety gaps

**style-extractor.ts** — 4 methods accept `any` parameters:
```typescript
private extractColorRgb(colorRef: any): [number, number, number]
private extractTransparency(transparencyRef: any): number
private extractSpecularHighlight(highlightRef: any): number | undefined
private extractReflectanceMethod(methodRef: any): '...' | undefined
```

**parser/index.ts:90** — WASM API untyped:
```typescript
wasmApi?: any; // Optional IfcAPI instance
```

**Fix:** Define proper interfaces for WASM API and attribute values. Use `unknown` + type guards instead of `any`.

---

## 5. Renderer Issues

### A. Missing resource cleanup
The `Renderer` class has no `destroy()` / `dispose()` method. GPU buffers, textures, and pipeline objects are never explicitly freed. The `partialBatchCache` in scene.ts stores BatchedMesh objects with GPU buffers and has no invalidation path on model unload.

### B. Inline shader (pipeline.ts)
400+ lines of WGSL shader code embedded as a string literal inside the constructor. Should be extracted to a `.wgsl` file for:
- Separate syntax highlighting/linting
- Hot reload during development
- Better maintainability

### C. O(n) lookup in hot path
`scene.ts:517` uses `.indexOf()` inside a loop despite having a reverse lookup Map (`meshDataBatchKey`):
```typescript
const idx = oldBatchData.indexOf(meshData); // O(N) search
```

### D. Snap detector cache
`snap-detector.ts` `geometryCache` Map (line 96) accumulates entries without explicit invalidation. Only `clearCache()` exists but is not called on model changes.

### E. Non-null assertions without guards
`snap-detector.ts` lines 696, 720, 721, 748, 749 use `!.` on Map.get() results:
```typescript
edgeData.get(key)!.normals.push(triNormal);
vertexEdges.get(v0Key)!.push(edgeIndex);
```

---

## 6. SDK Issues

### A. API surface redundancy
`BimContext` exposes query methods both directly (`.properties()`, `.quantities()`, `.materials()`) AND through the query namespace (`.query().properties()`). Users don't know which to use.

**Fix:** Pick one pattern. Recommend keeping namespace-only access and removing direct BimContext methods.

### B. Async proxy bloat
`drawing.ts` (51 methods), `bcf.ts` (56 methods), `ids.ts` (37 methods) are thin async wrappers that each do:
```typescript
const mod = await loadModule();
return (mod.someFunction as AnyFn)(args);
```

Heavy use of `as unknown[]` and `as AnyFn` defeats type safety. Consider exposing the loaded module directly instead of proxying every method.

---

## 7. Cross-Cutting Concerns

### A. console.log pollution
**560 console.log statements** across the codebase (excluding tests). Many appear to be debug leftovers rather than intentional logging. Should standardize on the existing `logger.ts` utility.

### B. TODO/FIXME count
Only **4 TODO/FIXME comments** found — this is good. The codebase doesn't have a backlog of known issues hiding in comments.

### C. Inconsistent error logging
- Some modules use `console.warn`
- Some use `log.error` (from logger utility)
- Some use `log.warn` with context objects
- No consistent pattern across packages

**Fix:** Standardize on the logger utility from `@ifc-lite/data` across all packages.

---

## 8. Refactor Priority Matrix

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| **P0** | Split `columnar-parser.ts` (1,770 lines) | High — core parsing reliability | Medium |
| **P0** | Fix pinboard/visibility state ownership | High — subtle bugs from dual ownership | Low |
| **P1** | Split `drawing2DSlice` into 3 slices | Medium — maintainability | Medium |
| **P1** | Extract shared parser helpers | Medium — DRY violation across 3 files | Low |
| **P1** | Add `Renderer.destroy()` for GPU cleanup | Medium — memory leaks | Low |
| **P1** | Remove legacy single-model selection API | Medium — reduces API surface 50% | Medium |
| **P2** | Extract WGSL shader from pipeline.ts | Low — developer experience | Low |
| **P2** | Replace `any` with proper types in parser | Medium — type safety | Medium |
| **P2** | Split large viewer components | Medium — maintainability | High |
| **P2** | Standardize logging across packages | Low — consistency | Low |
| **P3** | Simplify SDK namespace proxy pattern | Low — API cleanliness | Medium |
| **P3** | Fix O(n) lookup in scene.ts | Low — perf in hot path | Low |
| **P3** | Add cache invalidation to snap-detector | Low — memory over time | Low |
| **P3** | Consolidate resetViewerState | Low — fragility | Medium |

---

## 9. What's Done Well

- **Modular package architecture** — 28 focused packages with clear boundaries
- **Rust/WASM performance layer** — Smart use of Rust for parsing and geometry
- **Zero-copy GPU uploads** — Eliminates JS heap pressure for large models
- **Streaming geometry pipeline** — Adaptive batching for fast first frame
- **Comprehensive IFC schema coverage** — 876 entities via code generation
- **Good release automation** — Changesets + multi-registry publishing
- **License compliance** — MPL-2.0 headers on all files
- **Clean TODO count** — Only 4 across entire codebase
- **Strong documentation** — 35 docs covering architecture, guides, API, tutorials

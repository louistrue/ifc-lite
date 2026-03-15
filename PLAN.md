# Fork Integration Plan — Steps 1–3 + 6–8 + PR #400 (ionuting)

## Analysis Summary

### PR #399 (madsik)
- **PR state:** Open, but **dirty/unmergeable** — the PR goes from `madsik/ifc-lite:main` → `louistrue/ifc-lite:madsik`, and the histories diverged significantly (983 additions, 6.6M deletions across 89 files — the deletions are from the fork being behind main)
- **madsik branch on origin:** Already at same commit as main (de2e949) — the actual LOD work lives on the `pr-399` local branch (fetched from the PR)
- **Merge conflict approach:** Cherry-picking isn't viable since the fork history has no merge base with main. Instead, **copy the 5 LOD files verbatim** from the pr-399 branch — they're all new files with no conflicts against main
- **What we want:** Only LOD files (5 new files in `packages/export/src/`)
- **What we exclude:** package.json workspace:^ changes, wasm/pkg binaries, .claude settings

### Sonderwoods Branch
- **Branch:** `origin/sonderwoods` — single commit `8aedaf0` ("prep merge (#398)")
- **Change scope:** +2,304 / -568 lines across 24 files
- **All APIs the processing crate needs already exist in main:** `AttributeValue`, `scan_placement_bounds`, `with_scale_and_rtc`, `process_element_with_submeshes`, `detect_rtc_offset_from_jobs`, `set_rtc_offset`, `rtc_offset`
- **Only missing API:** `resolve_scaled_placement` on `GeometryRouter` (added by sonderwoods, 15 lines)

---

## Implementation Steps

### Step 1 — Extract `rust/processing` Crate (from Sonderwoods)

**Files to create:**
1. `rust/processing/Cargo.toml` — verbatim from sonderwoods
2. `rust/processing/src/lib.rs` — verbatim from sonderwoods
3. `rust/processing/src/types/mod.rs` — verbatim from sonderwoods
4. `rust/processing/src/types/mesh.rs` — verbatim from sonderwoods (enhanced MeshData with global_id, name, presentation_layer, material_name, geometry_item_id, properties)
5. `rust/processing/src/types/response.rs` — verbatim from sonderwoods (ParseResponse gains mesh_coordinate_space, site_transform, building_transform)
6. `rust/processing/src/processor.rs` — verbatim from sonderwoods (1,314 lines — full processor with OpeningFilterMode, site-local transforms, property extraction, opening submeshes)

**Files to modify:**
7. `Cargo.toml` (workspace root) — add `rust/processing` and `rust/ffi` to members
8. `apps/server/Cargo.toml` — add `ifc-lite-processing` dependency
9. `apps/server/src/services/processor.rs` — replace 426 lines with re-exports from processing crate
10. `apps/server/src/services/mod.rs` — add `process_geometry_filtered` and `OpeningFilterMode` to re-exports
11. `apps/server/src/types/mesh.rs` — replace struct with `pub use ifc_lite_processing::MeshData`
12. `apps/server/src/types/response.rs` — replace shared types with re-exports, keep server-only types

**Validation:** `cargo build --workspace` must compile. Existing tests must pass.

### Step 2 — Server: Opening Filter + Transform Fields (from Sonderwoods)

**Files to modify:**
1. `apps/server/src/routes/parse.rs` — add ParseQuery struct, inject Query<ParseQuery> into all 5 parse handlers, scope cache keys by opening_filter, use process_geometry_filtered, populate new response fields
2. `apps/server/src/config.rs` — add `host: [u8; 4]` field with HOST env var (default 127.0.0.1)
3. `apps/server/src/main.rs` — use `config.host` instead of `[0,0,0,0]`
4. `apps/server/src/services/streaming.rs` — add rtc_offset to PreparedData, detect RTC offset from jobs with scan_placement_bounds fallback, pass to process_batch, populate CoordinateInfo

**These are exact diffs from sonderwoods — apply verbatim.**

### Step 3 — Rust Geometry: resolve_scaled_placement + Extrusion Cleanup (from Sonderwoods)

**Files to modify:**
1. `rust/geometry/src/router/mod.rs` — add `resolve_scaled_placement()` method (15 lines)
2. `rust/geometry/src/extrusion.rs` — remove 15-line debug block (#region agent log H3/H4)

**Validation:** `cargo test -p ifc-lite-geometry`

### Step 6 — LOD Geometry Types + Utilities (from madsik)

**Files to create (copy from pr-399 branch):**
1. `packages/export/src/lod-geometry-types.ts` — Vec3, Lod0Element, Lod0Json, Lod1MetaJson, GenerateLod1Result types
2. `packages/export/src/lod-geometry-utils.ts` — vec3 math, mat4 operations, AABB, normalizeIfcTypeName

**No conflicts — these are brand new files.**

### Step 7 — LOD0 Generator (from madsik)

**Files to create:**
1. `packages/export/src/lod0-generator.ts` — 324-line parser-only fast AABB/transform extraction using StepTokenizer + EntityExtractor from @ifc-lite/parser

**Dependencies verified:** StepTokenizer.scanEntitiesFast(), EntityExtractor, extractLengthUnitScale, getAllAttributesForEntity, EntityRef — all exist in current main's @ifc-lite/parser

### Step 8 — LOD1 Generator + GLB Parser (from madsik)

**Files to create:**
1. `packages/export/src/glb.ts` — 132-line minimal GLB parser (parseGLB, extractGlbMapping, parseGLBToMeshData)
2. `packages/export/src/lod1-generator.ts` — 171-line full-mesh GLB generator with graceful box fallback from LOD0

**Dependencies:** Uses GeometryProcessor from @ifc-lite/geometry, GLTFExporter from same package

**File to modify:**
3. `packages/export/src/index.ts` — add exports for LOD types, LOD0 generator, LOD1 generator, GLB parser

---

## Dependency Graph

```
Step 1 (processing crate) ← must be first
  └─ Step 2 (server updates) ← depends on processing crate existing
  └─ Step 3 (geometry changes) ← used by processing crate

Steps 6-7-8 (LOD) ← fully independent of Steps 1-3, can be done in any order relative to them
  Step 6 (types+utils) → Step 7 (LOD0) → Step 8 (LOD1+GLB)
```

## What We Skip (Steps 4, 5, 9)

- **Step 4 (FFI crate):** `rust/ffi/` — We add it to workspace members in Step 1 but don't create the crate yet. Need to conditionally add it only when Step 4 is implemented.
- **Step 5 (Rhino integration):** scripts/IFCliteCommand.cs, run-ifc-server.ps1, MATHIAS.txt — deferred
- **Step 9 (ara3d test models):** tests/models/ara3d/ — deferred, need license verification

## Risk Assessment

- **Biggest risk:** The processing crate's 1,314-line processor.rs uses APIs that exist in main but may have slightly different signatures. Need to verify compilation.
- **FFI workspace member:** Adding `rust/ffi` to workspace members without creating the crate will fail `cargo build --workspace`. **Must either create a stub or omit it from members until Step 4.**
- **MeshData breaking change:** The processing crate's MeshData has new fields (global_id, name, etc.) that are `Option<String>` with `skip_serializing_if`. This is additive and won't break existing JSON consumers. However, any code doing struct literal construction of MeshData will need updating — but MeshData::new() returns the old shape, so existing callers are fine.

---

## PR #400 (ionuting) — Drawing Geometry Integration

### Analysis Summary

- **PR state:** Open, very large (200+ commits of divergence from main)
- **Fork point:** Has a merge base with main — `git merge-base origin/main pr-400` succeeds
- **Key finding: ZERO file divergence on main** for all target files since the fork point:
  - `rust/geometry/src/router/voids.rs` — unchanged on main
  - `packages/drawing-2d/src/*` — unchanged on main
  - `rust/geometry/src/lib.rs` — unchanged on main
  - `rust/wasm-bindings/src/api/mod.rs` — unchanged on main
  - `packages/geometry/src/index.ts`, `ifc-lite-bridge.ts` — unchanged on main
- **No conflicts with sonderwoods** — sonderwoods touches none of these files
- **Cherry-picks should apply cleanly** — the base state matches main for all target files

### 4 extractable commits (in sequence)

| Commit | Description | Extractable files | Noise to strip |
|--------|-------------|-------------------|----------------|
| `2744432` | Void reveal faces | `voids.rs` only | 20 other files (viewer, packages/create, START.md) |
| `806860a` | CSG-only void path + tests | `voids.rs` + `tests.rs` | 14 other files (viewer, wasm binary) |
| `95f4dbd` | Profile extractor (THE BIG ONE) | 10 files (Rust + WASM + TS) | 5 files (viewer hooks, wasm binaries) |
| `6121ddd` | Object Styles system | 4 drawing-2d files | 30 files (viewer UI, pnpm-lock) |

### Step 10 — Void Processing Simplification (ionuting)

**Source commits:** `2744432` + `806860a`

**Cherry-pick approach:**
```
git cherry-pick 2744432 --no-commit
git checkout HEAD -- apps/ packages/ START.md pnpm-lock.yaml
git add rust/geometry/src/router/voids.rs
git commit (with co-author attribution)

git cherry-pick 806860a --no-commit
git checkout HEAD -- apps/ packages/wasm/
git add rust/geometry/src/router/voids.rs rust/geometry/src/router/tests.rs
git commit (with co-author attribution)
```

**What changes:**
- `voids.rs` (1065 lines): Replaces dual AABB/CSG branching with unified CSG approach. AABB retained only as fallback for degenerate CSG results. Adds `generate_opening_reveal_faces()`.
- `tests.rs`: Signature fix — adds `None` argument to `cut_rectangular_opening()` call.

**Risk:** Low. `806860a` partially reverts reveal-face code from `2744432`, but since we apply them sequentially the final state is clean.

### Step 11 — Profile Extractor (ionuting) — Most Important

**Source commit:** `95f4dbd`

**Cherry-pick approach:**
```
git cherry-pick 95f4dbd --no-commit
git checkout HEAD -- apps/viewer/src/hooks/useDrawingGeneration.ts
git checkout HEAD -- packages/wasm/pkg/ifc-lite_bg.wasm packages/wasm/pkg/ifc-lite.js
git commit (with co-author attribution)
```

**New files (keep all):**
1. `rust/geometry/src/profile_extractor.rs` — 516-line Rust profile extractor for IfcExtrudedAreaSolid
2. `rust/wasm-bindings/src/api/extract_profiles.rs` — 172-line WASM binding
3. `packages/drawing-2d/src/profile-projector.ts` — 200-line TS projection

**Modified files (keep all):**
4. `rust/geometry/src/lib.rs` — adds `pub mod profile_extractor` (+2 lines)
5. `rust/wasm-bindings/src/api/mod.rs` — adds `mod extract_profiles` (+1 line)
6. `packages/drawing-2d/src/types.ts` — adds `ProfileEntry` interface (+36 lines)
7. `packages/drawing-2d/src/drawing-generator.ts` — adds `profiles?` parameter, profile-based projection path
8. `packages/drawing-2d/src/index.ts` — adds ProfileEntry export
9. `packages/geometry/src/ifc-lite-bridge.ts` — adds `extractProfiles()` bridge
10. `packages/geometry/src/index.ts` — re-exports

**Files to strip:** viewer hooks, wasm pkg binaries (CI rebuilds)

**Note:** `packages/wasm/pkg/ifc-lite.d.ts` and `ifc-lite_bg.wasm.d.ts` — these are TypeScript declarations for the new WASM export. Keep if present, as they're source-like (describe the API shape). CI can regenerate but having them checked in provides type safety.

### Step 12 — Object Styles + SVG Enhancements (ionuting)

**Source commit:** `6121ddd`

**Cherry-pick approach:**
```
git cherry-pick 6121ddd --no-commit
git checkout HEAD -- apps/ pnpm-lock.yaml
# Keep only packages/drawing-2d/ changes
git commit (with co-author attribution)
```

**Files to keep (4 in packages/drawing-2d/src/):**
1. `object-styles.ts` — NEW 406-line Revit-style per-category graphic config
2. `drawing-generator.ts` — updated to filter by visibility from object styles
3. `svg-exporter.ts` — updated with per-category styling (+158 lines)
4. `index.ts` — exports ObjectStyle, resolveObjectStyle, etc.

**Conflict risk with Step 11:** `drawing-generator.ts` and `index.ts` are modified by both `95f4dbd` (Step 11) and `6121ddd` (Step 12). Must apply Step 11 first, then Step 12. The changes are in different sections of the file so conflicts should be minimal or auto-resolvable.

### Dependency Graph (Updated)

```
Step 1 (processing crate) ← must be first
  └─ Step 2 (server updates)
  └─ Step 3 (geometry: resolve_scaled_placement + extrusion cleanup)

Steps 6-7-8 (LOD) ← independent of all others
  Step 6 (types+utils) → Step 7 (LOD0) → Step 8 (LOD1+GLB)

Steps 10-11-12 (ionuting) ← independent of Steps 1-3 and 6-8
  Step 10 (voids refactor) ← should come before Step 11 (same crate)
    └─ Step 11 (profile extractor) ← must come before Step 12
      └─ Step 12 (object styles)
```

All three groups (Sonderwoods 1-3, madsik 6-8, ionuting 10-12) are **fully independent** and can be done in any order or parallel.

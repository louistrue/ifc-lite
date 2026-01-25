# Geometry Processing Fix Plan

## Summary

Commit `fbc91ed` introduced valuable performance optimizations and new geometry processors, but it also introduced a **critical bug** in the tuple destructuring that broke FacetedBrep rendering (walls, slabs not filling correctly, voids not cut).

## Root Cause

In `rust/core/src/decoder.rs`, the function `get_face_bound_fast` returns:
```rust
Some((loop_id, orientation, is_outer))
```

But in `rust/geometry/src/processors.rs`, the code destructures it incorrectly as:
```rust
let (loop_id, is_outer, orientation) = decoder.get_face_bound_fast(bound_id)?;
```

This swaps `is_outer` and `orientation`, causing:
- Inner bounds (holes) to be treated as outer bounds
- Orientation to be inverted incorrectly

## What We're Losing by Reverting

### 1. New Decoder Functions (decoder.rs) - SAFE
- `get_first_entity_ref_fast()` - Fast extraction of first entity ref from raw bytes
- `get_polyloop_coords_fast()` - Ultra-fast polyloop coordinate extraction
- `get_polyloop_coords_cached()` - Cached version with point_cache
- `parse_cartesian_point_inline()` - Inline coordinate parsing helper
- `parse_float_inline()` - Batch float parsing helper
- `point_cache` field in EntityDecoder struct

### 2. Parser Enhancements (parser.rs) - SAFE
- `has_non_null_attribute()` - Fast null attribute check for filtering entities

### 3. Schema Additions (schema_gen.rs) - SAFE
- `IfcFaceBasedSurfaceModel` -> Surface category
- `IfcSurfaceOfLinearExtrusion` -> Surface category

### 4. New Geometry Processors (processors.rs) - SAFE
- `FaceBasedSurfaceModelProcessor` - Handles IfcFaceBasedSurfaceModel
- `SurfaceOfLinearExtrusionProcessor` - Handles IfcSurfaceOfLinearExtrusion

### 5. Performance Optimizations (processors.rs) - BUGGY
- `extract_loop_points_fast()` now uses `get_polyloop_coords_cached()` instead of `get_polyloop_point_ids_fast()` + individual point fetches
- FacetedBrep now uses `get_first_entity_ref_fast()` instead of full decode for shell ID
- FacetedBrep now uses `get_face_bound_fast()` instead of full decode (**THIS IS WHERE THE BUG IS**)
- WASM-specific sequential iteration (`#[cfg(target_arch = "wasm32")]`)

### 6. AdvancedBrep Improvements (processors.rs) - SAFE
- Better handling of OrientedEdge with null EdgeStart/EdgeEnd
- Fallback to EdgeElement when vertices are null
- New `process_cylindrical_face()` method for cylindrical surfaces

### 7. RevolvedAreaSolid Tweak (processors.rs) - SAFE
- Changed segment count from 24 to 12 for matching web-ifc

### 8. Lib.rs Exports - SAFE
- Export `FaceBasedSurfaceModelProcessor`
- Export `SurfaceOfLinearExtrusionProcessor`

## Fix Strategy

### Option A: Fix the Tuple Order (RECOMMENDED)
The simplest fix is to correct the destructuring in `processors.rs` to match the function's return order:

```rust
// CORRECT - matches get_face_bound_fast return order
let (loop_id, orientation, is_outer) = decoder.get_face_bound_fast(bound_id)?;
```

There are **3 locations** in processors.rs where this needs to be fixed:
1. `process_batch()` method (~line 975)
2. `process()` method of FacetedBrepProcessor (~line 1120)
3. `FaceBasedSurfaceModelProcessor::process()` (~line 858)

### Option B: Fix the Function Return Order
Alternatively, change `get_face_bound_fast()` to return `(loop_id, is_outer, orientation)` to match expectations.

### Recommendation

**Use Option A** - Fix the destructuring to match the function. The function's return order (`loop_id, orientation, is_outer`) is more intuitive because:
1. `orientation` comes second in IFC spec (IfcFaceBound has `Bound` then `Orientation`)
2. `is_outer` is derived from the type name, not from attributes

## Implementation Steps

1. Start from working commit `16666ec`
2. Cherry-pick or manually apply the SAFE changes from `fbc91ed`:
   - Decoder enhancements (all new functions)
   - Parser enhancements
   - Schema additions
   - New processors (FaceBasedSurfaceModel, SurfaceOfLinearExtrusion)
   - AdvancedBrep improvements
   - RevolvedAreaSolid tweak
   - WASM-specific iteration guards
3. Apply FacetedBrep fast-path optimizations WITH CORRECT tuple order
4. Apply FaceBasedSurfaceModelProcessor WITH CORRECT tuple order
5. Test thoroughly before committing

## Files to Modify

1. `rust/core/src/decoder.rs` - Add all new functions
2. `rust/core/src/parser.rs` - Add `has_non_null_attribute()`
3. `rust/core/src/schema_gen.rs` - Add surface types
4. `rust/geometry/src/lib.rs` - Add exports
5. `rust/geometry/src/processors.rs` - Add new processors + optimizations (with fix)

## Testing

After implementation:
1. Load the test IFC file that showed broken geometry
2. Verify walls and slabs render as solid filled shapes
3. Verify voids are properly cut out
4. Run benchmark to confirm performance gains are preserved

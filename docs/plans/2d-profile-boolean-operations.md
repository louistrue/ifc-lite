# 2D Profile-Level Boolean Operations

Implementation plan for smarter void handling by performing boolean operations at the 2D profile level before extrusion.

## Problem Statement

### Current Approach
The current implementation performs CSG boolean operations on **finished 3D geometry** after extrusion:

```
Profile → Extrude → 3D Mesh → CSG Subtract (for each void) → Result
```

**Issues:**
1. **Performance**: 3D CSG is expensive (~20 ops/sec vs ~2000 extrusions/sec)
2. **Reliability**: Complex 3D boolean operations fail on certain geometries (especially floors with multiple voids)
3. **Accuracy**: 3D CSG can produce degenerate triangles, NaN values, and visual artifacts

### Evidence from Testing
From `rust/geometry/tests/csg_void_test.rs`:
- Element #276 (slab with openings) fails CSG validation
- 3D CSG produces volume ratios outside acceptable range
- Degenerate triangles appear in results

## Research: Web-IFC Approach

Web-IFC (ThatOpen/engine_web-ifc) uses a **hybrid approach**:

### 1. Profile-Level Void Handling
For voids **coplanar** to the extrusion profile plane:
- Project void geometry to 2D profile plane
- Subtract void footprint from profile as a hole
- Extrude the profile-with-holes once

### 2. 3D CSG Fallback
For voids **not coplanar** (at angle to extrusion direction):
- Fall back to full 3D boolean operations
- Use BVH acceleration for ray-casting
- Apply "fuzzy-bools" engine for mesh subtraction

### 3. Void Fusion Optimization
When void count > 10:
```cpp
// From IfcGeometryProcessor.cpp
if (voidCount > 10) {
    fused_void = Union(void1, void2, ..., void_n)
    result = Subtract(main_geometry, fused_void)
}
```

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Void Processing                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Host Element (IfcWall, IfcSlab, etc.)                                      │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────┐                                                        │
│  │ Extract Profile │────────────────────────────────────────────────┐       │
│  │ & Extrusion Dir │                                                │       │
│  └────────┬────────┘                                                │       │
│           │                                                          │       │
│           ▼                                                          │       │
│  ┌─────────────────────────────────────────────────────────────┐    │       │
│  │                   For Each Void                              │    │       │
│  │  ┌─────────────────┐    ┌─────────────────────────────────┐ │    │       │
│  │  │ Is Void Planar  │───►│  YES: Project to 2D              │ │    │       │
│  │  │ to Profile?     │    │       Add as profile hole        │ │    │       │
│  │  └────────┬────────┘    └─────────────────────────────────┘ │    │       │
│  │           │                                                  │    │       │
│  │           │ NO                                               │    │       │
│  │           ▼                                                  │    │       │
│  │  ┌─────────────────────────────────────────────────────────┐ │    │       │
│  │  │ Queue for 3D CSG Post-Processing                        │ │    │       │
│  │  └─────────────────────────────────────────────────────────┘ │    │       │
│  └─────────────────────────────────────────────────────────────┘    │       │
│           │                                                          │       │
│           ▼                                                          │       │
│  ┌─────────────────┐                                                │       │
│  │ Extrude Profile │◄───────────────────────────────────────────────┘       │
│  │ (with 2D holes) │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 3D CSG for Non-Planar Voids (if any)                                │   │
│  │ - Batch voids if count > threshold                                   │   │
│  │ - Use existing csgrs subtract_mesh                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                                                                  │
│           ▼                                                                  │
│      Final Mesh                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Decisions

1. **2D Boolean Library**: Use `i_overlay` crate
   - Handles self-intersecting polygons
   - Both integer and float APIs
   - Pure Rust, actively maintained (177K+ monthly downloads)
   - MIT licensed (compatible with MPL-2.0)

2. **Planarity Detection**: Use dot product test
   - Void is coplanar if: `|void_normal · extrusion_direction| > 1 - ε`
   - Use adaptive epsilon (start at 0.01, refine if needed)

3. **Depth Tracking**: For partial-depth voids
   - Store void depth range (start_z, end_z) in extrusion coordinate space
   - Generate internal walls where void doesn't extend full depth

## Implementation Plan

### Phase 1: Core Data Structures

#### 1.1 Enhanced Profile2D

**File**: `rust/geometry/src/profile.rs`

```rust
/// Void metadata for depth tracking
#[derive(Debug, Clone)]
pub struct VoidInfo {
    /// Hole contour (clockwise winding)
    pub contour: Vec<Point2<f64>>,
    /// Start depth in extrusion space (0.0 = bottom cap)
    pub depth_start: f64,
    /// End depth in extrusion space (depth = top cap)
    pub depth_end: f64,
    /// Whether void extends full depth
    pub is_through: bool,
}

/// Enhanced Profile2D with void tracking
#[derive(Debug, Clone)]
pub struct Profile2DWithVoids {
    /// Base profile (outer boundary + existing holes)
    pub profile: Profile2D,
    /// Void metadata for depth-aware extrusion
    pub voids: Vec<VoidInfo>,
}
```

#### 1.2 2D Boolean Operations Module

**File**: `rust/geometry/src/bool2d.rs` (new)

```rust
use i_overlay::prelude::*;

/// Result of 2D boolean operation
pub struct Boolean2DResult {
    /// Resulting profile with holes
    pub profile: Profile2D,
    /// Voids that couldn't be processed in 2D
    pub non_planar_voids: Vec<VoidGeometry>,
}

/// Perform 2D boolean difference
pub fn subtract_2d(
    profile: &Profile2D,
    void_contour: &[Point2<f64>],
) -> Result<Profile2D>;

/// Check if a void is coplanar to the profile plane
pub fn is_void_coplanar(
    void_mesh: &Mesh,
    profile_plane_normal: &Vector3<f64>,
    epsilon: f64,
) -> bool;

/// Project 3D void to 2D profile plane
pub fn project_void_to_profile(
    void_mesh: &Mesh,
    profile_transform: &Matrix4<f64>,
) -> Option<(Vec<Point2<f64>>, f64, f64)>; // (contour, depth_start, depth_end)
```

### Phase 2: Void Analysis

#### 2.1 Void Geometry Analyzer

**File**: `rust/geometry/src/void_analysis.rs` (new)

```rust
/// Analyzes void geometry to determine optimal processing strategy
pub struct VoidAnalyzer {
    epsilon: f64,
}

/// Classification of void relative to host extrusion
#[derive(Debug, Clone)]
pub enum VoidClassification {
    /// Void is coplanar and can be subtracted in 2D
    Coplanar {
        profile_hole: Vec<Point2<f64>>,
        depth_start: f64,
        depth_end: f64,
    },
    /// Void is at angle - requires 3D CSG
    NonPlanar {
        mesh: Mesh,
    },
    /// Void doesn't intersect host - skip
    NonIntersecting,
}

impl VoidAnalyzer {
    /// Classify a void relative to host extrusion parameters
    pub fn classify_void(
        &self,
        void_mesh: &Mesh,
        host_profile_transform: &Matrix4<f64>,
        extrusion_direction: &Vector3<f64>,
        extrusion_depth: f64,
    ) -> VoidClassification;

    /// Extract 2D footprint from void mesh
    fn extract_footprint(
        &self,
        void_mesh: &Mesh,
        projection_plane: &Plane,
    ) -> Option<Vec<Point2<f64>>>;

    /// Determine void depth range in extrusion space
    fn compute_depth_range(
        &self,
        void_mesh: &Mesh,
        extrusion_direction: &Vector3<f64>,
        profile_origin: &Point3<f64>,
    ) -> (f64, f64);
}
```

### Phase 3: Enhanced Extrusion

#### 3.1 Void-Aware Extrusion

**File**: `rust/geometry/src/extrusion.rs` (modify)

```rust
/// Extrude profile with void awareness
pub fn extrude_profile_with_voids(
    profile: &Profile2DWithVoids,
    depth: f64,
    transform: Option<Matrix4<f64>>,
) -> Result<Mesh> {
    // 1. For through-voids: add as profile holes, extrude once
    // 2. For partial-depth voids: create internal caps at depth boundaries
    // 3. Handle side walls for all boundaries
}

/// Create internal cap at specified depth
fn create_internal_cap(
    void_contour: &[Point2<f64>],
    z: f64,
    normal: Vector3<f64>,
    mesh: &mut Mesh,
);
```

### Phase 4: Integration with Geometry Router

#### 4.1 Void-Aware Processing

**File**: `rust/geometry/src/router.rs` (modify)

```rust
impl GeometryRouter {
    /// Process element with void awareness
    pub fn process_element_with_voids(
        &self,
        element: &DecodedEntity,
        voids: &[DecodedEntity],
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        // 1. Get base geometry parameters (profile, direction, depth)
        // 2. Analyze each void, classify as coplanar/non-planar
        // 3. Collect coplanar voids into profile holes
        // 4. Extrude profile-with-holes
        // 5. Apply 3D CSG for non-planar voids
    }
}
```

#### 4.2 Void Index Building

**File**: `rust/geometry/src/void_index.rs` (new)

```rust
/// Index mapping host elements to their voids
pub struct VoidIndex {
    /// Map from host entity ID to void entity IDs
    host_to_voids: FxHashMap<u32, Vec<u32>>,
}

impl VoidIndex {
    /// Build void index from IFC content
    pub fn from_content(content: &str, decoder: &mut EntityDecoder) -> Self;

    /// Get void IDs for a host element
    pub fn get_voids(&self, host_id: u32) -> Option<&[u32]>;
}
```

### Phase 5: Fallback and Optimization

#### 5.1 Batched 3D CSG for Non-Planar Voids

**File**: `rust/geometry/src/csg.rs` (modify)

```rust
impl ClippingProcessor {
    /// Subtract multiple meshes efficiently
    pub fn subtract_meshes_batched(
        &self,
        host: &Mesh,
        voids: &[Mesh],
    ) -> Result<Mesh> {
        // If void count > 10, union all voids first
        // Then perform single subtraction
        if voids.len() > 10 {
            let combined = self.union_meshes(voids)?;
            self.subtract_mesh(host, &combined)
        } else {
            // Sequential subtraction for small counts
            let mut result = host.clone();
            for void in voids {
                result = self.subtract_mesh(&result, void)?;
            }
            Ok(result)
        }
    }
}
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `Cargo.toml` | Modify | Add `i_overlay` dependency |
| `src/profile.rs` | Modify | Add `VoidInfo`, `Profile2DWithVoids` |
| `src/bool2d.rs` | **New** | 2D boolean operations using i_overlay |
| `src/void_analysis.rs` | **New** | Void classification and projection |
| `src/extrusion.rs` | Modify | Add void-aware extrusion |
| `src/void_index.rs` | **New** | Void relationship indexing |
| `src/router.rs` | Modify | Integrate void-aware processing |
| `src/csg.rs` | Modify | Add batched CSG operations |
| `src/lib.rs` | Modify | Export new modules |

## Dependency Addition

```toml
# Cargo.toml
[dependencies]
i_overlay = "4.0"  # 2D polygon boolean operations
```

## Testing Strategy

### Unit Tests

1. **2D Boolean Operations** (`bool2d.rs`)
   - Rectangle - rectangle subtraction
   - Complex polygon - simple void
   - Multiple overlapping voids
   - Self-intersecting void contours

2. **Void Classification** (`void_analysis.rs`)
   - Coplanar void detection
   - Non-planar void detection (angled openings)
   - Partial-depth void detection

3. **Void-Aware Extrusion** (`extrusion.rs`)
   - Through-void extrusion
   - Partial-depth void with internal caps
   - Multiple voids at different depths

### Integration Tests

1. **Real IFC Files**
   - Test with `02_BIMcollab_Example_STR_random_C_ebkp.ifc`
   - Verify Element #276 (problematic slab) now works
   - Compare results with/without 2D optimization

2. **Performance Benchmarks**
   - Measure void processing time before/after
   - Target: 10x improvement for coplanar voids

### Regression Tests

1. **Existing Test Suite**
   - All existing CSG tests must pass
   - No visual regressions in viewer

## Expected Performance Improvements

| Scenario | Before | After | Improvement |
|----------|--------|-------|-------------|
| Wall with 1 door | 50ms | 5ms | 10x |
| Slab with 10 openings | 500ms | 20ms | 25x |
| Floor with 50+ penetrations | 2500ms+ (fails) | 100ms | 25x+ |

## Rollout Plan

### Stage 1: Core Implementation
- Implement `bool2d.rs` with i_overlay
- Add void classification
- Unit test coverage

### Stage 2: Integration
- Modify extrusion pipeline
- Add void-aware router methods
- Integration tests with real IFC files

### Stage 3: Optimization
- Batched CSG for non-planar fallback
- Performance benchmarking
- Edge case handling

### Stage 4: Release
- Documentation update
- API additions for void-aware processing
- Release notes

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| i_overlay fails on edge cases | Fall back to 3D CSG |
| Void projection produces invalid contours | Validation + simplification |
| Performance regression | Benchmark gates in CI |
| Breaking API changes | Provide both old and new methods |

## References

- [Web-IFC Source Code](https://github.com/ThatOpen/engine_web-ifc)
- [i_overlay Documentation](https://crates.io/crates/i_overlay)
- [IFC IfcArbitraryProfileDefWithVoids](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD1/HTML/schema/ifcprofileresource/lexical/ifcarbitraryprofiledefwithvoids.htm)
- [IFC IfcRelVoidsElement](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/FINAL/HTML/schema/ifcproductextension/lexical/ifcrelvoidselement.htm)

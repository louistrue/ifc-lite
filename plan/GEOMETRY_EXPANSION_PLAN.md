# IFC-Lite Geometry Expansion Plan

## Executive Summary

This plan outlines the implementation of missing IFC geometry types to achieve ~95% geometry coverage, comparable to IfcOpenShell. The work is organized into 4 phases over multiple development cycles.

### Current State vs Target

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| Extrusions | ✅ 100% | 100% | - |
| Revolutions | ⚠️ 20% | 100% | `IfcRevolvedAreaSolid`, `IfcRevolvedAreaSolidTapered` |
| Sweeps | ⚠️ 40% | 100% | `IfcSurfaceCurveSweptAreaSolid`, `IfcFixedReferenceSweptAreaSolid` |
| Boolean CSG | ⚠️ 60% | 95% | Nested operations, all operand types |
| B-Rep | ✅ 80% | 100% | `IfcAdvancedBrep`, curved faces |
| NURBS/Curves | ❌ 0% | 80% | B-splines, rational curves |
| Surface Models | ⚠️ 30% | 90% | Shell-based, face-based models |
| CSG Primitives | ❌ 10% | 100% | Sphere, Cone, Cylinder, Block, Pyramid |

---

## Phase 1: Revolution & Sweep Solids

**Priority**: P0 (Critical)
**Complexity**: Medium
**Dependencies**: Profile processing (already implemented)

### 1.1 IfcRevolvedAreaSolid

**IFC Definition**: A solid created by revolving a 2D profile around an axis.

**Attributes**:
- `SweptArea`: IfcProfileDef (2D profile to revolve)
- `Position`: IfcAxis2Placement3D (placement of the solid)
- `Axis`: IfcAxis1Placement (revolution axis - point + direction)
- `Angle`: IfcPlaneAngleMeasure (revolution angle in radians, max 2π)

**Algorithm**:
```
1. Extract profile using existing ProfileProcessor
2. Get axis position and direction
3. For each profile point:
   a. Calculate distance from axis (radius)
   b. Generate points along arc (angle / segments)
   c. Create vertices at each angular step
4. Generate triangles:
   a. Connect adjacent profile slices with quads → 2 triangles
   b. If angle < 2π: add start/end caps
5. Calculate normals (radial direction from axis)
```

**Implementation Location**: `rust/geometry/src/processors.rs`

```rust
pub struct RevolvedAreaSolidProcessor {
    profile_processor: ProfileProcessor,
    segments: usize,  // Angular resolution (default: 32)
}

impl GeometryProcessor for RevolvedAreaSolidProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        // 1. Get SweptArea (attribute 0)
        let swept_area = decoder.get_entity_ref(entity, 0)?;
        let profile = self.profile_processor.process(&swept_area, decoder)?;

        // 2. Get Position (attribute 1) - IfcAxis2Placement3D
        let position = decoder.get_entity_ref(entity, 1)?;

        // 3. Get Axis (attribute 2) - IfcAxis1Placement
        let axis = decoder.get_entity_ref(entity, 2)?;
        let axis_point = self.extract_point3d(&axis, decoder)?;
        let axis_dir = self.extract_direction(&axis, decoder)?;

        // 4. Get Angle (attribute 3)
        let angle: f64 = decoder.get_float(entity, 3)?;

        // 5. Generate revolution mesh
        let mesh = self.revolve_profile(&profile, &axis_point, &axis_dir, angle)?;

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcRevolvedAreaSolid]
    }
}
```

**Key Helper Function**:
```rust
fn revolve_profile(
    &self,
    profile: &Profile2D,
    axis_point: &Point3<f64>,
    axis_dir: &Vector3<f64>,
    angle: f64,
) -> Result<Mesh> {
    let segments = self.segments;
    let angle_step = angle / segments as f64;
    let num_profile_points = profile.outer.len();

    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    // Generate vertices for each angular slice
    for i in 0..=segments {
        let theta = i as f64 * angle_step;
        let rotation = Rotation3::from_axis_angle(&Unit::new_normalize(*axis_dir), theta);

        for point in &profile.outer {
            // Transform 2D profile point to 3D (assuming profile in XY plane)
            let p3d = Point3::new(point.x, point.y, 0.0);

            // Rotate around axis
            let rotated = rotation * (p3d - axis_point) + axis_point.coords;

            positions.extend_from_slice(&[rotated.x as f32, rotated.y as f32, rotated.z as f32]);

            // Normal points radially outward from axis
            let radial = (rotated - axis_point).normalize();
            normals.extend_from_slice(&[radial.x as f32, radial.y as f32, radial.z as f32]);
        }
    }

    // Generate triangle indices connecting adjacent slices
    for i in 0..segments {
        for j in 0..num_profile_points {
            let next_j = (j + 1) % num_profile_points;

            let v0 = (i * num_profile_points + j) as u32;
            let v1 = (i * num_profile_points + next_j) as u32;
            let v2 = ((i + 1) * num_profile_points + j) as u32;
            let v3 = ((i + 1) * num_profile_points + next_j) as u32;

            // Two triangles per quad
            indices.extend_from_slice(&[v0, v1, v2]);
            indices.extend_from_slice(&[v1, v3, v2]);
        }
    }

    // Add caps if not full revolution
    if angle < std::f64::consts::TAU - 0.001 {
        self.add_revolution_caps(&mut positions, &mut normals, &mut indices, profile, segments)?;
    }

    Ok(Mesh { positions, normals, indices })
}
```

**Test Cases**:
1. Full 360° revolution (cylinder from rectangle)
2. Partial revolution (90°, 180°, 270°)
3. Revolution with holes (tube)
4. Non-centered axis
5. Tilted axis

---

### 1.2 IfcRevolvedAreaSolidTapered

**Extension of IfcRevolvedAreaSolid** with linearly varying profile.

**Additional Attribute**:
- `EndSweptArea`: IfcProfileDef (profile at end of revolution)

**Algorithm Modification**:
```
For each angular step i:
    t = i / segments  // Interpolation factor 0→1
    interpolated_profile = lerp(start_profile, end_profile, t)
    Generate vertices from interpolated_profile
```

**Implementation**: Extend `RevolvedAreaSolidProcessor` with profile interpolation.

---

### 1.3 IfcSurfaceCurveSweptAreaSolid

**IFC Definition**: Profile swept along a 3D curve lying on a reference surface.

**Attributes**:
- `SweptArea`: IfcProfileDef
- `Position`: IfcAxis2Placement3D
- `Directrix`: IfcCurve (3D guide curve)
- `ReferenceSurface`: IfcSurface (surface containing directrix)

**Algorithm**:
```
1. Discretize directrix curve into points
2. For each point on curve:
   a. Calculate tangent (curve derivative)
   b. Calculate normal from reference surface
   c. Build local coordinate frame (Frenet-Serret or surface-aligned)
   d. Transform profile to local frame
3. Connect adjacent profile instances with triangles
4. Handle caps at start/end
```

**Implementation**:
```rust
pub struct SurfaceCurveSweptAreaSolidProcessor {
    profile_processor: ProfileProcessor,
    curve_segments: usize,
}

impl GeometryProcessor for SurfaceCurveSweptAreaSolidProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        let swept_area = decoder.get_entity_ref(entity, 0)?;
        let profile = self.profile_processor.process(&swept_area, decoder)?;

        let directrix = decoder.get_entity_ref(entity, 2)?;
        let curve_points = self.discretize_curve(&directrix, decoder)?;

        let reference_surface = decoder.get_entity_ref(entity, 3)?;

        self.sweep_along_curve(&profile, &curve_points, &reference_surface, decoder)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcSurfaceCurveSweptAreaSolid]
    }
}

fn sweep_along_curve(
    &self,
    profile: &Profile2D,
    curve_points: &[Point3<f64>],
    surface: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Result<Mesh> {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    for i in 0..curve_points.len() {
        // Calculate local frame at this point
        let tangent = if i < curve_points.len() - 1 {
            (curve_points[i + 1] - curve_points[i]).normalize()
        } else {
            (curve_points[i] - curve_points[i - 1]).normalize()
        };

        // Get surface normal at this point
        let surface_normal = self.get_surface_normal(surface, &curve_points[i], decoder)?;

        // Build orthonormal frame
        let binormal = tangent.cross(&surface_normal).normalize();
        let normal = binormal.cross(&tangent).normalize();

        // Transform profile points to this frame
        for p in &profile.outer {
            let world_pos = curve_points[i]
                + normal * p.x
                + binormal * p.y;

            positions.extend_from_slice(&[world_pos.x as f32, world_pos.y as f32, world_pos.z as f32]);
            normals.extend_from_slice(&[normal.x as f32, normal.y as f32, normal.z as f32]);
        }
    }

    // Generate indices (same as revolution)
    self.generate_sweep_indices(&mut indices, curve_points.len(), profile.outer.len());

    Ok(Mesh { positions, normals, indices })
}
```

---

### 1.4 IfcFixedReferenceSweptAreaSolid

**IFC Definition**: Profile swept along curve with fixed reference direction.

**Attributes**:
- `SweptArea`: IfcProfileDef
- `Position`: IfcAxis2Placement3D
- `Directrix`: IfcCurve
- `FixedReference`: IfcDirection (constant reference for profile orientation)

**Difference from SurfaceCurveSwept**: Uses fixed direction instead of surface normal for frame construction.

**Algorithm**:
```
For each point on curve:
    tangent = curve derivative
    reference = project FixedReference onto plane perpendicular to tangent
    binormal = tangent × reference
    normal = binormal × tangent
    Transform profile using this frame
```

---

### 1.5 Enhanced IfcSweptDiskSolid

**Current State**: Basic implementation exists in `processors.rs:727-1020`

**Gaps to Address**:
1. `IfcSweptDiskSolidPolygonal` - Disk with flat sides
2. Inner radius support (hollow pipes)
3. Start/end parameters for partial sweeps

**Enhancements**:
```rust
// Add to existing SweptDiskSolidProcessor
fn process_with_inner_radius(
    &self,
    curve_points: &[Point3<f64>],
    outer_radius: f64,
    inner_radius: Option<f64>,
) -> Result<Mesh> {
    // Generate outer surface
    let outer_mesh = self.generate_tube_surface(curve_points, outer_radius, false)?;

    if let Some(inner_r) = inner_radius {
        // Generate inner surface (normals pointing inward)
        let inner_mesh = self.generate_tube_surface(curve_points, inner_r, true)?;

        // Generate end caps (annular rings)
        let start_cap = self.generate_annular_cap(curve_points.first(), outer_radius, inner_r, true)?;
        let end_cap = self.generate_annular_cap(curve_points.last(), outer_radius, inner_r, false)?;

        // Merge all meshes
        return Ok(Mesh::merge_batch(&[outer_mesh, inner_mesh, start_cap, end_cap]));
    }

    Ok(outer_mesh)
}
```

---

## Phase 2: Advanced Boolean Operations

**Priority**: P0 (Critical)
**Complexity**: High
**Dependencies**: All solid processors from Phase 1

### 2.1 Current Boolean Limitations

Current implementation in `csg.rs` and `processors.rs:652-721`:
- Only handles `IfcBooleanClippingResult` (difference with half-space)
- Limited operand type support
- Shallow recursion only

### 2.2 Full Boolean Support Architecture

**Target Operations**:
- `IfcBooleanResult` - Union, Intersection, Difference
- `IfcBooleanClippingResult` - Specialized difference
- Nested boolean trees (A ∪ (B ∩ C))

**New Architecture**:
```rust
pub struct BooleanProcessor {
    router: Arc<GeometryRouter>,  // For recursive operand processing
}

impl GeometryProcessor for BooleanProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        // Get operator type
        let operator = decoder.get_enum(entity, 0)?;  // UNION, INTERSECTION, DIFFERENCE

        // Get first operand
        let first_operand = decoder.get_entity_ref(entity, 1)?;
        let mesh_a = self.router.process_representation_item(&first_operand, decoder)?;

        // Get second operand
        let second_operand = decoder.get_entity_ref(entity, 2)?;
        let mesh_b = self.process_operand(&second_operand, decoder)?;

        // Apply boolean operation
        match operator.as_str() {
            "UNION" => self.boolean_union(&mesh_a, &mesh_b),
            "INTERSECTION" => self.boolean_intersection(&mesh_a, &mesh_b),
            "DIFFERENCE" => self.boolean_difference(&mesh_a, &mesh_b),
            _ => Err(Error::geometry("Unknown boolean operator")),
        }
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![
            IfcType::IfcBooleanResult,
            IfcType::IfcBooleanClippingResult,
        ]
    }
}
```

### 2.3 Boolean Algorithm Options

**Option A: Mesh-based CSG (Recommended for V1)**

Use a Rust CSG library like `csg` or port algorithm from `csg.js`:

```rust
// Using BSP tree approach
fn boolean_difference(mesh_a: &Mesh, mesh_b: &Mesh) -> Result<Mesh> {
    let bsp_a = BspTree::from_mesh(mesh_a);
    let bsp_b = BspTree::from_mesh(mesh_b);

    // A - B = A ∩ (complement of B)
    let result = bsp_a.subtract(&bsp_b);

    Ok(result.to_mesh())
}
```

**BSP Tree Implementation** (new file `rust/geometry/src/bsp.rs`):
```rust
pub struct BspNode {
    plane: Plane,
    front: Option<Box<BspNode>>,
    back: Option<Box<BspNode>>,
    coplanar_front: Vec<Triangle>,
    coplanar_back: Vec<Triangle>,
}

impl BspNode {
    pub fn from_triangles(triangles: Vec<Triangle>) -> Self {
        // Build BSP tree recursively
    }

    pub fn clip_to(&mut self, other: &BspNode) {
        // Clip this tree to another
    }

    pub fn invert(&mut self) {
        // Flip inside/outside
    }

    pub fn to_triangles(&self) -> Vec<Triangle> {
        // Extract result triangles
    }
}

// Boolean operations
pub fn union(a: BspNode, b: BspNode) -> BspNode {
    let mut a = a;
    let mut b = b;
    a.clip_to(&b);
    b.clip_to(&a);
    b.invert();
    b.clip_to(&a);
    b.invert();
    a.build(b.to_triangles());
    a
}

pub fn subtract(a: BspNode, b: BspNode) -> BspNode {
    let mut a = a;
    let mut b = b;
    a.invert();
    a.clip_to(&b);
    b.clip_to(&a);
    b.invert();
    b.clip_to(&a);
    b.invert();
    a.build(b.to_triangles());
    a.invert();
    a
}

pub fn intersect(a: BspNode, b: BspNode) -> BspNode {
    let mut a = a;
    let mut b = b;
    a.invert();
    b.clip_to(&a);
    b.invert();
    a.clip_to(&b);
    b.clip_to(&a);
    a.build(b.to_triangles());
    a.invert();
    a
}
```

**Option B: Use External Crate**

Evaluate Rust crates:
- `ncollide3d` - Has CSG capabilities
- `parry3d` - Modern collision/geometry library
- `truck` - CAD kernel with boolean operations

```toml
# Cargo.toml addition
[dependencies]
parry3d = "0.13"
```

### 2.4 Half-Space Clipping Enhancement

Current `clip_mesh_by_plane` in `csg.rs` needs:

1. **Proper edge interpolation**:
```rust
fn clip_triangle_by_plane(
    tri: &Triangle,
    plane: &Plane,
) -> Vec<Triangle> {
    let d0 = plane.signed_distance(&tri.v0);
    let d1 = plane.signed_distance(&tri.v1);
    let d2 = plane.signed_distance(&tri.v2);

    // Count vertices on each side
    let front = [d0 > 0.0, d1 > 0.0, d2 > 0.0];
    let count_front = front.iter().filter(|&&b| b).count();

    match count_front {
        0 => vec![],  // Fully clipped
        3 => vec![tri.clone()],  // Fully kept
        1 | 2 => {
            // Partial clip - interpolate new vertices
            self.split_triangle(tri, &front, &[d0, d1, d2])
        }
    }
}

fn interpolate_vertex(v0: &Vertex, v1: &Vertex, t: f64) -> Vertex {
    Vertex {
        position: v0.position.lerp(&v1.position, t),
        normal: v0.normal.lerp(&v1.normal, t).normalize(),
    }
}
```

2. **Polygonal half-space** (`IfcPolygonalBoundedHalfSpace`):
```rust
fn clip_by_polygonal_halfspace(
    mesh: &Mesh,
    boundary: &[Point3<f64>],
    plane: &Plane,
) -> Result<Mesh> {
    // First clip by infinite plane
    let clipped = self.clip_by_plane(mesh, plane)?;

    // Then clip by polygon extrusion (boundary projected along plane normal)
    let boundary_mesh = self.extrude_polygon_along_normal(boundary, plane)?;

    self.boolean_intersection(&clipped, &boundary_mesh)
}
```

### 2.5 CSG Primitives

**Add support for**:
- `IfcBlock` - Box primitive
- `IfcSphere` - Sphere primitive
- `IfcRightCircularCone` - Cone primitive
- `IfcRightCircularCylinder` - Cylinder primitive
- `IfcRectangularPyramid` - Pyramid primitive

```rust
pub struct CsgPrimitiveProcessor {
    segments: usize,
}

impl GeometryProcessor for CsgPrimitiveProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        match entity.ifc_type {
            IfcType::IfcBlock => self.process_block(entity, decoder),
            IfcType::IfcSphere => self.process_sphere(entity, decoder),
            IfcType::IfcRightCircularCone => self.process_cone(entity, decoder),
            IfcType::IfcRightCircularCylinder => self.process_cylinder(entity, decoder),
            IfcType::IfcRectangularPyramid => self.process_pyramid(entity, decoder),
            _ => Err(Error::geometry("Unknown CSG primitive")),
        }
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![
            IfcType::IfcBlock,
            IfcType::IfcSphere,
            IfcType::IfcRightCircularCone,
            IfcType::IfcRightCircularCylinder,
            IfcType::IfcRectangularPyramid,
        ]
    }
}

fn process_sphere(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
    let radius: f64 = decoder.get_float(entity, 0)?;

    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    let stacks = self.segments;
    let slices = self.segments * 2;

    // Generate vertices
    for i in 0..=stacks {
        let phi = std::f64::consts::PI * i as f64 / stacks as f64;
        let sin_phi = phi.sin();
        let cos_phi = phi.cos();

        for j in 0..=slices {
            let theta = 2.0 * std::f64::consts::PI * j as f64 / slices as f64;

            let x = sin_phi * theta.cos();
            let y = sin_phi * theta.sin();
            let z = cos_phi;

            positions.extend_from_slice(&[
                (x * radius) as f32,
                (y * radius) as f32,
                (z * radius) as f32,
            ]);

            // Normal = position normalized (for unit sphere at origin)
            normals.extend_from_slice(&[x as f32, y as f32, z as f32]);
        }
    }

    // Generate indices
    for i in 0..stacks {
        for j in 0..slices {
            let v0 = i * (slices + 1) + j;
            let v1 = v0 + 1;
            let v2 = v0 + slices + 1;
            let v3 = v2 + 1;

            indices.extend_from_slice(&[v0 as u32, v2 as u32, v1 as u32]);
            indices.extend_from_slice(&[v1 as u32, v2 as u32, v3 as u32]);
        }
    }

    Ok(Mesh { positions, normals, indices })
}
```

---

## Phase 3: NURBS & B-Spline Support

**Priority**: P1 (Important)
**Complexity**: Very High
**Dependencies**: New mathematical library

### 3.1 Overview

NURBS (Non-Uniform Rational B-Splines) are essential for:
- Curved building facades
- Complex architectural shapes
- Accurate representation of design intent
- IFC4+ geometry

### 3.2 IFC NURBS Entity Types

**Curves**:
- `IfcBSplineCurve` (abstract)
- `IfcBSplineCurveWithKnots`
- `IfcRationalBSplineCurveWithKnots`

**Surfaces**:
- `IfcBSplineSurface` (abstract)
- `IfcBSplineSurfaceWithKnots`
- `IfcRationalBSplineSurfaceWithKnots`

### 3.3 NURBS Library Options

**Option A: Implement from scratch** (Educational but time-consuming)
**Option B: Use Rust crate** (Recommended)

Evaluate:
```toml
# Cargo.toml options
[dependencies]
# Option 1: Full-featured
nurbs = "0.1"

# Option 2: Part of larger geometry library
geo = "0.26"

# Option 3: Minimal implementation
bspline = "1.0"
```

### 3.4 B-Spline Curve Implementation

```rust
// New file: rust/geometry/src/nurbs.rs

use nalgebra::{Point3, Vector3};

pub struct BSplineCurve {
    pub degree: usize,
    pub control_points: Vec<Point3<f64>>,
    pub knots: Vec<f64>,
    pub weights: Option<Vec<f64>>,  // For rational curves
}

impl BSplineCurve {
    /// Evaluate curve at parameter t using de Boor's algorithm
    pub fn evaluate(&self, t: f64) -> Point3<f64> {
        let span = self.find_span(t);
        let basis = self.basis_functions(span, t);

        let mut point = Point3::origin();

        if let Some(ref weights) = self.weights {
            // Rational (NURBS) evaluation
            let mut w_sum = 0.0;
            for i in 0..=self.degree {
                let idx = span - self.degree + i;
                let w = weights[idx] * basis[i];
                point += (self.control_points[idx].coords * w);
                w_sum += w;
            }
            point /= w_sum;
        } else {
            // Non-rational B-spline
            for i in 0..=self.degree {
                let idx = span - self.degree + i;
                point += (self.control_points[idx].coords * basis[i]);
            }
        }

        point
    }

    /// Find knot span containing parameter t
    fn find_span(&self, t: f64) -> usize {
        let n = self.control_points.len() - 1;

        if t >= self.knots[n + 1] {
            return n;
        }
        if t <= self.knots[self.degree] {
            return self.degree;
        }

        // Binary search
        let mut low = self.degree;
        let mut high = n + 1;
        let mut mid = (low + high) / 2;

        while t < self.knots[mid] || t >= self.knots[mid + 1] {
            if t < self.knots[mid] {
                high = mid;
            } else {
                low = mid;
            }
            mid = (low + high) / 2;
        }

        mid
    }

    /// Compute basis functions at parameter t
    fn basis_functions(&self, span: usize, t: f64) -> Vec<f64> {
        let mut basis = vec![0.0; self.degree + 1];
        let mut left = vec![0.0; self.degree + 1];
        let mut right = vec![0.0; self.degree + 1];

        basis[0] = 1.0;

        for j in 1..=self.degree {
            left[j] = t - self.knots[span + 1 - j];
            right[j] = self.knots[span + j] - t;

            let mut saved = 0.0;
            for r in 0..j {
                let temp = basis[r] / (right[r + 1] + left[j - r]);
                basis[r] = saved + right[r + 1] * temp;
                saved = left[j - r] * temp;
            }
            basis[j] = saved;
        }

        basis
    }

    /// Discretize curve into polyline
    pub fn to_polyline(&self, segments: usize) -> Vec<Point3<f64>> {
        let t_min = self.knots[self.degree];
        let t_max = self.knots[self.control_points.len()];
        let dt = (t_max - t_min) / segments as f64;

        (0..=segments)
            .map(|i| self.evaluate(t_min + i as f64 * dt))
            .collect()
    }

    /// Compute derivative at parameter t
    pub fn derivative(&self, t: f64) -> Vector3<f64> {
        // Use finite differences for simplicity
        let epsilon = 1e-6;
        let p0 = self.evaluate(t - epsilon);
        let p1 = self.evaluate(t + epsilon);
        (p1 - p0) / (2.0 * epsilon)
    }
}
```

### 3.5 B-Spline Surface Implementation

```rust
pub struct BSplineSurface {
    pub degree_u: usize,
    pub degree_v: usize,
    pub control_points: Vec<Vec<Point3<f64>>>,  // [u][v] grid
    pub knots_u: Vec<f64>,
    pub knots_v: Vec<f64>,
    pub weights: Option<Vec<Vec<f64>>>,
}

impl BSplineSurface {
    /// Evaluate surface at parameters (u, v)
    pub fn evaluate(&self, u: f64, v: f64) -> Point3<f64> {
        // Evaluate along u direction first (for each row of control points)
        let mut temp_points: Vec<Point3<f64>> = Vec::new();

        for row in &self.control_points {
            let curve_u = BSplineCurve {
                degree: self.degree_u,
                control_points: row.clone(),
                knots: self.knots_u.clone(),
                weights: None, // Handle weights separately for rational
            };
            temp_points.push(curve_u.evaluate(u));
        }

        // Then evaluate along v direction
        let curve_v = BSplineCurve {
            degree: self.degree_v,
            control_points: temp_points,
            knots: self.knots_v.clone(),
            weights: None,
        };

        curve_v.evaluate(v)
    }

    /// Compute surface normal at (u, v)
    pub fn normal(&self, u: f64, v: f64) -> Vector3<f64> {
        let epsilon = 1e-6;

        let p = self.evaluate(u, v);
        let du = (self.evaluate(u + epsilon, v) - p) / epsilon;
        let dv = (self.evaluate(u, v + epsilon) - p) / epsilon;

        du.cross(&dv).normalize()
    }

    /// Tessellate surface into triangle mesh
    pub fn to_mesh(&self, u_segments: usize, v_segments: usize) -> Mesh {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut indices = Vec::new();

        let u_min = self.knots_u[self.degree_u];
        let u_max = self.knots_u[self.control_points.len()];
        let v_min = self.knots_v[self.degree_v];
        let v_max = self.knots_v[self.control_points[0].len()];

        // Generate grid of vertices
        for i in 0..=u_segments {
            let u = u_min + (u_max - u_min) * i as f64 / u_segments as f64;

            for j in 0..=v_segments {
                let v = v_min + (v_max - v_min) * j as f64 / v_segments as f64;

                let p = self.evaluate(u, v);
                let n = self.normal(u, v);

                positions.extend_from_slice(&[p.x as f32, p.y as f32, p.z as f32]);
                normals.extend_from_slice(&[n.x as f32, n.y as f32, n.z as f32]);
            }
        }

        // Generate triangle indices
        for i in 0..u_segments {
            for j in 0..v_segments {
                let v0 = (i * (v_segments + 1) + j) as u32;
                let v1 = v0 + 1;
                let v2 = v0 + (v_segments + 1) as u32;
                let v3 = v2 + 1;

                indices.extend_from_slice(&[v0, v2, v1]);
                indices.extend_from_slice(&[v1, v2, v3]);
            }
        }

        Mesh { positions, normals, indices }
    }
}
```

### 3.6 IFC NURBS Processor

```rust
pub struct BSplineCurveProcessor;

impl BSplineCurveProcessor {
    pub fn process_curve(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<BSplineCurve> {
        // IfcBSplineCurveWithKnots attributes:
        // 0: Degree (INTEGER)
        // 1: ControlPointsList (LIST OF IfcCartesianPoint)
        // 2: CurveForm (ENUM)
        // 3: ClosedCurve (LOGICAL)
        // 4: SelfIntersect (LOGICAL)
        // 5: KnotMultiplicities (LIST OF INTEGER)
        // 6: Knots (LIST OF REAL)
        // 7: KnotSpec (ENUM)

        let degree: usize = decoder.get_integer(entity, 0)? as usize;

        let control_points_list = decoder.get_list(entity, 1)?;
        let control_points = control_points_list
            .iter()
            .map(|cp| self.extract_point3d(cp, decoder))
            .collect::<Result<Vec<_>>>()?;

        let knot_multiplicities = decoder.get_int_list(entity, 5)?;
        let knot_values = decoder.get_float_list(entity, 6)?;

        // Expand knots according to multiplicities
        let knots = self.expand_knots(&knot_values, &knot_multiplicities);

        // Check for rational curve (IfcRationalBSplineCurveWithKnots)
        let weights = if entity.ifc_type == IfcType::IfcRationalBSplineCurveWithKnots {
            Some(decoder.get_float_list(entity, 8)?)  // WeightsData attribute
        } else {
            None
        };

        Ok(BSplineCurve {
            degree,
            control_points,
            knots,
            weights,
        })
    }

    fn expand_knots(&self, values: &[f64], multiplicities: &[i64]) -> Vec<f64> {
        let mut knots = Vec::new();
        for (value, &mult) in values.iter().zip(multiplicities) {
            for _ in 0..mult {
                knots.push(*value);
            }
        }
        knots
    }
}
```

### 3.7 Integration with Existing Processors

**Update ProfileProcessor** (`profiles.rs`) to handle B-spline curves:

```rust
fn process_curve(&self, curve: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Vec<Point2<f64>>> {
    match curve.ifc_type {
        // Existing curve types...
        IfcType::IfcPolyline => self.process_polyline(curve, decoder),
        IfcType::IfcCircle => self.process_circle(curve, decoder),

        // New B-spline support
        IfcType::IfcBSplineCurveWithKnots |
        IfcType::IfcRationalBSplineCurveWithKnots => {
            let bspline = self.bspline_processor.process_curve(curve, decoder)?;
            let points_3d = bspline.to_polyline(self.curve_segments);

            // Project to 2D (assuming XY plane for profiles)
            Ok(points_3d.iter().map(|p| Point2::new(p.x, p.y)).collect())
        }

        _ => Err(Error::geometry(format!("Unsupported curve type: {}", curve.ifc_type))),
    }
}
```

---

## Phase 4: Surface Models & Advanced B-Rep

**Priority**: P2 (Enhancement)
**Complexity**: High
**Dependencies**: Phase 3 (NURBS)

### 4.1 Surface Model Types

**Target Entities**:
- `IfcShellBasedSurfaceModel`
- `IfcFaceBasedSurfaceModel`
- `IfcAdvancedBrep`
- `IfcAdvancedBrepWithVoids`

### 4.2 IfcShellBasedSurfaceModel

**Structure**:
```
IfcShellBasedSurfaceModel
└── SbsmBoundary: SET OF IfcShell
    └── IfcOpenShell or IfcClosedShell
        └── CfsFaces: SET OF IfcFace
            └── Bounds: SET OF IfcFaceBound
                └── Bound: IfcLoop
                    └── IfcPolyLoop, IfcEdgeLoop, etc.
```

**Processor**:
```rust
pub struct ShellBasedSurfaceModelProcessor;

impl GeometryProcessor for ShellBasedSurfaceModelProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        let shells = decoder.get_list(entity, 0)?;  // SbsmBoundary

        let mut all_meshes = Vec::new();

        for shell in shells {
            let shell_mesh = self.process_shell(&shell, decoder)?;
            all_meshes.push(shell_mesh);
        }

        Ok(Mesh::merge_batch(&all_meshes))
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcShellBasedSurfaceModel]
    }
}

fn process_shell(&self, shell: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
    let faces = decoder.get_list(shell, 0)?;  // CfsFaces

    let mut all_meshes = Vec::new();

    for face in faces {
        let face_mesh = self.process_face(&face, decoder)?;
        all_meshes.push(face_mesh);
    }

    Ok(Mesh::merge_batch(&all_meshes))
}

fn process_face(&self, face: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
    let bounds = decoder.get_list(face, 0)?;  // Bounds

    let mut outer_loop: Option<Vec<Point3<f64>>> = None;
    let mut inner_loops: Vec<Vec<Point3<f64>>> = Vec::new();

    for bound in bounds {
        let is_outer = bound.ifc_type == IfcType::IfcFaceOuterBound;
        let loop_entity = decoder.get_entity_ref(&bound, 0)?;  // Bound
        let orientation: bool = decoder.get_boolean(&bound, 1)?;  // Orientation

        let mut points = self.process_loop(&loop_entity, decoder)?;

        if !orientation {
            points.reverse();
        }

        if is_outer || outer_loop.is_none() {
            outer_loop = Some(points);
        } else {
            inner_loops.push(points);
        }
    }

    let outer = outer_loop.ok_or_else(|| Error::geometry("Face has no outer bound"))?;

    // Triangulate face with holes
    self.triangulate_face_3d(&outer, &inner_loops)
}
```

### 4.3 IfcAdvancedBrep

**Key Difference**: Faces can be curved surfaces (B-spline surfaces), not just planar.

```rust
pub struct AdvancedBrepProcessor {
    bspline_processor: BSplineSurfaceProcessor,
}

impl GeometryProcessor for AdvancedBrepProcessor {
    fn process(&self, entity: &DecodedEntity, decoder: &mut EntityDecoder, schema: &IfcSchema) -> Result<Mesh> {
        let outer_shell = decoder.get_entity_ref(entity, 0)?;  // Outer
        let mut mesh = self.process_advanced_shell(&outer_shell, decoder)?;

        // Handle voids for IfcAdvancedBrepWithVoids
        if entity.ifc_type == IfcType::IfcAdvancedBrepWithVoids {
            let voids = decoder.get_list(entity, 1)?;  // Voids
            for void_shell in voids {
                let void_mesh = self.process_advanced_shell(&void_shell, decoder)?;
                // Void meshes have inverted normals
                mesh = self.boolean_processor.boolean_difference(&mesh, &void_mesh)?;
            }
        }

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![
            IfcType::IfcAdvancedBrep,
            IfcType::IfcAdvancedBrepWithVoids,
        ]
    }
}

fn process_advanced_face(&self, face: &DecodedEntity, decoder: &mut EntityDecoder) -> Result<Mesh> {
    // IfcAdvancedFace has FaceSurface attribute
    let face_surface = decoder.get_entity_ref(face, 1)?;  // FaceSurface

    match face_surface.ifc_type {
        IfcType::IfcPlane => {
            // Use existing planar face processing
            self.process_planar_face(face, decoder)
        }
        IfcType::IfcBSplineSurfaceWithKnots |
        IfcType::IfcRationalBSplineSurfaceWithKnots => {
            // Tessellate B-spline surface
            let surface = self.bspline_processor.process_surface(&face_surface, decoder)?;
            let bounds = self.extract_face_bounds(face, decoder)?;

            // Tessellate within trimming bounds
            self.tessellate_trimmed_surface(&surface, &bounds)
        }
        IfcType::IfcCylindricalSurface |
        IfcType::IfcSphericalSurface |
        IfcType::IfcToroidalSurface => {
            self.process_elementary_surface(&face_surface, face, decoder)
        }
        _ => Err(Error::geometry(format!("Unsupported face surface: {}", face_surface.ifc_type))),
    }
}
```

### 4.4 Elementary Surfaces

```rust
fn process_cylindrical_surface(
    &self,
    surface: &DecodedEntity,
    bounds: &FaceBounds,
    decoder: &mut EntityDecoder,
) -> Result<Mesh> {
    let position = decoder.get_entity_ref(surface, 0)?;  // Position
    let radius: f64 = decoder.get_float(surface, 1)?;  // Radius

    let (origin, axis, ref_dir) = self.extract_placement(&position, decoder)?;

    // Generate cylinder patch within bounds
    let u_range = bounds.u_range.unwrap_or((0.0, std::f64::consts::TAU));
    let v_range = bounds.v_range.unwrap_or((0.0, 1.0));

    self.generate_cylinder_patch(&origin, &axis, &ref_dir, radius, u_range, v_range)
}

fn process_spherical_surface(
    &self,
    surface: &DecodedEntity,
    bounds: &FaceBounds,
    decoder: &mut EntityDecoder,
) -> Result<Mesh> {
    let position = decoder.get_entity_ref(surface, 0)?;
    let radius: f64 = decoder.get_float(surface, 1)?;

    let (origin, axis, ref_dir) = self.extract_placement(&position, decoder)?;

    // Generate sphere patch
    let u_range = bounds.u_range.unwrap_or((0.0, std::f64::consts::TAU));
    let v_range = bounds.v_range.unwrap_or((-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2));

    self.generate_sphere_patch(&origin, &axis, &ref_dir, radius, u_range, v_range)
}
```

---

## Phase 5: Quality & Performance

### 5.1 Adaptive Tessellation

Instead of fixed segment counts, use curvature-based adaptive subdivision:

```rust
pub struct AdaptiveTessellator {
    /// Maximum allowed chord error (deviation from true curve)
    pub tolerance: f64,
    /// Minimum number of segments
    pub min_segments: usize,
    /// Maximum number of segments
    pub max_segments: usize,
}

impl AdaptiveTessellator {
    pub fn tessellate_curve(&self, curve: &BSplineCurve) -> Vec<Point3<f64>> {
        let mut points = Vec::new();
        let t_start = curve.knots[curve.degree];
        let t_end = curve.knots[curve.control_points.len()];

        self.subdivide_curve(curve, t_start, t_end, &mut points);

        points
    }

    fn subdivide_curve(
        &self,
        curve: &BSplineCurve,
        t0: f64,
        t1: f64,
        points: &mut Vec<Point3<f64>>,
    ) {
        let p0 = curve.evaluate(t0);
        let p1 = curve.evaluate(t1);
        let t_mid = (t0 + t1) / 2.0;
        let p_mid = curve.evaluate(t_mid);

        // Calculate chord error (distance from midpoint to line p0-p1)
        let chord = p1 - p0;
        let to_mid = p_mid - p0;
        let chord_len = chord.norm();

        let error = if chord_len > 1e-10 {
            let t = to_mid.dot(&chord) / (chord_len * chord_len);
            let closest = p0 + chord * t.clamp(0.0, 1.0);
            (p_mid - closest).norm()
        } else {
            0.0
        };

        if error > self.tolerance && points.len() < self.max_segments {
            // Subdivide further
            self.subdivide_curve(curve, t0, t_mid, points);
            self.subdivide_curve(curve, t_mid, t1, points);
        } else {
            // Accept this segment
            if points.is_empty() || (points.last().unwrap() - p0).norm() > 1e-10 {
                points.push(p0);
            }
            points.push(p1);
        }
    }
}
```

### 5.2 Mesh Optimization

```rust
pub struct MeshOptimizer;

impl MeshOptimizer {
    /// Remove duplicate vertices within tolerance
    pub fn weld_vertices(&self, mesh: &Mesh, tolerance: f32) -> Mesh {
        // Build spatial hash grid
        // Merge vertices within tolerance
        // Remap indices
    }

    /// Remove degenerate triangles
    pub fn remove_degenerate(&self, mesh: &Mesh, min_area: f32) -> Mesh {
        let mut valid_indices = Vec::new();

        for chunk in mesh.indices.chunks(3) {
            let v0 = self.get_vertex(&mesh.positions, chunk[0] as usize);
            let v1 = self.get_vertex(&mesh.positions, chunk[1] as usize);
            let v2 = self.get_vertex(&mesh.positions, chunk[2] as usize);

            let area = (v1 - v0).cross(&(v2 - v0)).norm() / 2.0;

            if area > min_area {
                valid_indices.extend_from_slice(chunk);
            }
        }

        Mesh {
            positions: mesh.positions.clone(),
            normals: mesh.normals.clone(),
            indices: valid_indices,
        }
    }

    /// Recalculate smooth normals
    pub fn recalculate_normals(&self, mesh: &Mesh, smooth: bool) -> Mesh {
        if smooth {
            self.calculate_smooth_normals(mesh)
        } else {
            self.calculate_flat_normals(mesh)
        }
    }
}
```

### 5.3 Parallel Processing

```rust
use rayon::prelude::*;

impl GeometryRouter {
    pub fn process_elements_parallel(
        &self,
        elements: &[DecodedEntity],
        decoder: &EntityDecoder,
    ) -> Vec<Result<(u32, Mesh)>> {
        elements
            .par_iter()
            .map(|element| {
                let mut local_decoder = decoder.clone();
                let mesh = self.process_element(element, &mut local_decoder)?;
                Ok((element.express_id, mesh))
            })
            .collect()
    }
}
```

---

## Implementation Roadmap

### Phase 1: Revolution & Sweep Solids
**Estimated Complexity**: ~2000 lines of Rust

| Task | Files | New Code |
|------|-------|----------|
| IfcRevolvedAreaSolid | processors.rs | ~300 lines |
| IfcRevolvedAreaSolidTapered | processors.rs | ~150 lines |
| IfcSurfaceCurveSweptAreaSolid | processors.rs | ~400 lines |
| IfcFixedReferenceSweptAreaSolid | processors.rs | ~300 lines |
| Enhanced IfcSweptDiskSolid | processors.rs | ~200 lines |
| Tests | lib.rs (tests module) | ~400 lines |

### Phase 2: Advanced Boolean Operations
**Estimated Complexity**: ~3000 lines of Rust

| Task | Files | New Code |
|------|-------|----------|
| BSP Tree implementation | bsp.rs (new) | ~800 lines |
| Boolean operations | bsp.rs | ~400 lines |
| Enhanced BooleanProcessor | processors.rs | ~300 lines |
| Half-space improvements | csg.rs | ~300 lines |
| CSG Primitives | processors.rs | ~600 lines |
| Tests | lib.rs | ~500 lines |

### Phase 3: NURBS & B-Spline Support
**Estimated Complexity**: ~2500 lines of Rust

| Task | Files | New Code |
|------|-------|----------|
| B-spline curve | nurbs.rs (new) | ~500 lines |
| B-spline surface | nurbs.rs | ~600 lines |
| NURBS processor | processors.rs | ~400 lines |
| Profile integration | profiles.rs | ~200 lines |
| Adaptive tessellation | nurbs.rs | ~300 lines |
| Tests | lib.rs | ~400 lines |

### Phase 4: Surface Models & Advanced B-Rep
**Estimated Complexity**: ~2000 lines of Rust

| Task | Files | New Code |
|------|-------|----------|
| ShellBasedSurfaceModel | processors.rs | ~400 lines |
| FaceBasedSurfaceModel | processors.rs | ~300 lines |
| AdvancedBrep | processors.rs | ~500 lines |
| Elementary surfaces | surfaces.rs (new) | ~400 lines |
| Tests | lib.rs | ~300 lines |

### Phase 5: Quality & Performance
**Estimated Complexity**: ~1000 lines of Rust

| Task | Files | New Code |
|------|-------|----------|
| Adaptive tessellation | tessellation.rs (new) | ~300 lines |
| Mesh optimization | mesh.rs | ~300 lines |
| Parallel processing | router.rs | ~200 lines |
| Benchmarks | benches/ | ~200 lines |

---

## Testing Strategy

### Unit Tests

Each processor should have tests for:
1. Basic functionality
2. Edge cases (empty profiles, zero-length curves)
3. Numerical precision
4. Invalid input handling

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_revolved_area_solid_full_revolution() {
        // Rectangle profile → Cylinder
        let profile = Profile2D {
            outer: vec![
                Point2::new(1.0, 0.0),
                Point2::new(2.0, 0.0),
                Point2::new(2.0, 1.0),
                Point2::new(1.0, 1.0),
            ],
            holes: vec![],
        };

        let processor = RevolvedAreaSolidProcessor::new(32);
        let mesh = processor.revolve_profile(
            &profile,
            &Point3::origin(),
            &Vector3::z(),
            std::f64::consts::TAU,
        ).unwrap();

        // Should produce a hollow cylinder
        assert!(mesh.positions.len() > 0);
        assert!(mesh.indices.len() > 0);
        assert!(mesh.is_watertight());
    }

    #[test]
    fn test_boolean_difference() {
        let cube = create_unit_cube();
        let sphere = create_sphere(0.5, Point3::new(0.5, 0.5, 0.5));

        let result = boolean_difference(&cube, &sphere).unwrap();

        // Result should have volume less than cube
        assert!(result.volume() < cube.volume());
        assert!(result.is_watertight());
    }
}
```

### Integration Tests

Test against real IFC files:
```rust
#[test]
fn test_real_ifc_revolved_solid() {
    let content = std::fs::read_to_string("tests/fixtures/revolved_column.ifc").unwrap();
    let parser = Parser::new();
    let result = parser.parse(&content).unwrap();

    let router = GeometryRouter::new();
    let column = result.entities.iter()
        .find(|e| e.ifc_type == IfcType::IfcColumn)
        .unwrap();

    let mesh = router.process_element(column, &mut result.decoder).unwrap();

    assert!(mesh.positions.len() > 100);
    snapshot_test("revolved_column", &mesh);
}
```

### Visual Regression Tests

Store reference renders and compare:
```rust
fn snapshot_test(name: &str, mesh: &Mesh) {
    let snapshot_path = format!("tests/snapshots/{}.bin", name);

    if std::env::var("UPDATE_SNAPSHOTS").is_ok() {
        // Update reference
        mesh.save_binary(&snapshot_path).unwrap();
    } else {
        // Compare with reference
        let reference = Mesh::load_binary(&snapshot_path).unwrap();
        assert_meshes_equal(mesh, &reference, 1e-6);
    }
}
```

---

## Dependencies to Add

```toml
# rust/geometry/Cargo.toml

[dependencies]
# Existing
nalgebra = "0.32"
earcutr = "0.4"

# New for Phase 2 (Boolean operations)
# Option A: Implement BSP ourselves (no new deps)
# Option B: Use external crate
# parry3d = "0.13"  # If using external boolean library

# New for Phase 3 (NURBS)
# Option A: Implement ourselves (no new deps, uses nalgebra)
# Option B: Use external crate
# nurbs = "0.1"

# New for Phase 5 (Parallel processing)
rayon = "1.8"
```

---

## File Structure After Implementation

```
rust/geometry/src/
├── lib.rs                    # Module exports
├── router.rs                 # GeometryRouter (updated)
├── processors.rs             # All solid processors (expanded)
├── profiles.rs               # Profile processing (updated for NURBS)
├── profile.rs                # Profile2D struct
├── triangulation.rs          # Earcut wrapper
├── extrusion.rs              # Extrusion pipeline
├── mesh.rs                   # Mesh struct + optimization
├── csg.rs                    # CSG operations (enhanced)
├── bsp.rs                    # NEW: BSP tree for booleans
├── nurbs.rs                  # NEW: B-spline curves & surfaces
├── surfaces.rs               # NEW: Elementary surfaces
├── tessellation.rs           # NEW: Adaptive tessellation
└── error.rs                  # Error types
```

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Geometry coverage | ~85% | ~95% |
| Failed geometry | ~15% | <5% |
| Parse + geometry time (50MB) | ~2.7s | <3.5s |
| Bundle size increase | 86 KB | <120 KB |
| Test coverage | ~60% | >80% |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Boolean operations produce artifacts | High | Fallback to operand, error logging |
| NURBS tessellation too slow | Medium | Adaptive tessellation, LOD |
| Bundle size bloat | Medium | Feature flags, tree shaking |
| Numerical precision issues | High | Use f64 internally, careful tolerance handling |
| Memory usage increase | Medium | Streaming processing, mesh simplification |

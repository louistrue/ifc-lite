// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Extrusion operations - converting 2D profiles to 3D meshes

use crate::error::{Error, Result};
use crate::mesh::Mesh;
use crate::profile::{Profile2D, Profile2DWithVoids, Triangulation, VoidInfo};
use nalgebra::{Matrix4, Point2, Point3, Vector3};

/// Extrude a 2D profile along the Z axis
#[inline]
pub fn extrude_profile(
    profile: &Profile2D,
    depth: f64,
    transform: Option<Matrix4<f64>>,
) -> Result<Mesh> {
    if depth <= 0.0 {
        return Err(Error::InvalidExtrusion(
            "Depth must be positive".to_string(),
        ));
    }

    // #region agent log H3/H4 - Profile bounds at extrusion entry
    let (min_x, max_x, min_y, max_y) = profile.outer.iter().fold(
        (f64::MAX, f64::MIN, f64::MAX, f64::MIN),
        |(min_x, max_x, min_y, max_y), p| {
            (min_x.min(p.x), max_x.max(p.x), min_y.min(p.y), max_y.max(p.y))
        }
    );
    let profile_span = ((max_x - min_x).powi(2) + (max_y - min_y).powi(2)).sqrt();
    // Log to stderr for capture - H3/H4 hypothesis testing
    if profile_span > 10.0 {
        eprintln!("[DEBUG-H3H4] extrude_profile: span={:.2}m pts={} X=[{:.2},{:.2}] Y=[{:.2},{:.2}] depth={:.3}",
            profile_span, profile.outer.len(), min_x, max_x, min_y, max_y, depth);
    }
    // #endregion

    // Check if profile has extreme aspect ratio (very elongated)
    // This detects profiles like railings that span building perimeters
    // and would create stretched triangles when triangulated
    let should_skip_caps = profile_has_extreme_aspect_ratio(&profile.outer);

    // Triangulate profile (only if we need caps)
    let triangulation = if should_skip_caps {
        None
    } else {
        Some(profile.triangulate()?)
    };

    // Create mesh
    let cap_vertex_count = triangulation.as_ref().map(|t| t.points.len() * 2).unwrap_or(0);
    let side_vertex_count = profile.outer.len() * 2;
    let total_vertices = cap_vertex_count + side_vertex_count;

    let cap_index_count = triangulation.as_ref().map(|t| t.indices.len() * 2).unwrap_or(0);
    let mut mesh = Mesh::with_capacity(
        total_vertices,
        cap_index_count + profile.outer.len() * 6,
    );

    // Create top and bottom caps (skip for extreme aspect ratio profiles)
    if let Some(ref tri) = triangulation {
        create_cap_mesh(tri, 0.0, Vector3::new(0.0, 0.0, -1.0), &mut mesh);
        create_cap_mesh(
            tri,
            depth,
            Vector3::new(0.0, 0.0, 1.0),
            &mut mesh,
        );
    }

    // Create side walls
    create_side_walls(&profile.outer, depth, &mut mesh);

    // Create side walls for holes
    for hole in &profile.holes {
        create_side_walls(hole, depth, &mut mesh);
    }

    // Apply transformation if provided
    if let Some(mat) = transform {
        apply_transform(&mut mesh, &mat);
    }

    Ok(mesh)
}

/// Check if a profile has an extreme aspect ratio (very elongated shape)
/// Returns true if the profile's aspect ratio exceeds 100:1
/// This catches profiles like railings that span building perimeters but have
/// small cross-sections, which would create problematic cap triangles.
#[inline]
fn profile_has_extreme_aspect_ratio(outer: &[Point2<f64>]) -> bool {
    if outer.len() < 3 {
        return false;
    }

    // Calculate bounding box
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;

    for p in outer {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
        max_y = max_y.max(p.y);
    }

    let width = max_x - min_x;
    let height = max_y - min_y;

    // Skip if dimensions are too small to measure
    if width < 0.001 || height < 0.001 {
        return false;
    }

    let aspect_ratio = (width / height).max(height / width);

    // Skip caps if aspect ratio > 100:1
    // This is a very conservative check that only catches truly extreme profiles
    // The stretched triangle filter will catch any remaining issues
    aspect_ratio > 100.0
}

/// Extrude a 2D profile with void awareness
///
/// This function handles both through-voids and partial-depth voids:
/// - Through voids: Added as holes to the profile before extrusion
/// - Partial-depth voids: Generate internal caps at depth boundaries
///
/// # Arguments
/// * `profile_with_voids` - Profile with classified void information
/// * `depth` - Total extrusion depth
/// * `transform` - Optional transformation matrix
///
/// # Returns
/// The extruded mesh with voids properly handled
#[inline]
pub fn extrude_profile_with_voids(
    profile_with_voids: &Profile2DWithVoids,
    depth: f64,
    transform: Option<Matrix4<f64>>,
) -> Result<Mesh> {
    if depth <= 0.0 {
        return Err(Error::InvalidExtrusion(
            "Depth must be positive".to_string(),
        ));
    }

    // Create profile with through-voids as holes
    let profile_with_holes = profile_with_voids.profile_with_through_holes();

    // Triangulate the combined profile
    let triangulation = profile_with_holes.triangulate()?;

    // Estimate capacity
    let partial_void_count = profile_with_voids.partial_voids().count();

    let vertex_count = triangulation.points.len() * 2;
    let side_vertex_count = profile_with_holes.outer.len() * 2
        + profile_with_holes.holes.iter().map(|h| h.len() * 2).sum::<usize>();
    let partial_void_vertices = partial_void_count * 100; // Estimate
    let total_vertices = vertex_count + side_vertex_count + partial_void_vertices;

    let mut mesh = Mesh::with_capacity(
        total_vertices,
        triangulation.indices.len() * 2 + profile_with_holes.outer.len() * 6,
    );

    // Create top and bottom caps (with through-void holes included)
    create_cap_mesh(&triangulation, 0.0, Vector3::new(0.0, 0.0, -1.0), &mut mesh);
    create_cap_mesh(
        &triangulation,
        depth,
        Vector3::new(0.0, 0.0, 1.0),
        &mut mesh,
    );

    // Create side walls for outer boundary
    create_side_walls(&profile_with_holes.outer, depth, &mut mesh);

    // Create side walls for holes (including through-voids)
    for hole in &profile_with_holes.holes {
        create_side_walls(hole, depth, &mut mesh);
    }

    // Handle partial-depth voids
    for void in profile_with_voids.partial_voids() {
        create_partial_void_geometry(void, depth, &mut mesh)?;
    }

    // Apply transformation if provided
    if let Some(mat) = transform {
        apply_transform(&mut mesh, &mat);
    }

    Ok(mesh)
}

/// Create geometry for a partial-depth void
///
/// Generates:
/// - Internal cap at void start depth (if not at bottom)
/// - Internal cap at void end depth (if not at top)
/// - Side walls for the void opening
fn create_partial_void_geometry(void: &VoidInfo, total_depth: f64, mesh: &mut Mesh) -> Result<()> {
    if void.contour.len() < 3 {
        return Ok(());
    }

    let epsilon = 0.001;

    // Create triangulation for void contour
    let void_profile = Profile2D::new(void.contour.clone());
    let void_triangulation = match void_profile.triangulate() {
        Ok(t) => t,
        Err(_) => return Ok(()), // Skip if triangulation fails
    };

    // Create internal cap at void start (if not at bottom)
    if void.depth_start > epsilon {
        create_cap_mesh(
            &void_triangulation,
            void.depth_start,
            Vector3::new(0.0, 0.0, -1.0), // Facing down into the void
            mesh,
        );
    }

    // Create internal cap at void end (if not at top)
    if void.depth_end < total_depth - epsilon {
        create_cap_mesh(
            &void_triangulation,
            void.depth_end,
            Vector3::new(0.0, 0.0, 1.0), // Facing up into the void
            mesh,
        );
    }

    // Create side walls for the void (from depth_start to depth_end)
    let void_depth = void.depth_end - void.depth_start;
    if void_depth > epsilon {
        create_void_side_walls(&void.contour, void.depth_start, void.depth_end, mesh);
    }

    Ok(())
}

/// Create side walls for a void opening between two depths
fn create_void_side_walls(
    contour: &[Point2<f64>],
    z_start: f64,
    z_end: f64,
    mesh: &mut Mesh,
) {
    let base_index = mesh.vertex_count() as u32;
    let mut quad_count = 0u32;

    for i in 0..contour.len() {
        let j = (i + 1) % contour.len();

        let p0 = &contour[i];
        let p1 = &contour[j];

        // Calculate normal for this edge (pointing inward for voids)
        // Use try_normalize to handle degenerate edges (duplicate consecutive points)
        let edge = Vector3::new(p1.x - p0.x, p1.y - p0.y, 0.0);
        // Reverse normal direction for holes (pointing inward)
        let normal = match Vector3::new(edge.y, -edge.x, 0.0).try_normalize(1e-10) {
            Some(n) => n,
            None => continue, // Skip degenerate edge (duplicate points in contour)
        };

        // Bottom vertices (at z_start)
        let v0_bottom = Point3::new(p0.x, p0.y, z_start);
        let v1_bottom = Point3::new(p1.x, p1.y, z_start);

        // Top vertices (at z_end)
        let v0_top = Point3::new(p0.x, p0.y, z_end);
        let v1_top = Point3::new(p1.x, p1.y, z_end);

        // Add 4 vertices for this quad
        let idx = base_index + (quad_count * 4);
        mesh.add_vertex(v0_bottom, normal);
        mesh.add_vertex(v1_bottom, normal);
        mesh.add_vertex(v1_top, normal);
        mesh.add_vertex(v0_top, normal);

        // Add 2 triangles for the quad (reversed winding for inward-facing)
        mesh.add_triangle(idx, idx + 2, idx + 1);
        mesh.add_triangle(idx, idx + 3, idx + 2);

        quad_count += 1;
    }
}

/// Create a cap mesh (top or bottom) from triangulation
#[inline]
fn create_cap_mesh(triangulation: &Triangulation, z: f64, normal: Vector3<f64>, mesh: &mut Mesh) {
    let base_index = mesh.vertex_count() as u32;

    // Add vertices
    for point in &triangulation.points {
        mesh.add_vertex(Point3::new(point.x, point.y, z), normal);
    }

    // Add triangles
    for i in (0..triangulation.indices.len()).step_by(3) {
        let i0 = base_index + triangulation.indices[i] as u32;
        let i1 = base_index + triangulation.indices[i + 1] as u32;
        let i2 = base_index + triangulation.indices[i + 2] as u32;

        // Reverse winding for bottom cap
        if z == 0.0 {
            mesh.add_triangle(i0, i2, i1);
        } else {
            mesh.add_triangle(i0, i1, i2);
        }
    }
}

/// Create side walls for a profile boundary
#[inline]
fn create_side_walls(boundary: &[nalgebra::Point2<f64>], depth: f64, mesh: &mut Mesh) {
    let base_index = mesh.vertex_count() as u32;
    let mut quad_count = 0u32;

    for i in 0..boundary.len() {
        let j = (i + 1) % boundary.len();

        let p0 = &boundary[i];
        let p1 = &boundary[j];

        // Calculate normal for this edge
        // Use try_normalize to handle degenerate edges (duplicate consecutive points)
        let edge = Vector3::new(p1.x - p0.x, p1.y - p0.y, 0.0);
        let normal = match Vector3::new(-edge.y, edge.x, 0.0).try_normalize(1e-10) {
            Some(n) => n,
            None => continue, // Skip degenerate edge (duplicate points in profile)
        };

        // Bottom vertices
        let v0_bottom = Point3::new(p0.x, p0.y, 0.0);
        let v1_bottom = Point3::new(p1.x, p1.y, 0.0);

        // Top vertices
        let v0_top = Point3::new(p0.x, p0.y, depth);
        let v1_top = Point3::new(p1.x, p1.y, depth);

        // Add 4 vertices for this quad
        let idx = base_index + (quad_count * 4);
        mesh.add_vertex(v0_bottom, normal);
        mesh.add_vertex(v1_bottom, normal);
        mesh.add_vertex(v1_top, normal);
        mesh.add_vertex(v0_top, normal);

        // Add 2 triangles for the quad
        mesh.add_triangle(idx, idx + 1, idx + 2);
        mesh.add_triangle(idx, idx + 2, idx + 3);

        quad_count += 1;
    }
}

/// Apply transformation matrix to mesh
#[inline]
pub fn apply_transform(mesh: &mut Mesh, transform: &Matrix4<f64>) {
    // Transform positions using chunk-based iteration for cache locality
    mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
        let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
        let transformed = transform.transform_point(&point);
        chunk[0] = transformed.x as f32;
        chunk[1] = transformed.y as f32;
        chunk[2] = transformed.z as f32;
    });

    // Transform normals (use inverse transpose for correct normal transformation)
    let normal_matrix = transform.try_inverse().unwrap_or(*transform).transpose();

    mesh.normals.chunks_exact_mut(3).for_each(|chunk| {
        let normal = Vector3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
        let transformed = (normal_matrix * normal.to_homogeneous()).xyz().normalize();
        chunk[0] = transformed.x as f32;
        chunk[1] = transformed.y as f32;
        chunk[2] = transformed.z as f32;
    });
}

/// Apply transformation matrix to mesh with RTC (Relative-to-Center) offset
///
/// This is the key function for handling large coordinates (e.g., Swiss UTM).
/// Instead of directly converting transformed f64 coordinates to f32 (which loses
/// precision for large values), we:
/// 1. Apply the full transformation in f64 precision
/// 2. Subtract the RTC offset (in f64) before converting to f32
/// 3. This keeps the final f32 values small (~0-1000m range) where precision is excellent
///
/// # Arguments
/// * `mesh` - Mesh to transform
/// * `transform` - Full transformation matrix (including large translations)
/// * `rtc_offset` - RTC offset to subtract (typically model centroid)
#[inline]
pub fn apply_transform_with_rtc(
    mesh: &mut Mesh,
    transform: &Matrix4<f64>,
    rtc_offset: (f64, f64, f64),
) {
    // Transform positions using chunk-based iteration for cache locality
    mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
        let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
        // Apply full transformation in f64
        let transformed = transform.transform_point(&point);
        // Subtract RTC offset in f64 BEFORE converting to f32 - this is the key!
        chunk[0] = (transformed.x - rtc_offset.0) as f32;
        chunk[1] = (transformed.y - rtc_offset.1) as f32;
        chunk[2] = (transformed.z - rtc_offset.2) as f32;
    });

    // Transform normals (use inverse transpose for correct normal transformation)
    // Normals don't need RTC offset - they're directions, not positions
    let normal_matrix = transform.try_inverse().unwrap_or(*transform).transpose();

    mesh.normals.chunks_exact_mut(3).for_each(|chunk| {
        let normal = Vector3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
        let transformed = (normal_matrix * normal.to_homogeneous()).xyz().normalize();
        chunk[0] = transformed.x as f32;
        chunk[1] = transformed.y as f32;
        chunk[2] = transformed.z as f32;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::create_rectangle;

    #[test]
    fn test_extrude_rectangle() {
        let profile = create_rectangle(10.0, 5.0);
        let mesh = extrude_profile(&profile, 20.0, None).unwrap();

        // Should have vertices for top, bottom, and sides
        assert!(mesh.vertex_count() > 0);
        assert!(mesh.triangle_count() > 0);

        // Check bounds
        let (min, max) = mesh.bounds();
        assert!((min.x - -5.0).abs() < 0.01);
        assert!((max.x - 5.0).abs() < 0.01);
        assert!((min.y - -2.5).abs() < 0.01);
        assert!((max.y - 2.5).abs() < 0.01);
        assert!((min.z - 0.0).abs() < 0.01);
        assert!((max.z - 20.0).abs() < 0.01);
    }

    #[test]
    fn test_extrude_with_transform() {
        let profile = create_rectangle(10.0, 5.0);

        // Translation transform
        let transform = Matrix4::new_translation(&Vector3::new(100.0, 200.0, 300.0));

        let mesh = extrude_profile(&profile, 20.0, Some(transform)).unwrap();

        // Check bounds are transformed
        let (min, max) = mesh.bounds();
        assert!((min.x - 95.0).abs() < 0.01); // -5 + 100
        assert!((max.x - 105.0).abs() < 0.01); // 5 + 100
        assert!((min.y - 197.5).abs() < 0.01); // -2.5 + 200
        assert!((max.y - 202.5).abs() < 0.01); // 2.5 + 200
        assert!((min.z - 300.0).abs() < 0.01); // 0 + 300
        assert!((max.z - 320.0).abs() < 0.01); // 20 + 300
    }

    #[test]
    fn test_extrude_circle() {
        use crate::profile::create_circle;

        let profile = create_circle(5.0, None);
        let mesh = extrude_profile(&profile, 10.0, None).unwrap();

        assert!(mesh.vertex_count() > 0);
        assert!(mesh.triangle_count() > 0);

        // Check it's roughly cylindrical
        let (min, max) = mesh.bounds();
        assert!((min.x - -5.0).abs() < 0.1);
        assert!((max.x - 5.0).abs() < 0.1);
        assert!((min.y - -5.0).abs() < 0.1);
        assert!((max.y - 5.0).abs() < 0.1);
    }

    #[test]
    fn test_extrude_hollow_circle() {
        use crate::profile::create_circle;

        let profile = create_circle(10.0, Some(5.0));
        let mesh = extrude_profile(&profile, 15.0, None).unwrap();

        // Hollow circle should have more triangles than solid
        assert!(mesh.triangle_count() > 20);
    }

    #[test]
    fn test_invalid_depth() {
        let profile = create_rectangle(10.0, 5.0);
        let result = extrude_profile(&profile, -1.0, None);
        assert!(result.is_err());
    }
}

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

    // Triangulate profile
    let triangulation = profile.triangulate()?;

    // Create mesh
    let vertex_count = triangulation.points.len() * 2; // Top and bottom
    let side_vertex_count = profile.outer.len() * 2; // Side walls
    let total_vertices = vertex_count + side_vertex_count;

    let mut mesh = Mesh::with_capacity(
        total_vertices,
        triangulation.indices.len() * 2 + profile.outer.len() * 6,
    );

    // Create top and bottom caps
    create_cap_mesh(&triangulation, 0.0, Vector3::new(0.0, 0.0, -1.0), &mut mesh);
    create_cap_mesh(
        &triangulation,
        depth,
        Vector3::new(0.0, 0.0, 1.0),
        &mut mesh,
    );

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

    for i in 0..contour.len() {
        let j = (i + 1) % contour.len();

        let p0 = &contour[i];
        let p1 = &contour[j];

        // Calculate normal for this edge (pointing inward for voids)
        let edge = Vector3::new(p1.x - p0.x, p1.y - p0.y, 0.0);
        // Reverse normal direction for holes (pointing inward)
        let normal = Vector3::new(edge.y, -edge.x, 0.0).normalize();

        // Bottom vertices (at z_start)
        let v0_bottom = Point3::new(p0.x, p0.y, z_start);
        let v1_bottom = Point3::new(p1.x, p1.y, z_start);

        // Top vertices (at z_end)
        let v0_top = Point3::new(p0.x, p0.y, z_end);
        let v1_top = Point3::new(p1.x, p1.y, z_end);

        // Add 4 vertices for this quad
        let idx = base_index + (i * 4) as u32;
        mesh.add_vertex(v0_bottom, normal);
        mesh.add_vertex(v1_bottom, normal);
        mesh.add_vertex(v1_top, normal);
        mesh.add_vertex(v0_top, normal);

        // Add 2 triangles for the quad (reversed winding for inward-facing)
        mesh.add_triangle(idx, idx + 2, idx + 1);
        mesh.add_triangle(idx, idx + 3, idx + 2);
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

    for i in 0..boundary.len() {
        let j = (i + 1) % boundary.len();

        let p0 = &boundary[i];
        let p1 = &boundary[j];

        // Calculate normal for this edge
        let edge = Vector3::new(p1.x - p0.x, p1.y - p0.y, 0.0);
        let normal = Vector3::new(-edge.y, edge.x, 0.0).normalize();

        // Bottom vertices
        let v0_bottom = Point3::new(p0.x, p0.y, 0.0);
        let v1_bottom = Point3::new(p1.x, p1.y, 0.0);

        // Top vertices
        let v0_top = Point3::new(p0.x, p0.y, depth);
        let v1_top = Point3::new(p1.x, p1.y, depth);

        // Add 4 vertices for this quad
        let idx = base_index + (i * 4) as u32;
        mesh.add_vertex(v0_bottom, normal);
        mesh.add_vertex(v1_bottom, normal);
        mesh.add_vertex(v1_top, normal);
        mesh.add_vertex(v0_top, normal);

        // Add 2 triangles for the quad
        mesh.add_triangle(idx, idx + 1, idx + 2);
        mesh.add_triangle(idx, idx + 2, idx + 3);
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

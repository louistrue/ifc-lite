// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Extrusion operations - converting 2D profiles to 3D meshes

use nalgebra::{Matrix4, Point3, Vector3};
use crate::mesh::Mesh;
use crate::profile::{Profile2D, Triangulation};
use crate::error::{Error, Result};

/// Extrude a 2D profile along the Z axis
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

    let mut mesh = Mesh::with_capacity(total_vertices, triangulation.indices.len() * 2 + profile.outer.len() * 6);

    // Create top and bottom caps
    create_cap_mesh(&triangulation, 0.0, Vector3::new(0.0, 0.0, -1.0), &mut mesh);
    create_cap_mesh(&triangulation, depth, Vector3::new(0.0, 0.0, 1.0), &mut mesh);

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

/// Create a cap mesh (top or bottom) from triangulation
fn create_cap_mesh(
    triangulation: &Triangulation,
    z: f64,
    normal: Vector3<f64>,
    mesh: &mut Mesh,
) {
    let base_index = mesh.vertex_count() as u32;

    // Add vertices
    for point in &triangulation.points {
        mesh.add_vertex(
            Point3::new(point.x, point.y, z),
            normal,
        );
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
fn create_side_walls(
    boundary: &[nalgebra::Point2<f64>],
    depth: f64,
    mesh: &mut Mesh,
) {
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
pub fn apply_transform(mesh: &mut Mesh, transform: &Matrix4<f64>) {
    // Transform positions
    for i in (0..mesh.positions.len()).step_by(3) {
        let point = Point3::new(
            mesh.positions[i] as f64,
            mesh.positions[i + 1] as f64,
            mesh.positions[i + 2] as f64,
        );

        let transformed = transform.transform_point(&point);

        mesh.positions[i] = transformed.x as f32;
        mesh.positions[i + 1] = transformed.y as f32;
        mesh.positions[i + 2] = transformed.z as f32;
    }

    // Transform normals (use inverse transpose for correct normal transformation)
    let normal_matrix = transform
        .try_inverse()
        .unwrap_or(*transform)
        .transpose();

    for i in (0..mesh.normals.len()).step_by(3) {
        let normal = Vector3::new(
            mesh.normals[i] as f64,
            mesh.normals[i + 1] as f64,
            mesh.normals[i + 2] as f64,
        );

        let transformed = (normal_matrix * normal.to_homogeneous()).xyz().normalize();

        mesh.normals[i] = transformed.x as f32;
        mesh.normals[i + 1] = transformed.y as f32;
        mesh.normals[i + 2] = transformed.z as f32;
    }
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

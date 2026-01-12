// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Polygon triangulation utilities
//!
//! Wrapper around earcutr for 2D polygon triangulation.

use crate::{Error, Result, Point2, Point3, Vector3};

/// Triangulate a simple polygon (no holes)
/// Returns triangle indices into the input points
pub fn triangulate_polygon(points: &[Point2<f64>]) -> Result<Vec<usize>> {
    if points.len() < 3 {
        return Err(Error::TriangulationError(
            "Need at least 3 points to triangulate".to_string(),
        ));
    }

    // Flatten points for earcutr
    let mut vertices = Vec::with_capacity(points.len() * 2);
    for p in points {
        vertices.push(p.x);
        vertices.push(p.y);
    }

    // Triangulate using earcutr
    let indices = earcutr::earcut(&vertices, &[], 2)
        .map_err(|e| Error::TriangulationError(format!("{:?}", e)))?;

    Ok(indices)
}

/// Triangulate a polygon with holes
/// Returns triangle indices into the combined vertex array (outer + all holes)
pub fn triangulate_polygon_with_holes(
    outer: &[Point2<f64>],
    holes: &[Vec<Point2<f64>>],
) -> Result<Vec<usize>> {
    if outer.len() < 3 {
        return Err(Error::TriangulationError(
            "Need at least 3 points in outer boundary".to_string(),
        ));
    }

    // Flatten vertices for earcutr
    let total_points: usize = outer.len() + holes.iter().map(|h| h.len()).sum::<usize>();
    let mut vertices = Vec::with_capacity(total_points * 2);

    // Add outer boundary
    for p in outer {
        vertices.push(p.x);
        vertices.push(p.y);
    }

    // Add holes and track their start indices
    let mut hole_indices = Vec::with_capacity(holes.len());
    for hole in holes {
        if hole.len() >= 3 {
            hole_indices.push(vertices.len() / 2);
            for p in hole {
                vertices.push(p.x);
                vertices.push(p.y);
            }
        }
    }

    // Triangulate using earcutr
    let indices = earcutr::earcut(&vertices, &hole_indices, 2)
        .map_err(|e| Error::TriangulationError(format!("{:?}", e)))?;

    Ok(indices)
}

/// Project 3D points onto a 2D plane defined by a normal
/// Returns 2D points and the coordinate system (u_axis, v_axis, origin)
pub fn project_to_2d(
    points_3d: &[Point3<f64>],
    normal: &Vector3<f64>,
) -> (Vec<Point2<f64>>, Vector3<f64>, Vector3<f64>, Point3<f64>) {
    if points_3d.is_empty() {
        return (Vec::new(), Vector3::zeros(), Vector3::zeros(), Point3::origin());
    }

    // Use first point as origin
    let origin = points_3d[0];

    // Create orthonormal basis on the plane
    // Find the axis least parallel to the normal for stable cross product
    let abs_x = normal.x.abs();
    let abs_y = normal.y.abs();
    let abs_z = normal.z.abs();

    let reference = if abs_x <= abs_y && abs_x <= abs_z {
        Vector3::new(1.0, 0.0, 0.0)
    } else if abs_y <= abs_z {
        Vector3::new(0.0, 1.0, 0.0)
    } else {
        Vector3::new(0.0, 0.0, 1.0)
    };

    let u_axis = normal.cross(&reference).normalize();
    let v_axis = normal.cross(&u_axis).normalize();

    // Project all points to 2D
    let points_2d = points_3d
        .iter()
        .map(|p| {
            let v = p - origin;
            Point2::new(v.dot(&u_axis), v.dot(&v_axis))
        })
        .collect();

    (points_2d, u_axis, v_axis, origin)
}

/// Project 3D points using an existing coordinate system
/// This ensures multiple sets of points use the same 2D space
pub fn project_to_2d_with_basis(
    points_3d: &[Point3<f64>],
    u_axis: &Vector3<f64>,
    v_axis: &Vector3<f64>,
    origin: &Point3<f64>,
) -> Vec<Point2<f64>> {
    points_3d
        .iter()
        .map(|p| {
            let v = p - origin;
            Point2::new(v.dot(u_axis), v.dot(v_axis))
        })
        .collect()
}

/// Calculate the normal of a polygon from its vertices
pub fn calculate_polygon_normal(points: &[Point3<f64>]) -> Vector3<f64> {
    if points.len() < 3 {
        return Vector3::new(0.0, 0.0, 1.0);
    }

    // Use Newell's method for robust normal calculation
    let mut normal = Vector3::zeros();

    for i in 0..points.len() {
        let current = &points[i];
        let next = &points[(i + 1) % points.len()];

        normal.x += (current.y - next.y) * (current.z + next.z);
        normal.y += (current.z - next.z) * (current.x + next.x);
        normal.z += (current.x - next.x) * (current.y + next.y);
    }

    let len = normal.norm();
    if len > 1e-10 {
        normal.normalize()
    } else {
        Vector3::new(0.0, 0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_triangulate_square() {
        let points = vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
            Point2::new(1.0, 1.0),
            Point2::new(0.0, 1.0),
        ];

        let indices = triangulate_polygon(&points).unwrap();

        // Square should be split into 2 triangles = 6 indices
        assert_eq!(indices.len(), 6);
    }

    #[test]
    fn test_triangulate_triangle() {
        let points = vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
            Point2::new(0.5, 1.0),
        ];

        let indices = triangulate_polygon(&points).unwrap();

        // Triangle should have 3 indices
        assert_eq!(indices.len(), 3);
    }

    #[test]
    fn test_triangulate_insufficient_points() {
        let points = vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
        ];

        let result = triangulate_polygon(&points);
        assert!(result.is_err());
    }

    #[test]
    fn test_triangulate_square_with_hole() {
        // Outer square: 0-10
        let outer = vec![
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 10.0),
            Point2::new(0.0, 10.0),
        ];

        // Inner square (hole): 3-7
        let hole = vec![
            Point2::new(3.0, 3.0),
            Point2::new(7.0, 3.0),
            Point2::new(7.0, 7.0),
            Point2::new(3.0, 7.0),
        ];

        let indices = triangulate_polygon_with_holes(&outer, &[hole]).unwrap();

        // With a hole, we should get more triangles than without
        // The result should have indices for triangles around the hole
        assert!(indices.len() > 6); // More than the 2 triangles for a simple square
        assert_eq!(indices.len() % 3, 0); // Must be a multiple of 3 (triangles)
    }

    #[test]
    fn test_triangulate_with_multiple_holes() {
        // Outer square: 0-20
        let outer = vec![
            Point2::new(0.0, 0.0),
            Point2::new(20.0, 0.0),
            Point2::new(20.0, 20.0),
            Point2::new(0.0, 20.0),
        ];

        // Two holes
        let hole1 = vec![
            Point2::new(2.0, 2.0),
            Point2::new(5.0, 2.0),
            Point2::new(5.0, 5.0),
            Point2::new(2.0, 5.0),
        ];

        let hole2 = vec![
            Point2::new(10.0, 10.0),
            Point2::new(15.0, 10.0),
            Point2::new(15.0, 15.0),
            Point2::new(10.0, 15.0),
        ];

        let indices = triangulate_polygon_with_holes(&outer, &[hole1, hole2]).unwrap();

        assert!(indices.len() > 6);
        assert_eq!(indices.len() % 3, 0);
    }

    #[test]
    fn test_calculate_polygon_normal() {
        // XY plane polygon - normal should be Z
        let points = vec![
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(1.0, 1.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        ];

        let normal = calculate_polygon_normal(&points);
        assert!((normal.z.abs() - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_project_to_2d() {
        // Points on the XY plane
        let points = vec![
            Point3::new(0.0, 0.0, 5.0),
            Point3::new(1.0, 0.0, 5.0),
            Point3::new(1.0, 1.0, 5.0),
            Point3::new(0.0, 1.0, 5.0),
        ];

        let normal = Vector3::new(0.0, 0.0, 1.0);
        let (projected, _, _, _) = project_to_2d(&points, &normal);

        assert_eq!(projected.len(), 4);
        // After projection, all Z values are ignored, and we get 2D coords
    }
}

//! Polygon triangulation utilities
//!
//! Wrapper around earcutr for 2D polygon triangulation.

use crate::{Error, Result, Point2};

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
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! 2D Profile definitions and triangulation

use nalgebra::Point2;
use crate::error::{Error, Result};

/// 2D Profile with optional holes
#[derive(Debug, Clone)]
pub struct Profile2D {
    /// Outer boundary (counter-clockwise)
    pub outer: Vec<Point2<f64>>,
    /// Holes (clockwise)
    pub holes: Vec<Vec<Point2<f64>>>,
}

impl Profile2D {
    /// Create a new profile
    pub fn new(outer: Vec<Point2<f64>>) -> Self {
        Self {
            outer,
            holes: Vec::new(),
        }
    }

    /// Add a hole to the profile
    pub fn add_hole(&mut self, hole: Vec<Point2<f64>>) {
        self.holes.push(hole);
    }

    /// Triangulate the profile using earcutr
    /// Returns triangle indices into the flattened vertex array
    pub fn triangulate(&self) -> Result<Triangulation> {
        if self.outer.len() < 3 {
            return Err(Error::InvalidProfile(
                "Profile must have at least 3 vertices".to_string(),
            ));
        }

        // Flatten vertices for earcutr
        let mut vertices = Vec::with_capacity(
            (self.outer.len() + self.holes.iter().map(|h| h.len()).sum::<usize>()) * 2,
        );

        // Add outer boundary
        for p in &self.outer {
            vertices.push(p.x);
            vertices.push(p.y);
        }

        // Add holes
        let mut hole_indices = Vec::with_capacity(self.holes.len());
        for hole in &self.holes {
            hole_indices.push(vertices.len() / 2);
            for p in hole {
                vertices.push(p.x);
                vertices.push(p.y);
            }
        }

        // Triangulate
        let indices = if hole_indices.is_empty() {
            earcutr::earcut(&vertices, &[], 2)
                .map_err(|e| Error::TriangulationError(format!("{:?}", e)))?
        } else {
            earcutr::earcut(&vertices, &hole_indices, 2)
                .map_err(|e| Error::TriangulationError(format!("{:?}", e)))?
        };

        // Convert to Point2 array
        let mut points = Vec::with_capacity(vertices.len() / 2);
        for i in (0..vertices.len()).step_by(2) {
            points.push(Point2::new(vertices[i], vertices[i + 1]));
        }

        Ok(Triangulation { points, indices })
    }
}

/// Triangulated profile result
#[derive(Debug, Clone)]
pub struct Triangulation {
    /// All vertices (outer + holes)
    pub points: Vec<Point2<f64>>,
    /// Triangle indices
    pub indices: Vec<usize>,
}

/// Common profile types
#[derive(Debug, Clone)]
pub enum ProfileType {
    Rectangle { width: f64, height: f64 },
    Circle { radius: f64 },
    HollowCircle { outer_radius: f64, inner_radius: f64 },
    Polygon { points: Vec<Point2<f64>> },
}

impl ProfileType {
    /// Convert to Profile2D
    pub fn to_profile(&self) -> Profile2D {
        match self {
            Self::Rectangle { width, height } => create_rectangle(*width, *height),
            Self::Circle { radius } => create_circle(*radius, None),
            Self::HollowCircle { outer_radius, inner_radius } => {
                create_circle(*outer_radius, Some(*inner_radius))
            }
            Self::Polygon { points } => Profile2D::new(points.clone()),
        }
    }
}

/// Create a rectangular profile
pub fn create_rectangle(width: f64, height: f64) -> Profile2D {
    let half_w = width / 2.0;
    let half_h = height / 2.0;

    Profile2D::new(vec![
        Point2::new(-half_w, -half_h),
        Point2::new(half_w, -half_h),
        Point2::new(half_w, half_h),
        Point2::new(-half_w, half_h),
    ])
}

/// Create a circular profile (with optional hole)
/// segments: Number of segments (None = auto-calculate based on radius)
pub fn create_circle(radius: f64, hole_radius: Option<f64>) -> Profile2D {
    let segments = calculate_circle_segments(radius);

    let mut outer = Vec::with_capacity(segments);

    for i in 0..segments {
        let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
        outer.push(Point2::new(
            radius * angle.cos(),
            radius * angle.sin(),
        ));
    }

    let mut profile = Profile2D::new(outer);

    // Add hole if specified
    if let Some(hole_r) = hole_radius {
        let hole_segments = calculate_circle_segments(hole_r);
        let mut hole = Vec::with_capacity(hole_segments);

        for i in 0..hole_segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (hole_segments as f64);
            // Reverse winding for hole (clockwise)
            hole.push(Point2::new(
                hole_r * angle.cos(),
                hole_r * angle.sin(),
            ));
        }
        hole.reverse(); // Make clockwise

        profile.add_hole(hole);
    }

    profile
}

/// Calculate adaptive number of segments for a circle
/// Based on radius to maintain good visual quality
pub fn calculate_circle_segments(radius: f64) -> usize {
    // Adaptive segment calculation - optimized for performance
    // Smaller circles need fewer segments
    let segments = (radius.sqrt() * 8.0).ceil() as usize;

    // Clamp between 8 and 32 segments (reduced for performance)
    segments.clamp(8, 32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rectangle_profile() {
        let profile = create_rectangle(10.0, 5.0);
        assert_eq!(profile.outer.len(), 4);
        assert_eq!(profile.holes.len(), 0);

        // Check bounds
        assert_eq!(profile.outer[0], Point2::new(-5.0, -2.5));
        assert_eq!(profile.outer[1], Point2::new(5.0, -2.5));
        assert_eq!(profile.outer[2], Point2::new(5.0, 2.5));
        assert_eq!(profile.outer[3], Point2::new(-5.0, 2.5));
    }

    #[test]
    fn test_circle_profile() {
        let profile = create_circle(5.0, None);
        assert!(profile.outer.len() >= 8);
        assert_eq!(profile.holes.len(), 0);

        // Check first point is on circle
        let first = profile.outer[0];
        let dist = (first.x * first.x + first.y * first.y).sqrt();
        assert!((dist - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_hollow_circle() {
        let profile = create_circle(10.0, Some(5.0));
        assert!(profile.outer.len() >= 8);
        assert_eq!(profile.holes.len(), 1);

        // Check hole
        let hole = &profile.holes[0];
        assert!(hole.len() >= 8);
    }

    #[test]
    fn test_triangulate_rectangle() {
        let profile = create_rectangle(10.0, 5.0);
        let tri = profile.triangulate().unwrap();

        assert_eq!(tri.points.len(), 4);
        assert_eq!(tri.indices.len(), 6); // 2 triangles = 6 indices
    }

    #[test]
    fn test_triangulate_circle() {
        let profile = create_circle(5.0, None);
        let tri = profile.triangulate().unwrap();

        assert!(tri.points.len() >= 8);
        // Triangle count should be points - 2
        assert_eq!(tri.indices.len(), (tri.points.len() - 2) * 3);
    }

    #[test]
    fn test_triangulate_hollow_circle() {
        let profile = create_circle(10.0, Some(5.0));
        let tri = profile.triangulate().unwrap();

        // Should have vertices from both outer and inner circles
        let outer_count = calculate_circle_segments(10.0);
        let inner_count = calculate_circle_segments(5.0);
        assert_eq!(tri.points.len(), outer_count + inner_count);
    }

    #[test]
    fn test_circle_segments() {
        assert_eq!(calculate_circle_segments(1.0), 12);
        assert_eq!(calculate_circle_segments(4.0), 24);
        assert!(calculate_circle_segments(100.0) <= 64); // Max clamp
        assert!(calculate_circle_segments(0.1) >= 8);    // Min clamp
    }
}

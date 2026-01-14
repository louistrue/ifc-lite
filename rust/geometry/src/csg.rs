// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CSG (Constructive Solid Geometry) Operations
//!
//! Fast triangle clipping and boolean operations.

use nalgebra::{Point3, Vector3};
use crate::mesh::Mesh;
use crate::error::Result;
use crate::triangulation::calculate_polygon_normal;
use rustc_hash::FxHashMap;

/// Plane definition for clipping
#[derive(Debug, Clone, Copy)]
pub struct Plane {
    /// Point on the plane
    pub point: Point3<f64>,
    /// Normal vector (must be normalized)
    pub normal: Vector3<f64>,
}

impl Plane {
    /// Create a new plane
    pub fn new(point: Point3<f64>, normal: Vector3<f64>) -> Self {
        Self {
            point,
            normal: normal.normalize(),
        }
    }

    /// Calculate signed distance from point to plane
    /// Positive = in front, Negative = behind
    pub fn signed_distance(&self, point: &Point3<f64>) -> f64 {
        (point - self.point).dot(&self.normal)
    }

    /// Check if point is in front of plane
    pub fn is_front(&self, point: &Point3<f64>) -> bool {
        self.signed_distance(point) >= 0.0
    }
}

/// Triangle clipping result
#[derive(Debug, Clone)]
pub enum ClipResult {
    /// Triangle is completely in front (keep it)
    AllFront(Triangle),
    /// Triangle is completely behind (discard it)
    AllBehind,
    /// Triangle intersects plane - returns new triangles
    Split(Vec<Triangle>),
}

/// Triangle definition
#[derive(Debug, Clone)]
pub struct Triangle {
    pub v0: Point3<f64>,
    pub v1: Point3<f64>,
    pub v2: Point3<f64>,
}

impl Triangle {
    /// Create a new triangle
    pub fn new(v0: Point3<f64>, v1: Point3<f64>, v2: Point3<f64>) -> Self {
        Self { v0, v1, v2 }
    }

    /// Calculate triangle normal
    pub fn normal(&self) -> Vector3<f64> {
        let edge1 = self.v1 - self.v0;
        let edge2 = self.v2 - self.v0;
        edge1.cross(&edge2).normalize()
    }

    /// Calculate triangle area
    pub fn area(&self) -> f64 {
        let edge1 = self.v1 - self.v0;
        let edge2 = self.v2 - self.v0;
        edge1.cross(&edge2).norm() * 0.5
    }
}

/// CSG Clipping Processor
pub struct ClippingProcessor {
    /// Epsilon for floating point comparisons
    pub epsilon: f64,
}

impl ClippingProcessor {
    /// Create a new clipping processor
    pub fn new() -> Self {
        Self {
            epsilon: 1e-6,
        }
    }

    /// Clip a triangle against a plane
    /// Returns triangles that are in front of the plane
    pub fn clip_triangle(&self, triangle: &Triangle, plane: &Plane) -> ClipResult {
        // Calculate signed distances for all vertices
        let d0 = plane.signed_distance(&triangle.v0);
        let d1 = plane.signed_distance(&triangle.v1);
        let d2 = plane.signed_distance(&triangle.v2);

        // Count vertices in front of plane
        let mut front_count = 0;
        if d0 >= -self.epsilon { front_count += 1; }
        if d1 >= -self.epsilon { front_count += 1; }
        if d2 >= -self.epsilon { front_count += 1; }

        match front_count {
            // All vertices behind - discard triangle
            0 => ClipResult::AllBehind,

            // All vertices in front - keep triangle
            3 => ClipResult::AllFront(triangle.clone()),

            // One vertex in front - create 1 smaller triangle
            1 => {
                let (front, back1, back2) = if d0 >= -self.epsilon {
                    (triangle.v0, triangle.v1, triangle.v2)
                } else if d1 >= -self.epsilon {
                    (triangle.v1, triangle.v2, triangle.v0)
                } else {
                    (triangle.v2, triangle.v0, triangle.v1)
                };

                // Interpolate to find intersection points
                let d_front = if d0 >= -self.epsilon { d0 } else if d1 >= -self.epsilon { d1 } else { d2 };
                let d_back1 = if d0 >= -self.epsilon { d1 } else if d1 >= -self.epsilon { d2 } else { d0 };
                let d_back2 = if d0 >= -self.epsilon { d2 } else if d1 >= -self.epsilon { d0 } else { d1 };

                let t1 = d_front / (d_front - d_back1);
                let t2 = d_front / (d_front - d_back2);

                let p1 = front + (back1 - front) * t1;
                let p2 = front + (back2 - front) * t2;

                ClipResult::Split(vec![Triangle::new(front, p1, p2)])
            }

            // Two vertices in front - create 2 triangles
            2 => {
                let (front1, front2, back) = if d0 < -self.epsilon {
                    (triangle.v1, triangle.v2, triangle.v0)
                } else if d1 < -self.epsilon {
                    (triangle.v2, triangle.v0, triangle.v1)
                } else {
                    (triangle.v0, triangle.v1, triangle.v2)
                };

                // Interpolate to find intersection points
                let d_back = if d0 < -self.epsilon { d0 } else if d1 < -self.epsilon { d1 } else { d2 };
                let d_front1 = if d0 < -self.epsilon { d1 } else if d1 < -self.epsilon { d2 } else { d0 };
                let d_front2 = if d0 < -self.epsilon { d2 } else if d1 < -self.epsilon { d0 } else { d1 };

                let t1 = d_front1 / (d_front1 - d_back);
                let t2 = d_front2 / (d_front2 - d_back);

                let p1 = front1 + (back - front1) * t1;
                let p2 = front2 + (back - front2) * t2;

                ClipResult::Split(vec![
                    Triangle::new(front1, front2, p1),
                    Triangle::new(front2, p2, p1),
                ])
            }

            _ => unreachable!(),
        }
    }

    /// Fast box subtraction - removes everything inside the box from the mesh
    /// Uses bitflag classification for O(n) performance with fast paths
    pub fn subtract_box(&self, mesh: &Mesh, min: Point3<f64>, max: Point3<f64>) -> Result<Mesh> {
        let mut result = Mesh::with_capacity(mesh.vertex_count(), mesh.indices.len());
        
        // Process each triangle
        for i in (0..mesh.indices.len()).step_by(3) {
            let i0 = mesh.indices[i] as usize;
            let i1 = mesh.indices[i + 1] as usize;
            let i2 = mesh.indices[i + 2] as usize;

            // Get triangle vertices
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );

            // Classify each vertex: 6 bits (one per box face)
            // Bit 0: outside_min_x (x < min.x)
            // Bit 1: outside_max_x (x > max.x)
            // Bit 2: outside_min_y (y < min.y)
            // Bit 3: outside_max_y (y > max.y)
            // Bit 4: outside_min_z (z < min.z)
            // Bit 5: outside_max_z (z > max.z)
            let classify = |v: &Point3<f64>| -> u8 {
                let mut flags = 0u8;
                if v.x < min.x { flags |= 1 << 0; }
                if v.x > max.x { flags |= 1 << 1; }
                if v.y < min.y { flags |= 1 << 2; }
                if v.y > max.y { flags |= 1 << 3; }
                if v.z < min.z { flags |= 1 << 4; }
                if v.z > max.z { flags |= 1 << 5; }
                flags
            };

            let flags0 = classify(&v0);
            let flags1 = classify(&v1);
            let flags2 = classify(&v2);

            // Fast path 1: All vertices inside box (no outside flags) → DISCARD
            if flags0 == 0 && flags1 == 0 && flags2 == 0 {
                continue; // Triangle is fully inside opening, discard it
            }

            // Fast path 2: All vertices share at least one common outside flag → KEEP
            // If all vertices are outside the same face, triangle is fully outside
            let common_outside = flags0 & flags1 & flags2;
            if common_outside != 0 {
                // Triangle is fully outside box, keep it
                // Use add_triangle_to_mesh to properly compute normals
                let triangle = Triangle::new(v0, v1, v2);
                add_triangle_to_mesh(&mut result, &triangle);
                continue;
            }

            // Slow path: Triangle intersects box boundary → clip against all 6 box planes
            // Create 6 clipping planes (keep everything OUTSIDE the box)
            let planes = [
                Plane::new(min, Vector3::new(1.0, 0.0, 0.0)),   // Left: keep x >= min.x
                Plane::new(max, Vector3::new(-1.0, 0.0, 0.0)),  // Right: keep x <= max.x
                Plane::new(min, Vector3::new(0.0, 1.0, 0.0)),   // Bottom: keep y >= min.y
                Plane::new(max, Vector3::new(0.0, -1.0, 0.0)),  // Top: keep y <= max.y
                Plane::new(min, Vector3::new(0.0, 0.0, 1.0)),   // Front: keep z >= min.z
                Plane::new(max, Vector3::new(0.0, 0.0, -1.0)), // Back: keep z <= max.z
            ];

            // Start with single triangle, collect all clipped triangles
            let mut triangles_to_clip = vec![Triangle::new(v0, v1, v2)];
            
            // Clip against each plane sequentially
            for plane in &planes {
                let mut next_triangles = Vec::new();
                for triangle in triangles_to_clip {
                    match self.clip_triangle(&triangle, plane) {
                        ClipResult::AllFront(tri) => {
                            next_triangles.push(tri);
                        }
                        ClipResult::AllBehind => {
                            // Triangle completely removed, discard
                        }
                        ClipResult::Split(split_tris) => {
                            next_triangles.extend(split_tris);
                        }
                    }
                }
                triangles_to_clip = next_triangles;
                if triangles_to_clip.is_empty() {
                    break; // All triangles removed
                }
            }

            // Add all surviving triangles
            for triangle in triangles_to_clip {
                add_triangle_to_mesh(&mut result, &triangle);
            }
        }

        Ok(result)
    }

    /// Extract opening profile from mesh (find largest face)
    /// Returns profile points and normal
    fn extract_opening_profile(&self, opening_mesh: &Mesh) -> Option<(Vec<Point3<f64>>, Vector3<f64>)> {
        if opening_mesh.is_empty() {
            return None;
        }

        // Group triangles by normal to find faces
        let mut face_groups: FxHashMap<u64, Vec<Vec<Point3<f64>>>> = FxHashMap::default();
        let normal_epsilon = 0.01; // Tolerance for normal comparison

        for i in (0..opening_mesh.indices.len()).step_by(3) {
            let i0 = opening_mesh.indices[i] as usize;
            let i1 = opening_mesh.indices[i + 1] as usize;
            let i2 = opening_mesh.indices[i + 2] as usize;

            let v0 = Point3::new(
                opening_mesh.positions[i0 * 3] as f64,
                opening_mesh.positions[i0 * 3 + 1] as f64,
                opening_mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                opening_mesh.positions[i1 * 3] as f64,
                opening_mesh.positions[i1 * 3 + 1] as f64,
                opening_mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                opening_mesh.positions[i2 * 3] as f64,
                opening_mesh.positions[i2 * 3 + 1] as f64,
                opening_mesh.positions[i2 * 3 + 2] as f64,
            );

            let edge1 = v1 - v0;
            let edge2 = v2 - v0;
            let normal = edge1.cross(&edge2).normalize();

            // Quantize normal for grouping (round to nearest 0.01)
            let nx = (normal.x / normal_epsilon).round() as i32;
            let ny = (normal.y / normal_epsilon).round() as i32;
            let nz = (normal.z / normal_epsilon).round() as i32;
            let key = ((nx as u64) << 32) | ((ny as u32 as u64) << 16) | (nz as u32 as u64);

            face_groups.entry(key).or_default().push(vec![v0, v1, v2]);
        }

        // Find largest face group (most triangles = largest face)
        let largest_face = face_groups.iter()
            .max_by_key(|(_, triangles)| triangles.len())?;

        // Extract boundary of largest face (simplified: use all vertices)
        let mut profile_points = Vec::new();
        for triangle in largest_face.1 {
            profile_points.extend(triangle);
        }

        // Calculate average normal for this face
        let normal = calculate_polygon_normal(&profile_points);

        Some((profile_points, normal))
    }

    /// Convert our Mesh format to csgrs Mesh format
    fn mesh_to_csgrs(mesh: &Mesh) -> Result<csgrs::mesh::Mesh<()>> {
        use csgrs::mesh::{Mesh as CSGMesh, polygon::Polygon, vertex::Vertex};
        use std::sync::OnceLock;
        use csgrs::float_types::parry3d::bounding_volume::Aabb;

        if mesh.is_empty() {
            return Ok(CSGMesh {
                polygons: Vec::new(),
                bounding_box: OnceLock::new(),
                metadata: None,
            });
        }

        let mut polygons = Vec::new();

        // Process each triangle
        for i in (0..mesh.indices.len()).step_by(3) {
            let i0 = mesh.indices[i] as usize;
            let i1 = mesh.indices[i + 1] as usize;
            let i2 = mesh.indices[i + 2] as usize;

            // Get triangle vertices
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );

            // Calculate face normal from triangle edges
            let edge1 = v1 - v0;
            let edge2 = v2 - v0;
            let face_normal = edge1.cross(&edge2).normalize();

            // Create csgrs vertices (use face normal for all vertices)
            let vertices = vec![
                Vertex::new(v0, face_normal),
                Vertex::new(v1, face_normal),
                Vertex::new(v2, face_normal),
            ];

            polygons.push(Polygon::new(vertices, None));
        }

        Ok(CSGMesh::from_polygons(&polygons, None))
    }

    /// Convert csgrs Mesh format back to our Mesh format
    fn csgrs_to_mesh(csg_mesh: &csgrs::mesh::Mesh<()>) -> Result<Mesh> {
        let mut mesh = Mesh::new();

        for polygon in &csg_mesh.polygons {
            let vertices = &polygon.vertices;
            if vertices.len() < 3 {
                continue;
            }

            // Triangulate polygon using fan triangulation
            let base_idx = mesh.vertex_count();
            let v0 = &vertices[0];
            mesh.add_vertex(v0.pos, v0.normal);

            for i in 1..vertices.len() - 1 {
                let vi = &vertices[i];
                let v_next = &vertices[i + 1];
                
                mesh.add_vertex(vi.pos, vi.normal);
                mesh.add_vertex(v_next.pos, v_next.normal);

                let tri_idx = base_idx + (i - 1) * 2;
                mesh.add_triangle(base_idx as u32, (tri_idx + 1) as u32, (tri_idx + 2) as u32);
            }
        }

        Ok(mesh)
    }

    /// Subtract opening mesh from host mesh using csgrs CSG boolean operations
    pub fn subtract_mesh(&self, host_mesh: &Mesh, opening_mesh: &Mesh) -> Result<Mesh> {
        use csgrs::traits::CSG;

        // Fast path: if opening is empty, return host unchanged
        if opening_mesh.is_empty() {
            return Ok(host_mesh.clone());
        }

        // Convert meshes to csgrs format
        let host_csg = Self::mesh_to_csgrs(host_mesh)?;
        let opening_csg = Self::mesh_to_csgrs(opening_mesh)?;

        // Perform CSG difference (host - opening)
        let result_csg = host_csg.difference(&opening_csg);

        // Convert back to our Mesh format
        Self::csgrs_to_mesh(&result_csg)
    }

    /// Clip mesh using bounding box (6 planes) - DEPRECATED: use subtract_box() instead
    /// Subtracts everything inside the box from the mesh
    #[deprecated(note = "Use subtract_box() for better performance")]
    pub fn clip_mesh_with_box(&self, mesh: &Mesh, min: Point3<f64>, max: Point3<f64>) -> Result<Mesh> {
        self.subtract_box(mesh, min, max)
    }

    /// Clip an entire mesh against a plane
    pub fn clip_mesh(&self, mesh: &Mesh, plane: &Plane) -> Result<Mesh> {
        let mut result = Mesh::new();

        // Process each triangle
        for i in (0..mesh.indices.len()).step_by(3) {
            let i0 = mesh.indices[i] as usize;
            let i1 = mesh.indices[i + 1] as usize;
            let i2 = mesh.indices[i + 2] as usize;

            // Get triangle vertices
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );

            let triangle = Triangle::new(v0, v1, v2);

            // Clip triangle
            match self.clip_triangle(&triangle, plane) {
                ClipResult::AllFront(tri) => {
                    // Keep original triangle
                    add_triangle_to_mesh(&mut result, &tri);
                }
                ClipResult::AllBehind => {
                    // Discard triangle
                }
                ClipResult::Split(triangles) => {
                    // Add clipped triangles
                    for tri in triangles {
                        add_triangle_to_mesh(&mut result, &tri);
                    }
                }
            }
        }

        Ok(result)
    }
}

impl Default for ClippingProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Add a triangle to a mesh
fn add_triangle_to_mesh(mesh: &mut Mesh, triangle: &Triangle) {
    let base_idx = mesh.vertex_count() as u32;

    // Calculate normal
    let normal = triangle.normal();

    // Add vertices
    mesh.add_vertex(triangle.v0, normal);
    mesh.add_vertex(triangle.v1, normal);
    mesh.add_vertex(triangle.v2, normal);

    // Add triangle
    mesh.add_triangle(base_idx, base_idx + 1, base_idx + 2);
}

/// Calculate smooth normals for a mesh
#[inline]
pub fn calculate_normals(mesh: &mut Mesh) {
    let vertex_count = mesh.vertex_count();
    if vertex_count == 0 {
        return;
    }

    // Initialize normals to zero
    let mut normals = vec![Vector3::zeros(); vertex_count];

    // Accumulate face normals
    for i in (0..mesh.indices.len()).step_by(3) {
        let i0 = mesh.indices[i] as usize;
        let i1 = mesh.indices[i + 1] as usize;
        let i2 = mesh.indices[i + 2] as usize;

        // Get triangle vertices
        let v0 = Point3::new(
            mesh.positions[i0 * 3] as f64,
            mesh.positions[i0 * 3 + 1] as f64,
            mesh.positions[i0 * 3 + 2] as f64,
        );
        let v1 = Point3::new(
            mesh.positions[i1 * 3] as f64,
            mesh.positions[i1 * 3 + 1] as f64,
            mesh.positions[i1 * 3 + 2] as f64,
        );
        let v2 = Point3::new(
            mesh.positions[i2 * 3] as f64,
            mesh.positions[i2 * 3 + 1] as f64,
            mesh.positions[i2 * 3 + 2] as f64,
        );

        // Calculate face normal
        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let normal = edge1.cross(&edge2);

        // Accumulate normal for each vertex
        normals[i0] += normal;
        normals[i1] += normal;
        normals[i2] += normal;
    }

    // Normalize and write back
    mesh.normals.clear();
    mesh.normals.reserve(vertex_count * 3);

    for normal in normals {
        let normalized = normal.normalize();
        mesh.normals.push(normalized.x as f32);
        mesh.normals.push(normalized.y as f32);
        mesh.normals.push(normalized.z as f32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plane_signed_distance() {
        let plane = Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        );

        assert_eq!(plane.signed_distance(&Point3::new(0.0, 0.0, 5.0)), 5.0);
        assert_eq!(plane.signed_distance(&Point3::new(0.0, 0.0, -5.0)), -5.0);
        assert_eq!(plane.signed_distance(&Point3::new(5.0, 5.0, 0.0)), 0.0);
    }

    #[test]
    fn test_clip_triangle_all_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),
            Point3::new(1.0, 0.0, 1.0),
            Point3::new(0.5, 1.0, 1.0),
        );
        let plane = Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        );

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::AllFront(_) => {}
            _ => panic!("Expected AllFront"),
        }
    }

    #[test]
    fn test_clip_triangle_all_behind() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, -1.0),
            Point3::new(1.0, 0.0, -1.0),
            Point3::new(0.5, 1.0, -1.0),
        );
        let plane = Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        );

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::AllBehind => {}
            _ => panic!("Expected AllBehind"),
        }
    }

    #[test]
    fn test_clip_triangle_split_one_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),  // Front
            Point3::new(1.0, 0.0, -1.0), // Behind
            Point3::new(0.5, 1.0, -1.0), // Behind
        );
        let plane = Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        );

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::Split(triangles) => {
                assert_eq!(triangles.len(), 1);
            }
            _ => panic!("Expected Split"),
        }
    }

    #[test]
    fn test_clip_triangle_split_two_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),  // Front
            Point3::new(1.0, 0.0, 1.0),  // Front
            Point3::new(0.5, 1.0, -1.0), // Behind
        );
        let plane = Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        );

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::Split(triangles) => {
                assert_eq!(triangles.len(), 2);
            }
            _ => panic!("Expected Split with 2 triangles"),
        }
    }

    #[test]
    fn test_triangle_normal() {
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        );

        let normal = triangle.normal();
        assert!((normal.z - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_triangle_area() {
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        );

        let area = triangle.area();
        assert!((area - 0.5).abs() < 1e-6);
    }
}

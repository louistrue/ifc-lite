// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Mesh data structures

use nalgebra::{Point3, Vector3};

/// Triangle mesh
#[derive(Debug, Clone)]
pub struct Mesh {
    /// Vertex positions (x, y, z)
    pub positions: Vec<f32>,
    /// Vertex normals (nx, ny, nz)
    pub normals: Vec<f32>,
    /// Triangle indices (i0, i1, i2)
    pub indices: Vec<u32>,
}

impl Mesh {
    /// Create a new empty mesh
    pub fn new() -> Self {
        Self {
            positions: Vec::new(),
            normals: Vec::new(),
            indices: Vec::new(),
        }
    }

    /// Create a mesh with capacity
    pub fn with_capacity(vertex_count: usize, index_count: usize) -> Self {
        Self {
            positions: Vec::with_capacity(vertex_count * 3),
            normals: Vec::with_capacity(vertex_count * 3),
            indices: Vec::with_capacity(index_count),
        }
    }

    /// Add a vertex with normal
    pub fn add_vertex(&mut self, position: Point3<f64>, normal: Vector3<f64>) {
        self.positions.push(position.x as f32);
        self.positions.push(position.y as f32);
        self.positions.push(position.z as f32);

        self.normals.push(normal.x as f32);
        self.normals.push(normal.y as f32);
        self.normals.push(normal.z as f32);
    }

    /// Add a triangle
    pub fn add_triangle(&mut self, i0: u32, i1: u32, i2: u32) {
        self.indices.push(i0);
        self.indices.push(i1);
        self.indices.push(i2);
    }

    /// Merge another mesh into this one
    #[inline]
    pub fn merge(&mut self, other: &Mesh) {
        let vertex_offset = (self.positions.len() / 3) as u32;

        self.positions.extend_from_slice(&other.positions);
        self.normals.extend_from_slice(&other.normals);

        // Vectorized index offset - more cache-friendly than loop
        self.indices.extend(other.indices.iter().map(|&i| i + vertex_offset));
    }

    /// Batch merge multiple meshes at once (more efficient than individual merges)
    #[inline]
    pub fn merge_all(&mut self, meshes: &[Mesh]) {
        // Calculate total size needed
        let total_positions: usize = meshes.iter().map(|m| m.positions.len()).sum();
        let total_indices: usize = meshes.iter().map(|m| m.indices.len()).sum();

        // Reserve capacity upfront to avoid reallocations
        self.positions.reserve(total_positions);
        self.normals.reserve(total_positions);
        self.indices.reserve(total_indices);

        // Merge all meshes
        for mesh in meshes {
            if !mesh.is_empty() {
                let vertex_offset = (self.positions.len() / 3) as u32;
                self.positions.extend_from_slice(&mesh.positions);
                self.normals.extend_from_slice(&mesh.normals);
                self.indices.extend(mesh.indices.iter().map(|&i| i + vertex_offset));
            }
        }
    }

    /// Get vertex count
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Get triangle count
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Check if mesh is empty
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    /// Calculate bounds (min, max)
    pub fn bounds(&self) -> (Point3<f32>, Point3<f32>) {
        if self.is_empty() {
            return (Point3::origin(), Point3::origin());
        }

        let mut min = Point3::new(f32::MAX, f32::MAX, f32::MAX);
        let mut max = Point3::new(f32::MIN, f32::MIN, f32::MIN);

        for i in (0..self.positions.len()).step_by(3) {
            let x = self.positions[i];
            let y = self.positions[i + 1];
            let z = self.positions[i + 2];

            min.x = min.x.min(x);
            min.y = min.y.min(y);
            min.z = min.z.min(z);

            max.x = max.x.max(x);
            max.y = max.y.max(y);
            max.z = max.z.max(z);
        }

        (min, max)
    }
}

impl Default for Mesh {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mesh_creation() {
        let mesh = Mesh::new();
        assert!(mesh.is_empty());
        assert_eq!(mesh.vertex_count(), 0);
        assert_eq!(mesh.triangle_count(), 0);
    }

    #[test]
    fn test_add_vertex() {
        let mut mesh = Mesh::new();
        mesh.add_vertex(
            Point3::new(1.0, 2.0, 3.0),
            Vector3::new(0.0, 0.0, 1.0),
        );
        assert_eq!(mesh.vertex_count(), 1);
        assert_eq!(mesh.positions, vec![1.0, 2.0, 3.0]);
        assert_eq!(mesh.normals, vec![0.0, 0.0, 1.0]);
    }

    #[test]
    fn test_merge() {
        let mut mesh1 = Mesh::new();
        mesh1.add_vertex(Point3::new(0.0, 0.0, 0.0), Vector3::z());
        mesh1.add_triangle(0, 1, 2);

        let mut mesh2 = Mesh::new();
        mesh2.add_vertex(Point3::new(1.0, 1.0, 1.0), Vector3::y());
        mesh2.add_triangle(0, 1, 2);

        mesh1.merge(&mesh2);
        assert_eq!(mesh1.vertex_count(), 2);
        assert_eq!(mesh1.triangle_count(), 2);
    }
}

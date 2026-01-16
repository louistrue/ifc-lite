// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Mesh data types for serialization.

use serde::{Deserialize, Serialize};

/// Individual mesh data with geometry and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshData {
    /// Express ID of the IFC element.
    pub express_id: u32,
    /// IFC type name (e.g., "IfcWall").
    pub ifc_type: String,
    /// Vertex positions (x, y, z triplets).
    pub positions: Vec<f32>,
    /// Vertex normals (x, y, z triplets).
    pub normals: Vec<f32>,
    /// Triangle indices.
    pub indices: Vec<u32>,
    /// RGBA color [r, g, b, a] in 0-1 range.
    pub color: [f32; 4],
}

impl MeshData {
    /// Create a new MeshData from geometry components.
    pub fn new(
        express_id: u32,
        ifc_type: String,
        positions: Vec<f32>,
        normals: Vec<f32>,
        indices: Vec<u32>,
        color: [f32; 4],
    ) -> Self {
        Self {
            express_id,
            ifc_type,
            positions,
            normals,
            indices,
            color,
        }
    }

    /// Get the number of vertices.
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Get the number of triangles.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Check if the mesh is empty.
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty() || self.indices.is_empty()
    }
}

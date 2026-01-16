// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Shared types for Tauri commands
//!
//! These types are serialized to/from JSON and must match
//! the TypeScript interfaces in the frontend.

use serde::{Deserialize, Serialize};

/// Mesh data for a single IFC entity
/// Matches the MeshData interface in @ifc-lite/geometry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshData {
    /// Express ID of the IFC entity
    pub express_id: u32,
    /// Vertex positions (x, y, z triplets) - already converted to Y-up
    pub positions: Vec<f32>,
    /// Vertex normals (x, y, z triplets)
    pub normals: Vec<f32>,
    /// Triangle indices
    pub indices: Vec<u32>,
    /// RGBA color
    pub color: [f32; 4],
}

/// 3D point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Axis-aligned bounding box
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bounds {
    pub min: Point3,
    pub max: Point3,
}

/// Coordinate system information
/// Matches CoordinateInfo in @ifc-lite/geometry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinateInfo {
    pub origin_shift: Point3,
    pub original_bounds: Bounds,
    pub shifted_bounds: Bounds,
    pub is_geo_referenced: bool,
}

impl Default for CoordinateInfo {
    fn default() -> Self {
        Self {
            origin_shift: Point3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            original_bounds: Bounds {
                min: Point3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: Point3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            shifted_bounds: Bounds {
                min: Point3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: Point3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            is_geo_referenced: false,
        }
    }
}

/// Complete geometry result from processing an IFC file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryResult {
    pub meshes: Vec<MeshData>,
    pub total_vertices: usize,
    pub total_triangles: usize,
    pub coordinate_info: CoordinateInfo,
}

/// Progress information for streaming geometry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryProgress {
    pub processed: usize,
    pub total: usize,
    pub current_type: String,
}

/// Batch of meshes for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryBatch {
    pub meshes: Vec<MeshData>,
    pub progress: GeometryProgress,
}

/// Statistics after geometry processing completes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryStats {
    pub total_meshes: usize,
    pub total_vertices: usize,
    pub total_triangles: usize,
    pub parse_time_ms: u64,
    pub geometry_time_ms: u64,
}

/// Cache entry metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub key: String,
    pub file_name: String,
    pub file_size: u64,
    pub cache_size: u64,
    pub created_at: u64,
}

/// Cache statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub entries: Vec<CacheEntry>,
    pub total_size: u64,
    pub entry_count: usize,
}

/// File information from file dialog
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
}

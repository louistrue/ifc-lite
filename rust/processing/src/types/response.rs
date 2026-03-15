// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Shared response types for the IFC processing API.

use super::mesh::MeshData;
use serde::{Deserialize, Serialize};

/// Full parse response with all meshes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResponse {
    /// Cache key for this result (SHA256 of file content).
    pub cache_key: String,
    /// All meshes extracted from the IFC file.
    pub meshes: Vec<MeshData>,
    /// Declares the coordinate space used by serialized mesh vertices.
    /// `site_local` means clients should bake meshes directly and only apply
    /// placement transforms on the block instance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_coordinate_space: Option<String>,
    /// IfcSite ObjectPlacement as a column-major 4x4 matrix (16 f64 values, in meters).
    /// Used by clients to relocate geometry between global and site-local coordinate systems.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_transform: Option<Vec<f64>>,
    /// IfcBuilding ObjectPlacement as a column-major 4x4 matrix (16 f64 values, in meters).
    /// Used by clients to relocate geometry between global and building-local coordinate systems.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub building_transform: Option<Vec<f64>>,
    /// Model metadata.
    pub metadata: ModelMetadata,
    /// Processing statistics.
    pub stats: ProcessingStats,
}

/// Model metadata extracted from the IFC file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelMetadata {
    /// IFC schema version (e.g., "IFC2X3", "IFC4", "IFC4X3").
    pub schema_version: String,
    /// Total number of entities in the file.
    pub entity_count: usize,
    /// Number of geometry-bearing entities.
    pub geometry_entity_count: usize,
    /// Coordinate system information.
    pub coordinate_info: CoordinateInfo,
}

/// Coordinate system information.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CoordinateInfo {
    /// Origin shift applied to coordinates (for RTC rendering).
    pub origin_shift: [f64; 3],
    /// Whether the model is geo-referenced.
    pub is_geo_referenced: bool,
}

/// Processing statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProcessingStats {
    /// Total number of meshes generated.
    pub total_meshes: usize,
    /// Total number of vertices.
    pub total_vertices: usize,
    /// Total number of triangles.
    pub total_triangles: usize,
    /// Time spent parsing entities (ms).
    pub parse_time_ms: u64,
    /// Time spent processing geometry (ms).
    pub geometry_time_ms: u64,
    /// Total processing time (ms).
    pub total_time_ms: u64,
    /// Whether result was from cache.
    pub from_cache: bool,
}

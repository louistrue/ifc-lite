// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Response types for the API.

use super::MeshData;
use serde::{Deserialize, Serialize};

/// Full parse response with all meshes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResponse {
    /// Cache key for this result (SHA256 of file content).
    pub cache_key: String,
    /// All meshes extracted from the IFC file.
    pub meshes: Vec<MeshData>,
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

/// Metadata-only response (no geometry).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataResponse {
    /// Total number of entities.
    pub entity_count: usize,
    /// Number of geometry-bearing entities.
    pub geometry_count: usize,
    /// IFC schema version.
    pub schema_version: String,
    /// File size in bytes.
    pub file_size: usize,
}

/// Server-Sent Event types for streaming.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// Initial event with estimated totals.
    Start {
        /// Estimated number of geometry entities.
        total_estimate: usize,
    },

    /// Progress update.
    Progress {
        /// Number of entities processed.
        processed: usize,
        /// Total entities to process.
        total: usize,
        /// Current entity type being processed.
        current_type: String,
    },

    /// Batch of processed meshes.
    Batch {
        /// Meshes in this batch.
        meshes: Vec<MeshData>,
        /// Batch sequence number.
        batch_number: usize,
    },

    /// Processing complete.
    Complete {
        /// Final processing statistics.
        stats: ProcessingStats,
        /// Model metadata.
        metadata: ModelMetadata,
        /// Cache key for the result.
        cache_key: String,
    },

    /// Error occurred.
    Error {
        /// Error message.
        message: String,
    },
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parse endpoints for IFC file processing.

use crate::error::ApiError;
use crate::services::{
    cache::DiskCache, process_geometry, process_streaming, serialize_to_parquet,
    serialize_to_parquet_optimized_with_stats, OptimizedStats, VERTEX_MULTIPLIER,
};
use crate::types::{MetadataResponse, ModelMetadata, ParseResponse, ProcessingStats, StreamEvent};
use crate::AppState;
use axum::{
    body::Body,
    extract::{Multipart, State},
    http::{header, StatusCode},
    response::{sse::{Event, KeepAlive, Sse}, Response},
    Json,
};
use futures::stream::StreamExt;
use ifc_lite_core::EntityScanner;
use serde::Serialize;
use std::convert::Infallible;

/// Extract file data from multipart request.
async fn extract_file(multipart: &mut Multipart) -> Result<Vec<u8>, ApiError> {
    while let Some(field) = multipart.next_field().await? {
        let field_name = field.name().unwrap_or_default();
        tracing::debug!(field_name = %field_name, "Processing multipart field");
        
        if field_name == "file" {
            let bytes = field.bytes().await?;
            tracing::debug!(size = bytes.len(), "Extracted file from multipart");
            return Ok(bytes.to_vec());
        }
    }
    
    tracing::warn!("No 'file' field found in multipart request");
    Err(ApiError::MissingFile)
}

/// POST /api/v1/parse - Full synchronous parse.
pub async fn parse_full(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<ParseResponse>, ApiError> {
    // Extract file from multipart
    let data = extract_file(&mut multipart).await?;

    // Check file size
    if data.len() > state.config.max_file_size_mb * 1024 * 1024 {
        return Err(ApiError::FileTooLarge {
            max_mb: state.config.max_file_size_mb,
        });
    }

    // Generate cache key
    let cache_key = DiskCache::generate_key(&data);

    // Check cache first
    if let Some(mut cached) = state.cache.get::<ParseResponse>(&cache_key).await? {
        tracing::info!(cache_key = %cache_key, "Cache HIT");
        cached.stats.from_cache = true;
        return Ok(Json(cached));
    }

    tracing::info!(cache_key = %cache_key, size = data.len(), "Cache MISS - processing");

    // Parse content
    let content = String::from_utf8(data)?;

    // Process on blocking thread pool (CPU-intensive)
    let result = tokio::task::spawn_blocking(move || process_geometry(&content)).await?;

    let response = ParseResponse {
        cache_key: cache_key.clone(),
        meshes: result.meshes,
        metadata: result.metadata,
        stats: result.stats,
    };

    // Cache result (background)
    let cache = state.cache.clone();
    let response_clone = response.clone();
    tokio::spawn(async move {
        if let Err(e) = cache.set(&cache_key, &response_clone).await {
            tracing::error!(error = %e, "Failed to cache result");
        }
    });

    Ok(Json(response))
}

/// POST /api/v1/parse/stream - Streaming SSE parse.
pub async fn parse_stream(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    // Extract file
    let data = extract_file(&mut multipart).await?;

    // Check file size
    if data.len() > state.config.max_file_size_mb * 1024 * 1024 {
        return Err(ApiError::FileTooLarge {
            max_mb: state.config.max_file_size_mb,
        });
    }

    let content = String::from_utf8(data)?;
    let initial_batch_size = state.config.initial_batch_size;
    let max_batch_size = state.config.max_batch_size;

    // Create streaming response with dynamic batch sizing
    let stream = process_streaming(content, initial_batch_size, max_batch_size).map(|event: StreamEvent| {
        let json = serde_json::to_string(&event).unwrap_or_else(|e| {
            serde_json::to_string(&StreamEvent::Error {
                message: e.to_string(),
            })
            .unwrap()
        });
        Ok(Event::default().data(json))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// POST /api/v1/parse/metadata - Quick metadata only (no geometry).
pub async fn parse_metadata(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<MetadataResponse>, ApiError> {
    // Extract file
    let data = extract_file(&mut multipart).await?;

    // Check file size
    if data.len() > state.config.max_file_size_mb * 1024 * 1024 {
        return Err(ApiError::FileTooLarge {
            max_mb: state.config.max_file_size_mb,
        });
    }

    let file_size = data.len();
    let content = String::from_utf8(data)?;

    // Fast path - just scan entities, no geometry processing
    let result = tokio::task::spawn_blocking(move || {
        let mut scanner = EntityScanner::new(&content);
        let mut entity_count = 0usize;
        let mut geometry_count = 0usize;

        while let Some((_, type_name, _, _)) = scanner.next_entity() {
            entity_count += 1;
            if ifc_lite_core::has_geometry_by_name(type_name) {
                geometry_count += 1;
            }
        }

        // Detect schema version
        let schema_version = if content.contains("IFC4X3") {
            "IFC4X3"
        } else if content.contains("IFC4") {
            "IFC4"
        } else {
            "IFC2X3"
        };

        MetadataResponse {
            entity_count,
            geometry_count,
            schema_version: schema_version.to_string(),
            file_size,
        }
    })
    .await?;

    Ok(Json(result))
}

/// Response header containing metadata for Parquet response.
#[derive(Debug, Clone, Serialize)]
pub struct ParquetMetadataHeader {
    pub cache_key: String,
    pub metadata: ModelMetadata,
    pub stats: ProcessingStats,
}

/// POST /api/v1/parse/parquet - Full parse with Parquet-encoded geometry.
///
/// Returns binary Parquet data with ~15x smaller payload than JSON.
/// Response format:
/// - Content-Type: application/x-parquet-geometry
/// - X-IFC-Metadata: JSON-encoded ParquetMetadataHeader
/// - Body: Binary Parquet data (mesh_parquet + vertex_parquet + index_parquet)
pub async fn parse_parquet(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, ApiError> {
    // Extract file from multipart
    let data = extract_file(&mut multipart).await?;

    // Check file size
    if data.len() > state.config.max_file_size_mb * 1024 * 1024 {
        return Err(ApiError::FileTooLarge {
            max_mb: state.config.max_file_size_mb,
        });
    }

    // Generate cache key
    let cache_key = DiskCache::generate_key(&data);

    tracing::info!(
        cache_key = %cache_key,
        size = data.len(),
        "Processing with Parquet output"
    );

    // Parse content
    let content = String::from_utf8(data)?;

    // Process on blocking thread pool (CPU-intensive)
    let result = tokio::task::spawn_blocking(move || process_geometry(&content)).await?;

    // Serialize to Parquet (much more efficient than JSON)
    let parquet_data = serialize_to_parquet(&result.meshes)?;

    // Create metadata header
    let metadata_header = ParquetMetadataHeader {
        cache_key,
        metadata: result.metadata,
        stats: result.stats,
    };

    let metadata_json = serde_json::to_string(&metadata_header)?;

    // Build response with binary body and metadata header
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-parquet-geometry")
        .header("X-IFC-Metadata", metadata_json)
        .header(header::CONTENT_LENGTH, parquet_data.len())
        .body(Body::from(parquet_data))
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(response)
}

/// Response header containing metadata for optimized Parquet response.
#[derive(Debug, Clone, Serialize)]
pub struct OptimizedParquetMetadataHeader {
    pub cache_key: String,
    pub metadata: ModelMetadata,
    pub stats: ProcessingStats,
    pub optimization_stats: OptimizedStats,
    /// Vertex multiplier for dequantization (10,000 = 0.1mm precision)
    pub vertex_multiplier: f32,
}

/// POST /api/v1/parse/parquet/optimized - Full parse with ara3d BOS-optimized Parquet format.
///
/// Returns highly optimized binary Parquet data with:
/// - Integer quantized vertices (0.1mm precision)
/// - Mesh deduplication (instancing)
/// - Byte colors instead of floats
/// - Optional normals
///
/// Query params:
/// - `normals=true` - Include normals (default: false, compute on client)
///
/// Typical compression: 3-5x smaller than basic Parquet, 50-75x smaller than JSON.
pub async fn parse_parquet_optimized(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, ApiError> {
    // Extract file from multipart
    let data = extract_file(&mut multipart).await?;

    // Check file size
    if data.len() > state.config.max_file_size_mb * 1024 * 1024 {
        return Err(ApiError::FileTooLarge {
            max_mb: state.config.max_file_size_mb,
        });
    }

    // Generate cache key
    let cache_key = DiskCache::generate_key(&data);

    tracing::info!(
        cache_key = %cache_key,
        size = data.len(),
        "Processing with optimized Parquet output (ara3d BOS format)"
    );

    // Parse content
    let content = String::from_utf8(data)?;

    // Process on blocking thread pool (CPU-intensive)
    let result = tokio::task::spawn_blocking(move || process_geometry(&content)).await?;

    // Serialize to optimized Parquet (with deduplication, quantization, etc.)
    // Don't include normals by default - client can compute them
    let (parquet_data, opt_stats) =
        serialize_to_parquet_optimized_with_stats(&result.meshes, false)?;

    tracing::info!(
        input_meshes = opt_stats.input_meshes,
        unique_meshes = opt_stats.unique_meshes,
        unique_materials = opt_stats.unique_materials,
        mesh_reuse_ratio = opt_stats.mesh_reuse_ratio,
        payload_size = parquet_data.len(),
        "Optimized Parquet serialization complete"
    );

    // Create metadata header
    let metadata_header = OptimizedParquetMetadataHeader {
        cache_key,
        metadata: result.metadata,
        stats: result.stats,
        optimization_stats: opt_stats,
        vertex_multiplier: VERTEX_MULTIPLIER,
    };

    let metadata_json = serde_json::to_string(&metadata_header)?;

    // Build response with binary body and metadata header
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-parquet-geometry-optimized")
        .header("X-IFC-Metadata", metadata_json)
        .header(header::CONTENT_LENGTH, parquet_data.len())
        .body(Body::from(parquet_data))
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(response)
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parse endpoints for IFC file processing.

use crate::error::ApiError;
use crate::services::{
    cache::DiskCache, extract_data_model, process_geometry, process_streaming,
    serialize_data_model_to_parquet, serialize_to_parquet,
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
use flate2::read::GzDecoder;
use futures::stream::StreamExt;
use ifc_lite_core::EntityScanner;
use serde::Serialize;
use std::convert::Infallible;
use std::io::Read;

/// Extract file data from multipart request.
/// Automatically decompresses gzip-compressed files.
async fn extract_file(multipart: &mut Multipart) -> Result<Vec<u8>, ApiError> {
    while let Some(field) = multipart.next_field().await? {
        let field_name = field.name().unwrap_or_default();
        tracing::debug!(field_name = %field_name, "Processing multipart field");
        
        if field_name == "file" {
            let bytes = field.bytes().await?;
            let original_size = bytes.len();
            tracing::debug!(size = original_size, "Extracted file from multipart");
            
            // Check if file is gzip-compressed (magic bytes: 1f 8b)
            let is_gzipped = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;
            
            if is_gzipped {
                tracing::debug!("Detected gzip compression, decompressing...");
                let mut decoder = GzDecoder::new(bytes.as_ref());
                let mut decompressed = Vec::new();
                decoder.read_to_end(&mut decompressed)
                    .map_err(|e| ApiError::Internal(format!("Failed to decompress gzip: {}", e)))?;
                tracing::info!(
                    original_size = original_size,
                    decompressed_size = decompressed.len(),
                    compression_ratio = format!("{:.1}x", original_size as f64 / decompressed.len() as f64),
                    "File decompressed successfully"
                );
                return Ok(decompressed);
            } else {
                return Ok(bytes.to_vec());
            }
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
    /// Data model statistics (if included).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_model_stats: Option<DataModelStats>,
}

/// Data model extraction statistics.
#[derive(Debug, Clone, Serialize)]
pub struct DataModelStats {
    pub entity_count: usize,
    pub property_set_count: usize,
    pub relationship_count: usize,
    pub spatial_node_count: usize,
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

    // Check cache first (before any processing)
    let parquet_cache_key = format!("{}-parquet-v2", cache_key);
    let metadata_cache_key = format!("{}-parquet-metadata-v2", cache_key);

    if let (Some(cached_parquet), Some(cached_metadata_json)) = (
        state.cache.get_bytes(&parquet_cache_key).await?,
        state.cache.get_bytes(&metadata_cache_key).await?,
    ) {
        tracing::info!(
            cache_key = %cache_key,
            parquet_size = cached_parquet.len(),
            "Parquet cache HIT - returning cached response"
        );

        // Build response from cached data
        let response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-parquet-geometry")
            .header("X-IFC-Metadata", String::from_utf8(cached_metadata_json)?)
            .header(header::CONTENT_LENGTH, cached_parquet.len())
            .body(Body::from(cached_parquet))
            .map_err(|e| ApiError::Internal(e.to_string()))?;

        return Ok(response);
    }

    tracing::info!(
        cache_key = %cache_key,
        size = data.len(),
        "Parquet cache MISS - processing file"
    );

    // Parse content
    let content = String::from_utf8(data)?;

    // Process geometry and data model in parallel
    // rayon::join works correctly here because rayon has its own thread pool
    // that's independent of tokio's blocking thread pool
    let (geometry_result, data_model) = tokio::task::spawn_blocking(move || {
        // rayon::join will use rayon's global thread pool to run both closures in parallel
        rayon::join(
            || process_geometry(&content),
            || extract_data_model(&content),
        )
    })
    .await?;

    // Serialize geometry immediately (fast path with parallelized array building)
    let serialize_start = tokio::time::Instant::now();
    let geometry_parquet = serialize_to_parquet(&geometry_result.meshes)?;
    let geometry_serialize_time = serialize_start.elapsed();
    
    tracing::info!(
        meshes = geometry_result.meshes.len(),
        geometry_parquet_size = geometry_parquet.len(),
        geometry_serialize_time_ms = geometry_serialize_time.as_millis(),
        "Geometry serialization complete - returning immediately"
    );

    // Serialize data model in background and cache it
    let data_model_cache_key = format!("{}-datamodel-v2", cache_key);
    let cache_for_datamodel = state.cache.clone();
    let data_model_stats = DataModelStats {
        entity_count: data_model.entities.len(),
        property_set_count: data_model.property_sets.len(),
        relationship_count: data_model.relationships.len(),
        spatial_node_count: data_model.spatial_hierarchy.nodes.len(),
    };
    
    // Spawn background task to serialize and cache data model
    tokio::task::spawn_blocking(move || {
        let dm_start = std::time::Instant::now();
        match serialize_data_model_to_parquet(&data_model) {
            Ok(data_model_parquet) => {
                let serialize_time = dm_start.elapsed();
                tracing::info!(
                    data_model_parquet_size = data_model_parquet.len(),
                    serialize_time_ms = serialize_time.as_millis(),
                    "Data model serialization complete (background)"
                );
                
                // Cache the data model
                let cache = cache_for_datamodel;
                let key = data_model_cache_key;
                tokio::runtime::Handle::current().spawn(async move {
                    if let Err(e) = cache.set_bytes(&key, &data_model_parquet).await {
                        tracing::error!(error = %e, "Failed to cache data model");
                    } else {
                        tracing::info!(cache_key = %key, size = data_model_parquet.len(), "Data model cached");
                    }
                });
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to serialize data model");
            }
        }
    });

    // Build geometry-only response (data model available via separate endpoint)
    let mut combined_parquet = Vec::new();
    combined_parquet.extend_from_slice(&(geometry_parquet.len() as u32).to_le_bytes());
    combined_parquet.extend_from_slice(&geometry_parquet);
    // No data model in immediate response - client fetches separately
    combined_parquet.extend_from_slice(&0u32.to_le_bytes()); // data_model_len = 0

    // Create metadata header with data model stats (captured before background task)
    let cache_key_clone = cache_key.clone();
    let metadata_header = ParquetMetadataHeader {
        cache_key: cache_key_clone.clone(),
        metadata: geometry_result.metadata,
        stats: geometry_result.stats,
        data_model_stats: Some(data_model_stats),
    };

    let metadata_json = serde_json::to_string(&metadata_header)?;

    // Cache the results for future requests
    let parquet_cache_key = format!("{}-parquet-v2", cache_key_clone);
    let metadata_cache_key = format!("{}-parquet-metadata-v2", cache_key_clone);
    let combined_parquet_clone = combined_parquet.clone();
    let metadata_json_clone = metadata_json.clone();
    let cache = state.cache.clone();

    // Cache in background (don't block response)
    tokio::spawn(async move {
        if let Err(e) = cache.set_bytes(&parquet_cache_key, &combined_parquet_clone).await {
            tracing::error!(error = %e, "Failed to cache Parquet bytes");
        }
        if let Err(e) = cache.set_bytes(&metadata_cache_key, metadata_json_clone.as_bytes()).await {
            tracing::error!(error = %e, "Failed to cache metadata");
        }
        tracing::info!(
            cache_key = %cache_key_clone,
            parquet_size = combined_parquet_clone.len(),
            "Cached Parquet response"
        );
    });

    // Build response with binary body and metadata header
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-parquet-geometry")
        .header("X-IFC-Metadata", metadata_json)
        .header(header::CONTENT_LENGTH, combined_parquet.len())
        .body(Body::from(combined_parquet))
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

/// GET /api/v1/parse/data-model/:cache_key
/// 
/// Fetch the data model for a previously parsed file.
/// Returns the data model Parquet data if available (may still be processing).
///
/// Response:
/// - 200: Data model Parquet binary
/// - 202: Data model still processing (client should retry)
/// - 404: Cache key not found
pub async fn get_data_model(
    State(state): State<AppState>,
    axum::extract::Path(cache_key): axum::extract::Path<String>,
) -> Result<Response, ApiError> {
    let data_model_cache_key = format!("{}-datamodel-v2", cache_key);
    
    match state.cache.get_bytes(&data_model_cache_key).await? {
        Some(data_model_parquet) => {
            tracing::info!(
                cache_key = %cache_key,
                size = data_model_parquet.len(),
                "Data model cache HIT"
            );
            
            let response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/x-parquet-datamodel")
                .header(header::CONTENT_LENGTH, data_model_parquet.len())
                .body(Body::from(data_model_parquet))
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            
            Ok(response)
        }
        None => {
            tracing::debug!(cache_key = %cache_key, "Data model not yet available");
            
            // Return 202 Accepted to indicate processing
            let response = Response::builder()
                .status(StatusCode::ACCEPTED)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"status":"processing","message":"Data model is still being processed. Retry in a moment."}"#))
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            
            Ok(response)
        }
    }
}

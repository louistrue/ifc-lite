// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parse endpoints for IFC file processing.

use crate::error::ApiError;
use crate::services::{cache::DiskCache, process_geometry, process_streaming};
use crate::types::{MetadataResponse, ParseResponse, StreamEvent};
use crate::AppState;
use axum::{
    extract::{Multipart, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::StreamExt;
use ifc_lite_core::EntityScanner;
use std::convert::Infallible;

/// Extract file data from multipart request.
async fn extract_file(multipart: &mut Multipart) -> Result<Vec<u8>, ApiError> {
    while let Some(field) = multipart.next_field().await? {
        if field.name() == Some("file") {
            return Ok(field.bytes().await?.to_vec());
        }
    }
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
    let batch_size = state.config.batch_size;

    // Create streaming response
    let stream = process_streaming(content, batch_size).map(|event: StreamEvent| {
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

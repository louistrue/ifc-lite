// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! 3D Tiles serving endpoints.
//!
//! Provides on-demand 3D Tiles 1.1 serving from cached geometry.
//! Clients fetch tileset.json manifests and individual GLB tiles via HTTP.

use crate::error::ApiError;
use crate::services::glb_builder;
use crate::services::parquet_reader;
use crate::services::tileset_builder;
use crate::services::zone_reference::{self, ZoneReference};
use crate::AppState;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use std::collections::HashSet;

/// GET /api/v1/tiles/{model_key}/tileset.json
///
/// Returns the zone-based tileset manifest for a model.
/// Lazily extracts zone reference on first request, then caches.
/// Also triggers background pre-warming of all tile GLBs.
pub async fn get_tileset(
    State(state): State<AppState>,
    Path(model_key): Path<String>,
) -> Result<Response, ApiError> {
    // Check tileset cache first
    let ts_cache_key = tileset_builder::tileset_cache_key(&model_key);
    if let Some(cached_tileset) = state.cache.get_bytes(&ts_cache_key).await? {
        return build_json_response(&cached_tileset, "public, max-age=3600");
    }

    // Need to build tileset: get or create zone reference
    let zone_ref = get_or_create_zone_reference(&state, &model_key).await?;

    // Build tileset.json
    let tileset_json = tileset_builder::build_tileset(&zone_ref, &model_key);
    let tileset_bytes = serde_json::to_vec_pretty(&tileset_json)?;

    // Cache tileset
    let cache = state.cache.clone();
    let ts_key = ts_cache_key.clone();
    let bytes_clone = tileset_bytes.clone();
    tokio::spawn(async move {
        if let Err(e) = cache.set_bytes(&ts_key, &bytes_clone).await {
            tracing::error!(error = %e, "Failed to cache tileset.json");
        }
    });

    // Pre-warm all tiles in background
    let state_clone = state.clone();
    let model_key_clone = model_key.clone();
    let zone_ref_clone = zone_ref.clone();
    tokio::spawn(async move {
        prewarm_tiles(&state_clone, &model_key_clone, &zone_ref_clone).await;
    });

    build_json_response(&tileset_bytes, "public, max-age=3600")
}

/// GET /api/v1/tiles/{model_key}/{zone_id}/{ifc_class}.glb
///
/// Returns an individual tile GLB for a (zone, class) pair.
pub async fn get_tile_glb(
    State(state): State<AppState>,
    Path((model_key, zone_id, ifc_class_glb)): Path<(String, String, String)>,
) -> Result<Response, ApiError> {
    // Strip .glb extension
    let ifc_class = ifc_class_glb.strip_suffix(".glb").unwrap_or(&ifc_class_glb);

    // Check tile cache
    let tile_key = glb_builder::tile_cache_key(&model_key, &zone_id, ifc_class);
    if let Some(cached_glb) = state.cache.get_bytes(&tile_key).await? {
        return build_glb_response(cached_glb, "public, max-age=86400");
    }

    // Build tile: get zone reference and geometry
    let zone_ref = get_or_create_zone_reference(&state, &model_key).await?;

    // Get express IDs for this (zone, class) pair
    let zone_elements: HashSet<u32> = zone_ref
        .element_zone_map
        .iter()
        .filter(|(_, zid)| **zid == zone_id)
        .map(|(&eid, _)| eid)
        .collect();

    let class_elements: HashSet<u32> = zone_ref
        .ifc_class_index
        .get(ifc_class)
        .map(|v| v.iter().copied().collect())
        .unwrap_or_default();

    let target_ids: HashSet<u32> = zone_elements.intersection(&class_elements).copied().collect();

    if target_ids.is_empty() {
        return Err(ApiError::NotFound(format!(
            "No elements for zone '{}' / class '{}'",
            zone_id, ifc_class
        )));
    }

    // Read cached parquet geometry
    let parquet_cache_key = format!("{}-parquet-v3", model_key);
    let cached_parquet = state
        .cache
        .get_bytes(&parquet_cache_key)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(
                "Geometry cache not found. POST to /api/v1/parse first.".to_string(),
            )
        })?;

    // Extract meshes for target IDs (blocking - CPU intensive parquet read)
    let target_ids_clone = target_ids.clone();
    let glb_bytes = tokio::task::spawn_blocking(move || {
        let meshes = parquet_reader::extract_meshes_by_ids(&cached_parquet, &target_ids_clone)
            .map_err(|e| ApiError::Processing(format!("Failed to extract meshes: {}", e)))?;
        Ok::<Vec<u8>, ApiError>(glb_builder::build_glb(&meshes))
    })
    .await??;

    // Cache GLB in background
    let cache = state.cache.clone();
    let tile_key_clone = tile_key;
    let glb_clone = glb_bytes.clone();
    tokio::spawn(async move {
        if let Err(e) = cache.set_bytes(&tile_key_clone, &glb_clone).await {
            tracing::error!(error = %e, "Failed to cache tile GLB");
        }
    });

    build_glb_response(glb_bytes, "public, max-age=86400")
}

/// GET /api/v1/tiles/{model_key}/zones.json
///
/// Returns the zone reference for debugging/client introspection.
pub async fn get_zones(
    State(state): State<AppState>,
    Path(model_key): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let zone_ref = get_or_create_zone_reference(&state, &model_key).await?;

    Ok(Json(serde_json::json!({
        "modelHash": zone_ref.model_hash,
        "zones": zone_ref.zones,
        "elementCount": zone_ref.element_zone_map.len(),
        "ifcClasses": zone_ref.ifc_class_index.keys().collect::<Vec<_>>(),
    })))
}

/// Query parameters for federated tileset.
#[derive(Deserialize)]
pub struct FederatedQuery {
    /// Comma-separated model keys.
    pub models: String,
}

/// GET /api/v1/tiles/federated/tileset.json?models=k1,k2,k3
///
/// Returns a federated root tileset referencing multiple model tilesets.
pub async fn get_federated_tileset(
    State(state): State<AppState>,
    Query(query): Query<FederatedQuery>,
) -> Result<Response, ApiError> {
    let model_keys: Vec<&str> = query.models.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();

    if model_keys.is_empty() {
        return Err(ApiError::NotFound("No models specified".to_string()));
    }

    let mut models = Vec::new();

    for key in &model_keys {
        // Try to get zone reference for bounds
        let zone_cache_key = zone_reference::zone_cache_key(key);
        if let Some(zone_ref) = state.cache.get::<ZoneReference>(&zone_cache_key).await? {
            // Compute model bounds from element bounds
            let mut min = [f64::INFINITY; 3];
            let mut max = [f64::NEG_INFINITY; 3];
            for bounds in zone_ref.element_bounds.values() {
                min[0] = min[0].min(bounds[0] as f64);
                min[1] = min[1].min(bounds[1] as f64);
                min[2] = min[2].min(bounds[2] as f64);
                max[0] = max[0].max(bounds[3] as f64);
                max[1] = max[1].max(bounds[4] as f64);
                max[2] = max[2].max(bounds[5] as f64);
            }

            if min[0].is_finite() {
                models.push((key.to_string(), [min[0], min[1], min[2], max[0], max[1], max[2]]));
            }
        }
    }

    if models.is_empty() {
        return Err(ApiError::NotFound(
            "No processed models found. Parse models first.".to_string(),
        ));
    }

    let tileset_json = tileset_builder::build_federated_tileset(&models);
    let tileset_bytes = serde_json::to_vec_pretty(&tileset_json)?;

    build_json_response(&tileset_bytes, "public, max-age=600")
}

/// POST /api/v1/tiles/{model_key}/warm
///
/// Triggers background pre-generation of all tile GLBs for a model.
/// Returns 202 Accepted immediately.
pub async fn warm_tiles(
    State(state): State<AppState>,
    Path(model_key): Path<String>,
) -> Result<Response, ApiError> {
    let zone_ref = get_or_create_zone_reference(&state, &model_key).await?;

    let state_clone = state.clone();
    let model_key_clone = model_key.clone();
    tokio::spawn(async move {
        prewarm_tiles(&state_clone, &model_key_clone, &zone_ref).await;
    });

    let response = Response::builder()
        .status(StatusCode::ACCEPTED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"status":"accepted","message":"Tile pre-warming started"}"#))
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(response)
}

// --- Helper functions ---

/// Get or lazily create a zone reference for a model.
async fn get_or_create_zone_reference(
    state: &AppState,
    model_key: &str,
) -> Result<ZoneReference, ApiError> {
    let zone_key = zone_reference::zone_cache_key(model_key);

    // Check zone cache
    if let Some(zone_ref) = state.cache.get::<ZoneReference>(&zone_key).await? {
        return Ok(zone_ref);
    }

    // Need to build: check that model has been parsed
    let parquet_cache_key = format!("{}-parquet-v3", model_key);
    let cached_parquet = state
        .cache
        .get_bytes(&parquet_cache_key)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(
                "Model not processed. POST to /api/v1/parse first.".to_string(),
            )
        })?;

    // Extract mesh bounds from parquet (blocking)
    let cached_parquet_clone = cached_parquet.clone();
    let mesh_bounds = tokio::task::spawn_blocking(move || {
        parquet_reader::extract_mesh_bounds(&cached_parquet_clone)
            .map_err(|e| ApiError::Processing(format!("Failed to extract mesh bounds: {}", e)))
    })
    .await??;

    // Extract data model for spatial hierarchy
    let dm_cache_key = format!("{}-datamodel-v2", model_key);
    let data_model = if let Some(_dm_bytes) = state.cache.get_bytes(&dm_cache_key).await? {
        // We have cached data model parquet, but we need the DataModel struct.
        // For now, re-extract from IFC content if available in JSON cache.
        // The data model is small enough to cache as JSON too.
        let dm_json_key = format!("{}-datamodel-json-v1", model_key);
        if let Some(dm) = state.cache.get::<crate::services::data_model::DataModel>(&dm_json_key).await? {
            dm
        } else {
            // Fallback: create minimal zone reference without spatial hierarchy
            tracing::warn!("Data model not available as JSON, using flat zone assignment");
            let model_hash = model_key.to_string();
            let zone_ref = tokio::task::spawn_blocking(move || {
                // Create a minimal DataModel with empty spatial hierarchy
                let empty_dm = crate::services::data_model::DataModel {
                    entities: Vec::new(),
                    property_sets: Vec::new(),
                    quantity_sets: Vec::new(),
                    relationships: Vec::new(),
                    spatial_hierarchy: crate::services::data_model::SpatialHierarchyData {
                        nodes: Vec::new(),
                        project_id: 0,
                        element_to_storey: Vec::new(),
                        element_to_building: Vec::new(),
                        element_to_site: Vec::new(),
                        element_to_space: Vec::new(),
                    },
                };
                zone_reference::extract_zone_reference(&model_hash, &empty_dm, &mesh_bounds)
            })
            .await?;

            // Cache zone reference
            let cache = state.cache.clone();
            let zone_key_clone = zone_key.clone();
            let zone_ref_clone = zone_ref.clone();
            tokio::spawn(async move {
                if let Err(e) = cache.set(&zone_key_clone, &zone_ref_clone).await {
                    tracing::error!(error = %e, "Failed to cache zone reference");
                }
            });

            return Ok(zone_ref);
        }
    } else {
        // No data model at all — create flat zone reference
        tracing::warn!("No data model cached, using flat zone assignment");
        let model_hash = model_key.to_string();
        let zone_ref = tokio::task::spawn_blocking(move || {
            let empty_dm = crate::services::data_model::DataModel {
                entities: Vec::new(),
                property_sets: Vec::new(),
                quantity_sets: Vec::new(),
                relationships: Vec::new(),
                spatial_hierarchy: crate::services::data_model::SpatialHierarchyData {
                    nodes: Vec::new(),
                    project_id: 0,
                    element_to_storey: Vec::new(),
                    element_to_building: Vec::new(),
                    element_to_site: Vec::new(),
                    element_to_space: Vec::new(),
                },
            };
            zone_reference::extract_zone_reference(&model_hash, &empty_dm, &mesh_bounds)
        })
        .await?;

        let cache = state.cache.clone();
        let zone_key_clone = zone_key.clone();
        let zone_ref_clone = zone_ref.clone();
        tokio::spawn(async move {
            if let Err(e) = cache.set(&zone_key_clone, &zone_ref_clone).await {
                tracing::error!(error = %e, "Failed to cache zone reference");
            }
        });

        return Ok(zone_ref);
    };

    // Build zone reference with full data model
    let model_hash = model_key.to_string();
    let zone_ref = tokio::task::spawn_blocking(move || {
        zone_reference::extract_zone_reference(&model_hash, &data_model, &mesh_bounds)
    })
    .await?;

    // Cache
    let cache = state.cache.clone();
    let zone_key_clone = zone_key;
    let zone_ref_clone = zone_ref.clone();
    tokio::spawn(async move {
        if let Err(e) = cache.set(&zone_key_clone, &zone_ref_clone).await {
            tracing::error!(error = %e, "Failed to cache zone reference");
        }
    });

    Ok(zone_ref)
}

/// Pre-warm all tile GLBs for a model in the background.
async fn prewarm_tiles(state: &AppState, model_key: &str, zone_ref: &ZoneReference) {
    tracing::info!(model_key = %model_key, "Starting tile pre-warming");

    let parquet_cache_key = format!("{}-parquet-v3", model_key);
    let cached_parquet = match state.cache.get_bytes(&parquet_cache_key).await {
        Ok(Some(data)) => data,
        _ => {
            tracing::warn!("Cannot pre-warm: parquet cache not found");
            return;
        }
    };

    let mut tiles_generated = 0usize;
    let mut tiles_skipped = 0usize;

    // Iterate all (zone, class) pairs
    for zone in &zone_ref.zones {
        let zone_elements: HashSet<u32> = zone_ref
            .element_zone_map
            .iter()
            .filter(|(_, zid)| **zid == zone.id)
            .map(|(&eid, _)| eid)
            .collect();

        for (ifc_class, class_elements) in &zone_ref.ifc_class_index {
            let target_ids: HashSet<u32> = class_elements
                .iter()
                .copied()
                .filter(|eid| zone_elements.contains(eid))
                .collect();

            if target_ids.is_empty() {
                continue;
            }

            let tile_key = glb_builder::tile_cache_key(model_key, &zone.id, ifc_class);

            // Skip if already cached
            if state.cache.has(&tile_key).await {
                tiles_skipped += 1;
                continue;
            }

            // Build GLB
            let parquet_data = cached_parquet.clone();
            let ids = target_ids;
            match tokio::task::spawn_blocking(move || {
                parquet_reader::extract_meshes_by_ids(&parquet_data, &ids)
                    .map(|meshes| glb_builder::build_glb(&meshes))
            })
            .await
            {
                Ok(Ok(glb_bytes)) => {
                    if let Err(e) = state.cache.set_bytes(&tile_key, &glb_bytes).await {
                        tracing::error!(error = %e, tile = %tile_key, "Failed to cache pre-warmed tile");
                    } else {
                        tiles_generated += 1;
                    }
                }
                Ok(Err(e)) => {
                    tracing::error!(error = %e, "Failed to extract meshes for pre-warming");
                }
                Err(e) => {
                    tracing::error!(error = %e, "Task join error during pre-warming");
                }
            }
        }
    }

    tracing::info!(
        model_key = %model_key,
        tiles_generated = tiles_generated,
        tiles_skipped = tiles_skipped,
        "Tile pre-warming complete"
    );
}

/// Build a JSON response with cache headers.
fn build_json_response(data: &[u8], cache_control: &str) -> Result<Response, ApiError> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data.to_vec()))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

/// Build a GLB response with cache headers.
fn build_glb_response(data: Vec<u8>, cache_control: &str) -> Result<Response, ApiError> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "model/gltf-binary")
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

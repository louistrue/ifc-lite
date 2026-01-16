// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Cache retrieval endpoint.

use crate::error::ApiError;
use crate::types::ParseResponse;
use crate::AppState;
use axum::{
    extract::{Path, State},
    Json,
};

/// GET /api/v1/cache/:key - Retrieve cached result.
pub async fn get_cached(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ParseResponse>, ApiError> {
    tracing::debug!(key = %key, "Cache lookup");

    match state.cache.get::<ParseResponse>(&key).await? {
        Some(mut response) => {
            response.stats.from_cache = true;
            tracing::info!(key = %key, "Cache HIT");
            Ok(Json(response))
        }
        None => {
            tracing::debug!(key = %key, "Cache MISS");
            Err(ApiError::NotFound(format!("Cache key not found: {}", key)))
        }
    }
}

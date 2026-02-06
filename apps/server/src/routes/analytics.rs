// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Analytics API routes — publish models, check status, get guest tokens.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::services::analytics::{self, AnalyticsError, PublishStatus};
use crate::services::superset_api::{detect_model_type, SupersetClient};
use crate::AppState;

/// Response from the dashboard endpoint.
#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub dashboard_id: Option<i32>,
    pub dashboard_url: Option<String>,
}

/// Request body for the publish endpoint.
#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    pub file_name: Option<String>,
}

/// Response from the publish endpoint.
#[derive(Debug, Serialize)]
pub struct PublishResponse {
    pub model_id: String,
    pub status: String,
    pub dataset_id: Option<i32>,
    pub dashboard_id: Option<i32>,
    pub dashboard_url: Option<String>,
}

/// Response from the status endpoint.
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String,
    pub model_id: Option<String>,
    pub dashboard_url: Option<String>,
}

/// Response from the guest-token endpoint.
#[derive(Debug, Serialize)]
pub struct GuestTokenResponse {
    pub token: String,
}

/// POST /api/v1/analytics/publish/:cache_key
///
/// Publishes a parsed model's DataModel to PostgreSQL and optionally
/// creates Superset datasets/dashboards.
pub async fn publish(
    State(state): State<AppState>,
    Path(cache_key): Path<String>,
    Json(body): Json<PublishRequest>,
) -> Result<impl IntoResponse, AnalyticsResponse> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or(AnalyticsResponse::not_configured())?;

    // Check if already published
    if let Some(existing) = analytics::check_published(pool, &cache_key).await? {
        return Ok(Json(PublishResponse {
            model_id: existing.model_id.to_string(),
            status: "already_exists".to_string(),
            dataset_id: existing.superset_dataset_id,
            dashboard_id: existing.superset_dashboard_id,
            dashboard_url: existing.dashboard_url,
        }));
    }

    // Fetch the DataModel from cache
    let datamodel_key = format!("{}-datamodel-v2", cache_key);
    let dm_bytes = state
        .cache
        .get_bytes(&datamodel_key)
        .await
        .map_err(|e| AnalyticsResponse::internal(format!("Cache error: {e}")))?
        .ok_or(AnalyticsResponse::data_model_not_found())?;

    // Fetch model metadata from cache (stored as raw bytes)
    let metadata_key = format!("{}-parquet-metadata-v2", cache_key);
    let metadata_bytes = state
        .cache
        .get_bytes(&metadata_key)
        .await
        .map_err(|e| AnalyticsResponse::internal(format!("Cache error: {e}")))?
        .ok_or_else(|| {
            AnalyticsResponse::internal("Model metadata not found in cache".to_string())
        })?;
    let metadata_json = String::from_utf8(metadata_bytes)
        .map_err(|e| AnalyticsResponse::internal(format!("Metadata is not valid UTF-8: {e}")))?;
    // The cached metadata is a ParquetMetadataHeader containing ModelMetadata
    let metadata_header: crate::routes::parse::ParquetMetadataHeader =
        serde_json::from_str(&metadata_json).map_err(|e| {
            AnalyticsResponse::internal(format!("Failed to parse model metadata: {e}"))
        })?;
    let metadata = metadata_header.metadata;

    // Deserialize DataModel from Parquet
    let data_model = crate::services::parquet_data_model::deserialize_data_model_from_parquet(
        &dm_bytes,
    )
    .map_err(|e| {
        AnalyticsResponse::internal(format!("Failed to deserialize data model: {e}"))
    })?;

    // Publish to PostgreSQL
    let model_id = analytics::publish_model(
        pool,
        &cache_key,
        &data_model,
        &metadata,
        body.file_name.as_deref(),
    )
    .await?;

    // Optionally create Superset resources
    let mut dataset_id = None;
    let mut dashboard_id = None;
    let mut dashboard_url = None;

    if let (Some(superset_url), Some(username), Some(password), Some(db_id)) = (
        &state.config.superset_url,
        &state.config.superset_username,
        &state.config.superset_password,
        state.config.superset_database_id,
    ) {
        let model_name = body
            .file_name
            .as_deref()
            .unwrap_or("Untitled Model");

        let mut client = SupersetClient::new(superset_url, username, password, db_id);

        // Detect model type from entity distribution for chart template selection
        let model_type = detect_model_type(&data_model);
        tracing::info!(?model_type, "Detected model type for Superset chart selection");

        match client
            .create_all_resources(&model_id, model_name, model_type)
            .await
        {
            Ok(resources) => {
                // Update the model record with Superset IDs
                analytics::update_superset_ids(
                    pool,
                    model_id,
                    resources.dataset_id,
                    resources.dashboard_id,
                )
                .await
                .ok(); // Non-fatal if update fails

                dataset_id = Some(resources.dataset_id);
                dashboard_id = Some(resources.dashboard_id);
                dashboard_url = Some(resources.dashboard_url);
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Failed to create Superset resources (model still published to PostgreSQL)"
                );
            }
        }
    }

    Ok(Json(PublishResponse {
        model_id: model_id.to_string(),
        status: "created".to_string(),
        dataset_id,
        dashboard_id,
        dashboard_url,
    }))
}

/// GET /api/v1/analytics/status/:cache_key
///
/// Check if a model has been published to analytics.
pub async fn status(
    State(state): State<AppState>,
    Path(cache_key): Path<String>,
) -> Result<impl IntoResponse, AnalyticsResponse> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or(AnalyticsResponse::not_configured())?;

    match analytics::check_published(pool, &cache_key).await? {
        Some(result) => Ok(Json(StatusResponse {
            status: match result.status {
                PublishStatus::AlreadyExists => "published".to_string(),
                PublishStatus::Created => "published".to_string(),
            },
            model_id: Some(result.model_id.to_string()),
            dashboard_url: result.dashboard_url,
        })),
        None => Ok(Json(StatusResponse {
            status: "not_published".to_string(),
            model_id: None,
            dashboard_url: None,
        })),
    }
}

/// GET /api/v1/analytics/dashboard/:cache_key
///
/// Get dashboard URL for a published model.
pub async fn dashboard(
    State(state): State<AppState>,
    Path(cache_key): Path<String>,
) -> Result<impl IntoResponse, AnalyticsResponse> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or(AnalyticsResponse::not_configured())?;

    match analytics::check_published(pool, &cache_key).await? {
        Some(result) => {
            let dashboard_url = if let (Some(superset_url), Some(dashboard_id)) =
                (&state.config.superset_url, result.superset_dashboard_id)
            {
                Some(format!(
                    "{}/superset/dashboard/{}/",
                    superset_url, dashboard_id
                ))
            } else {
                result.dashboard_url
            };

            Ok(Json(DashboardResponse {
                dashboard_id: result.superset_dashboard_id,
                dashboard_url,
            }))
        }
        None => Err(AnalyticsResponse {
            status: StatusCode::NOT_FOUND,
            message: "Model not published".into(),
            code: "MODEL_NOT_PUBLISHED".into(),
        }),
    }
}

/// GET /api/v1/analytics/guest-token/:dashboard_id
///
/// Generate a Superset guest token for embedded dashboard access.
pub async fn guest_token(
    State(state): State<AppState>,
    Path(dashboard_id): Path<i32>,
) -> Result<impl IntoResponse, AnalyticsResponse> {
    let (superset_url, username, password, db_id) = match (
        &state.config.superset_url,
        &state.config.superset_username,
        &state.config.superset_password,
        state.config.superset_database_id,
    ) {
        (Some(url), Some(u), Some(p), Some(db)) => (url, u, p, db),
        _ => {
            return Err(AnalyticsResponse {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: "Superset not configured".into(),
                code: "SUPERSET_NOT_CONFIGURED".into(),
            })
        }
    };

    let mut client = SupersetClient::new(superset_url, username, password, db_id);
    client.login().await?;

    let token = client.create_guest_token(dashboard_id).await?;
    Ok(Json(GuestTokenResponse { token }))
}

// ─── Error handling ─────────────────────────────────────────────────────────

/// Error type for analytics routes that implements IntoResponse.
#[derive(Debug)]
pub struct AnalyticsResponse {
    status: StatusCode,
    message: String,
    code: String,
}

impl AnalyticsResponse {
    fn not_configured() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "Analytics not configured (DATABASE_URL not set)".into(),
            code: "ANALYTICS_NOT_CONFIGURED".into(),
        }
    }

    fn data_model_not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "Data model not found in cache. Parse the file first.".into(),
            code: "DATA_MODEL_NOT_FOUND".into(),
        }
    }

    fn internal(message: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message,
            code: "ANALYTICS_ERROR".into(),
        }
    }
}

impl IntoResponse for AnalyticsResponse {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({
            "error": self.message,
            "code": self.code,
        });
        (self.status, Json(body)).into_response()
    }
}

impl From<AnalyticsError> for AnalyticsResponse {
    fn from(err: AnalyticsError) -> Self {
        match &err {
            AnalyticsError::NotConfigured => Self::not_configured(),
            AnalyticsError::DataModelNotFound => Self::data_model_not_found(),
            AnalyticsError::Database(e) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("Database error: {e}"),
                code: "DATABASE_ERROR".into(),
            },
            AnalyticsError::Superset(msg) => Self {
                status: StatusCode::BAD_GATEWAY,
                message: format!("Superset error: {msg}"),
                code: "SUPERSET_ERROR".into(),
            },
        }
    }
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Health check endpoint.

use axum::Json;
use serde::Serialize;

/// Health check response.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub service: &'static str,
}

/// GET /api/v1/health - Health check endpoint.
pub async fn check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
        service: "ifc-lite-server",
    })
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! IFC-Lite Server - High-performance IFC processing server.
//!
//! This server provides a REST API for parsing IFC files and extracting
//! geometry. It supports:
//!
//! - Full synchronous parsing with caching
//! - Streaming Server-Sent Events for progressive rendering
//! - Quick metadata extraction without geometry processing
//!
//! # Endpoints
//!
//! - `GET /api/v1/health` - Health check
//! - `POST /api/v1/parse` - Full parse with all geometry (JSON)
//! - `POST /api/v1/parse/stream` - Streaming parse (SSE)
//! - `POST /api/v1/parse/metadata` - Quick metadata only
//! - `POST /api/v1/parse/parquet` - Full parse with Parquet-encoded geometry (~15x smaller)
//! - `POST /api/v1/parse/parquet/optimized` - ara3d BOS-optimized format (~50x smaller)
//! - `GET /api/v1/cache/:key` - Retrieve cached result

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

mod config;
mod error;
mod middleware;
mod routes;
mod services;
mod types;

use config::Config;
use services::cache::DiskCache;

/// Application state shared across handlers.
#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<DiskCache>,
    pub config: Arc<Config>,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=debug,ifc_lite_server=debug".into()),
        )
        .pretty()
        .init();

    let config = Config::from_env();

    tracing::info!(
        port = config.port,
        cache_dir = %config.cache_dir,
        max_file_size_mb = config.max_file_size_mb,
        worker_threads = config.worker_threads,
        batch_size = config.batch_size,
        "Starting IFC-Lite Server"
    );

    // Initialize rayon thread pool
    rayon::ThreadPoolBuilder::new()
        .num_threads(config.worker_threads)
        .build_global()
        .expect("Failed to initialize rayon thread pool");

    // Initialize cache
    let cache = Arc::new(DiskCache::new(&config.cache_dir).await);

    let state = AppState {
        cache,
        config: Arc::new(config.clone()),
    };

    // Build router
    let app = Router::new()
        // Root endpoint - API information
        .route("/", get(routes::health::info))
        // Health check
        .route("/api/v1/health", get(routes::health::check))
        // Parse endpoints
        .route("/api/v1/parse", post(routes::parse::parse_full))
        .route("/api/v1/parse/stream", post(routes::parse::parse_stream))
        .route("/api/v1/parse/parquet-stream", post(routes::parse::parse_parquet_stream))
        .route("/api/v1/parse/metadata", post(routes::parse::parse_metadata))
        .route("/api/v1/parse/parquet", post(routes::parse::parse_parquet))
        .route("/api/v1/parse/parquet/optimized", post(routes::parse::parse_parquet_optimized))
        .route("/api/v1/parse/data-model/:cache_key", get(routes::parse::get_data_model))
        // Cache endpoints
        .route("/api/v1/cache/{key}", get(routes::cache::get_cached))
        .route("/api/v1/cache/check/:hash", get(routes::parse::check_cache))
        .route("/api/v1/cache/geometry/:hash", get(routes::parse::get_cached_geometry))
        // Middleware
        .layer(DefaultBodyLimit::max(config.max_file_size_mb * 1024 * 1024)) // Match max_file_size_mb
        .layer(CompressionLayer::new()) // Compress responses (gzip)
        // Note: Request decompression handled manually in extract_file() to support multipart
        .layer(TimeoutLayer::new(Duration::from_secs(
            config.request_timeout_secs,
        )))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

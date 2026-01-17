// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Disk-based cache service using cacache.

use crate::error::ApiError;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Content-addressable disk cache.
#[derive(Debug, Clone)]
pub struct DiskCache {
    cache_dir: PathBuf,
}

impl DiskCache {
    /// Create a new cache in the specified directory.
    pub async fn new(cache_dir: &str) -> Self {
        let path = PathBuf::from(cache_dir);

        // Create cache directory if it doesn't exist
        if let Err(e) = tokio::fs::create_dir_all(&path).await {
            tracing::warn!(
                error = %e,
                path = %path.display(),
                "Failed to create cache directory"
            );
        }

        Self { cache_dir: path }
    }

    /// Generate a cache key from file content (SHA256 hash).
    pub fn generate_key(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    /// Get a cached value by key.
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, ApiError> {
        match cacache::read(&self.cache_dir, key).await {
            Ok(data) => {
                let value: T = serde_json::from_slice(&data)?;
                Ok(Some(value))
            }
            Err(cacache::Error::EntryNotFound(_, _)) => Ok(None),
            Err(e) => Err(ApiError::Cache(e.to_string())),
        }
    }

    /// Set a cached value.
    pub async fn set<T: Serialize>(&self, key: &str, value: &T) -> Result<(), ApiError> {
        let data = serde_json::to_vec(value)?;
        cacache::write(&self.cache_dir, key, &data).await?;
        tracing::debug!(key = %key, size = data.len(), "Cached result");
        Ok(())
    }

    /// Check if a key exists in the cache.
    pub async fn has(&self, key: &str) -> bool {
        cacache::metadata(&self.cache_dir, key).await.is_ok()
    }

    /// Remove a cached entry.
    #[allow(dead_code)]
    pub async fn remove(&self, key: &str) -> Result<(), ApiError> {
        cacache::remove(&self.cache_dir, key).await?;
        Ok(())
    }

    /// Clear all cached entries.
    #[allow(dead_code)]
    pub async fn clear(&self) -> Result<(), ApiError> {
        cacache::clear(&self.cache_dir).await?;
        Ok(())
    }

    /// Get raw bytes from cache (for Parquet responses).
    pub async fn get_bytes(&self, key: &str) -> Result<Option<Vec<u8>>, ApiError> {
        match cacache::read(&self.cache_dir, key).await {
            Ok(data) => Ok(Some(data)),
            Err(cacache::Error::EntryNotFound(_, _)) => Ok(None),
            Err(e) => Err(ApiError::Cache(e.to_string())),
        }
    }

    /// Set raw bytes in cache.
    pub async fn set_bytes(&self, key: &str, data: &[u8]) -> Result<(), ApiError> {
        cacache::write(&self.cache_dir, key, data).await?;
        tracing::debug!(key = %key, size = data.len(), "Cached raw bytes");
        Ok(())
    }
}

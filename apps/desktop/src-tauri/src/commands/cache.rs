// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! File system caching commands
//!
//! Provides persistent caching of processed geometry using the file system
//! instead of IndexedDB (which is used in the web version).

use super::types::{CacheEntry, CacheStats};
use std::path::PathBuf;
use tauri::Manager;

const CACHE_SUBDIR: &str = "geometry-cache";

/// Get cache directory path
fn get_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|p| p.join(CACHE_SUBDIR))
        .map_err(|e| format!("Failed to get cache directory: {}", e))
}

/// Validate cache key to prevent path traversal attacks
fn validate_cache_key(key: &str) -> Result<(), String> {
    // Reject empty keys
    if key.is_empty() {
        return Err("Cache key cannot be empty".to_string());
    }
    // Reject keys with path separators or parent directory references
    if key.contains('/') || key.contains('\\') || key.contains("..") {
        return Err("Invalid cache key: contains path separators or parent references".to_string());
    }
    // Only allow alphanumeric, hyphen, underscore (typical hash characters)
    if !key.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid cache key: contains disallowed characters".to_string());
    }
    Ok(())
}

/// Get the cache file path for a validated key
fn get_cache_file_path(cache_dir: &PathBuf, cache_key: &str) -> Result<PathBuf, String> {
    validate_cache_key(cache_key)?;
    Ok(cache_dir.join(format!("{}.bin", cache_key)))
}

/// Get cached geometry by key
#[tauri::command]
pub async fn get_cached(app: tauri::AppHandle, cache_key: String) -> Result<Option<Vec<u8>>, String> {
    let cache_dir = get_cache_dir(&app)?;
    let cache_file = get_cache_file_path(&cache_dir, &cache_key)?;

    if cache_file.exists() {
        tokio::fs::read(&cache_file)
            .await
            .map(Some)
            .map_err(|e| format!("Failed to read cache: {}", e))
    } else {
        Ok(None)
    }
}

/// Save geometry to cache
#[tauri::command]
pub async fn set_cached(
    app: tauri::AppHandle,
    cache_key: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    let cache_file = get_cache_file_path(&cache_dir, &cache_key)?;

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    tokio::fs::write(&cache_file, &data)
        .await
        .map_err(|e| format!("Failed to write cache: {}", e))
}

/// Clear all cached geometry
#[tauri::command]
pub async fn clear_cache(app: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;

    if cache_dir.exists() {
        tokio::fs::remove_dir_all(&cache_dir)
            .await
            .map_err(|e| format!("Failed to clear cache: {}", e))?;
    }

    Ok(())
}

/// Delete a single cache entry
#[tauri::command]
pub async fn delete_cache_entry(app: tauri::AppHandle, cache_key: String) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    let cache_file = get_cache_file_path(&cache_dir, &cache_key)?;

    // Attempt to remove the file directly, treating NotFound as success
    // (avoids TOCTOU race with exists() check)
    match tokio::fs::remove_file(&cache_file).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete cache entry: {}", e)),
    }
}

/// Get cache statistics
#[tauri::command]
pub async fn get_cache_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let cache_dir = get_cache_dir(&app)?;

    let mut entries = Vec::new();
    let mut total_size: u64 = 0;

    if cache_dir.exists() {
        let mut read_dir = tokio::fs::read_dir(&cache_dir)
            .await
            .map_err(|e| format!("Failed to read cache directory: {}", e))?;

        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read directory entry: {}", e))?
        {
            let path = entry.path();
            if path.extension().map(|e| e == "bin").unwrap_or(false) {
                if let Ok(metadata) = entry.metadata().await {
                    let size = metadata.len();
                    total_size += size;

                    let key = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let created_at = metadata
                        .created()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    entries.push(CacheEntry {
                        key: key.clone(),
                        file_name: format!("{}.ifc", key),
                        file_size: 0, // We don't store original file size
                        cache_size: size,
                        created_at,
                    });
                }
            }
        }
    }

    Ok(CacheStats {
        entry_count: entries.len(),
        total_size,
        entries,
    })
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC loading configuration constants and utilities
 * Extracted from useIfc.ts for reusability
 */

import type { DynamicBatchConfig } from '@ifc-lite/geometry';

// ============================================================================
// Server Configuration
// ============================================================================

/** IFC server URL - only set via environment variable, no default (pure client-side by default) */
export const SERVER_URL = import.meta.env.VITE_IFC_SERVER_URL || import.meta.env.VITE_SERVER_URL || '';

/** Enable server parsing - only if server URL is explicitly configured */
export const USE_SERVER = SERVER_URL !== '' && import.meta.env.VITE_USE_SERVER !== 'false';

// ============================================================================
// File Size Thresholds (in bytes unless noted)
// ============================================================================

/** Minimum file size to cache (10MB) - smaller files parse quickly anyway */
export const CACHE_SIZE_THRESHOLD = 10 * 1024 * 1024;

/** File size thresholds for various optimizations */
export const THRESHOLDS = {
  /** Use streaming Parquet above this (150MB) */
  STREAMING_MB: 150,
  /** Use Parquet vs JSON above this (10MB) */
  PARQUET_MB: 10,
  /** Large file threshold affecting batch sizing (50MB) */
  LARGE_FILE_MB: 50,
  /** Huge file threshold for aggressive batching (100MB) */
  HUGE_FILE_MB: 100,
  /** Don't cache files smaller than this (10MB) */
  CACHE_MIN_MB: 10,
} as const;

// ============================================================================
// Platform Detection
// ============================================================================

/** Detect if running in Tauri (desktop) environment */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// Dynamic Batch Configuration
// ============================================================================

/**
 * Calculate dynamic batch config based on file size
 * Larger files get larger batches for better throughput
 *
 * @param fileSizeMB - File size in megabytes
 * @returns Batch configuration for geometry processing
 */
export function getDynamicBatchConfig(fileSizeMB: number): DynamicBatchConfig {
  if (fileSizeMB < 10) {
    // Small files: smaller batches for responsiveness
    return { initialBatchSize: 50, maxBatchSize: 200, fileSizeMB };
  } else if (fileSizeMB < 50) {
    // Medium files: balanced batching
    return { initialBatchSize: 100, maxBatchSize: 500, fileSizeMB };
  } else if (fileSizeMB < 100) {
    // Large files: larger batches for throughput
    return { initialBatchSize: 100, maxBatchSize: 1000, fileSizeMB };
  } else {
    // Huge files (100MB+): aggressive batching for maximum throughput
    return { initialBatchSize: 100, maxBatchSize: 3000, fileSizeMB };
  }
}

/**
 * Convert bytes to megabytes
 */
export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

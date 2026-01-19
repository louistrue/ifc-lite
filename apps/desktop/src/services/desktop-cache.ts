/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Desktop Cache Service
 *
 * File system-based caching for Tauri desktop apps.
 * Replaces IndexedDB caching used in the web version.
 */

import { invoke } from '@tauri-apps/api/core';

export interface CacheEntry {
  key: string;
  fileName: string;
  fileSize: number;
  cacheSize: number;
  createdAt: number;
}

export interface CacheStats {
  entries: CacheEntry[];
  totalSize: number;
  entryCount: number;
}

/**
 * Get cached data by key
 * @param key Cache key (typically file hash)
 * @returns Cached data as ArrayBuffer, or null if not found
 */
export async function getCached(key: string): Promise<ArrayBuffer | null> {
  try {
    const data = await invoke<number[] | null>('get_cached', { cacheKey: key });
    if (data) {
      return new Uint8Array(data).buffer;
    }
    return null;
  } catch (error) {
    console.warn('[DesktopCache] Failed to get cached data:', error);
    return null;
  }
}

/**
 * Save data to cache
 * @param key Cache key (typically file hash)
 * @param buffer Data to cache
 * @param fileName Original file name (for metadata)
 * @param fileSize Original file size (for metadata)
 */
export async function setCached(
  key: string,
  buffer: ArrayBuffer,
  fileName: string,
  fileSize: number
): Promise<void> {
  try {
    const data = Array.from(new Uint8Array(buffer));
    await invoke('set_cached', { cacheKey: key, data });
  } catch (error) {
    console.warn('[DesktopCache] Failed to save to cache:', error);
  }
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
  try {
    await invoke('clear_cache');
  } catch (error) {
    console.warn('[DesktopCache] Failed to clear cache:', error);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    return await invoke<CacheStats>('get_cache_stats');
  } catch (error) {
    console.warn('[DesktopCache] Failed to get cache stats:', error);
    return { entries: [], totalSize: 0, entryCount: 0 };
  }
}

/**
 * Check if a key exists in cache
 */
export async function hasCached(key: string): Promise<boolean> {
  const data = await getCached(key);
  return data !== null;
}

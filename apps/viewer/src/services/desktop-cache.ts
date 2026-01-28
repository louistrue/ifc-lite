/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Desktop Cache Service
 *
 * File system-based caching for Tauri desktop apps.
 * Replaces IndexedDB caching used in the web version.
 *
 * This module uses dynamic imports to avoid bundler issues in web builds.
 * The @tauri-apps/api package is only loaded at runtime in Tauri environments.
 */

// Tauri API types - dynamically imported to avoid issues in web builds
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;
  // Use globalThis.__TAURI_INTERNALS__ which is set by Tauri runtime
  // This avoids bundler trying to resolve @tauri-apps/api in web builds
  const win = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke: InvokeFn } };
  if (win.__TAURI_INTERNALS__?.invoke) {
    invoke = win.__TAURI_INTERNALS__.invoke;
    return invoke;
  }
  throw new Error('Tauri API not available - this module should only be used in Tauri apps');
}

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

export interface CacheResult {
  buffer: ArrayBuffer;
  sourceBuffer?: ArrayBuffer;
}

/**
 * Get cached data by key
 * @param key Cache key (typically file hash)
 * @returns Cached data as CacheResult, or null if not found
 */
export async function getCached(key: string): Promise<CacheResult | null> {
  try {
    const inv = await getInvoke();
    const data = await inv<number[] | null>('get_cached', { cacheKey: key });
    if (data) {
      console.log(`[DesktopCache] Cache HIT for key: ${key} (${data.length} bytes)`);
      return { buffer: new Uint8Array(data).buffer };
    }
    console.log(`[DesktopCache] Cache MISS for key: ${key}`);
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
 * @param _sourceBuffer Source buffer (not used in desktop cache, but kept for API compatibility)
 */
export async function setCached(
  key: string,
  buffer: ArrayBuffer,
  fileName: string,
  fileSize: number,
  _sourceBuffer?: ArrayBuffer
): Promise<void> {
  try {
    const inv = await getInvoke();
    const data = Array.from(new Uint8Array(buffer));
    console.log(`[DesktopCache] Caching ${fileName} (${data.length} bytes) with key: ${key}`);
    await inv('set_cached', { cacheKey: key, data });
    console.log(`[DesktopCache] Successfully cached ${fileName}`);
  } catch (error) {
    console.warn('[DesktopCache] Failed to save to cache:', error);
  }
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
  try {
    const inv = await getInvoke();
    await inv('clear_cache');
    console.log('[DesktopCache] Cache cleared');
  } catch (error) {
    console.warn('[DesktopCache] Failed to clear cache:', error);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const inv = await getInvoke();
    return await inv<CacheStats>('get_cache_stats');
  } catch (error) {
    console.warn('[DesktopCache] Failed to get cache stats:', error);
    return { entries: [], totalSize: 0, entryCount: 0 };
  }
}

/**
 * Delete a cache entry
 */
export async function deleteCached(key: string): Promise<void> {
  try {
    const inv = await getInvoke();
    await inv('delete_cache_entry', { cacheKey: key });
    console.log('[DesktopCache] Cache entry deleted:', key);
  } catch (error) {
    console.warn('[DesktopCache] Failed to delete cache entry:', error);
  }
}

/**
 * Check if a key exists in cache
 */
export async function hasCached(key: string): Promise<boolean> {
  const data = await getCached(key);
  return data !== null;
}

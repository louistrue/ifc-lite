/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * File system cache service for IFC files (Tauri desktop)
 * 
 * Stores parsed IFC data and geometry in app data directory for fast subsequent loads.
 * Uses xxhash64 of the source file as the cache key.
 */

import * as fs from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

const CACHE_DIR_NAME = 'ifc-lite-cache';

let cacheDirPath: string | null = null;

/**
 * Get the cache directory path, creating it if necessary
 */
async function getCacheDir(): Promise<string> {
  if (cacheDirPath) return cacheDirPath;

  const appDir = await appDataDir();
  cacheDirPath = await join(appDir, CACHE_DIR_NAME);

  // Ensure cache directory exists (writeFile does NOT auto-create parent directories)
  await fs.mkdir(cacheDirPath, { recursive: true });

  return cacheDirPath;
}

/**
 * Get cache file path for a given key
 */
async function getCachePath(key: string): Promise<string> {
  const dir = await getCacheDir();
  return `${dir}/${key}.cache`;
}

/**
 * Get metadata file path for a given key
 */
async function getMetadataPath(key: string): Promise<string> {
  const dir = await getCacheDir();
  return `${dir}/${key}.meta.json`;
}

interface CacheMetadata {
  fileName: string;
  fileSize: number;
  createdAt: number;
}

/**
 * Get a cached model by hash key
 */
export async function getCached(key: string): Promise<ArrayBuffer | null> {
  try {
    const cachePath = await getCachePath(key);
    
    if (!(await fs.exists(cachePath))) {
      return null;
    }

    const data = await fs.readFile(cachePath);
    // Slice to actual data range - Uint8Array.buffer may contain extra bytes
    const buffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);

    console.log(`[FS Cache] Cache hit for key ${key} (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB)`);
    return buffer;
  } catch (err) {
    console.warn('[FS Cache] Cache read failed:', err);
    return null;
  }
}

/**
 * Store a model in the cache
 */
export async function setCached(
  key: string,
  buffer: ArrayBuffer,
  fileName: string,
  fileSize: number
): Promise<void> {
  try {
    const cachePath = await getCachePath(key);
    const metadataPath = await getMetadataPath(key);

    const metadata: CacheMetadata = {
      fileName,
      fileSize,
      createdAt: Date.now(),
    };

    await fs.writeFile(cachePath, new Uint8Array(buffer));
    await fs.writeTextFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`[FS Cache] Cached ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
  } catch (err) {
    console.warn('[FS Cache] Cache write failed:', err);
  }
}

/**
 * Check if a cache entry exists
 */
export async function hasCached(key: string): Promise<boolean> {
  try {
    const cachePath = await getCachePath(key);
    return await fs.exists(cachePath);
  } catch {
    return false;
  }
}

/**
 * Delete a cache entry
 */
export async function deleteCached(key: string): Promise<void> {
  try {
    const cachePath = await getCachePath(key);
    const metadataPath = await getMetadataPath(key);

    if (await fs.exists(cachePath)) {
      await fs.remove(cachePath);
    }
    if (await fs.exists(metadataPath)) {
      await fs.remove(metadataPath);
    }
  } catch (err) {
    console.warn('[FS Cache] Failed to delete cache entry:', err);
  }
}

/**
 * Clear all cached models
 */
export async function clearCache(): Promise<void> {
  try {
    const dir = await getCacheDir();
    if (!(await fs.exists(dir))) {
      return;
    }

    const entries = await fs.readDir(dir);
    for (const entry of entries) {
      if (entry.name) {
        await fs.remove(`${dir}/${entry.name}`);
      }
    }

    console.log('[FS Cache] Cache cleared');
  } catch (err) {
    console.warn('[FS Cache] Failed to clear cache:', err);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  entryCount: number;
  totalSize: number;
  entries: Array<{ fileName: string; fileSize: number; createdAt: Date }>;
}> {
  try {
    const dir = await getCacheDir();
    if (!(await fs.exists(dir))) {
      return { entryCount: 0, totalSize: 0, entries: [] };
    }

    const entries = await fs.readDir(dir);
    const metadataFiles = entries.filter((e) => e.name?.endsWith('.meta.json'));

    const stats = {
      entryCount: 0,
      totalSize: 0,
      entries: [] as Array<{ fileName: string; fileSize: number; createdAt: Date }>,
    };

    for (const metaFile of metadataFiles) {
      try {
        const metaPath = `${dir}/${metaFile.name}`;
        const metaContent = await fs.readTextFile(metaPath);
        const metadata: CacheMetadata = JSON.parse(metaContent);

        const cacheKey = metaFile.name!.replace('.meta.json', '');
        const cachePath = await getCachePath(cacheKey);
        
        if (await fs.exists(cachePath)) {
          const cacheData = await fs.readFile(cachePath);
          stats.entryCount++;
          stats.totalSize += cacheData.byteLength;
          stats.entries.push({
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            createdAt: new Date(metadata.createdAt),
          });
        }
      } catch (err) {
        console.warn(`[FS Cache] Failed to read metadata for ${metaFile.name}:`, err);
      }
    }

    return stats;
  } catch {
    return { entryCount: 0, totalSize: 0, entries: [] };
  }
}

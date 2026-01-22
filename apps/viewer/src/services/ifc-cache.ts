/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IndexedDB cache service for IFC files
 *
 * Stores parsed IFC data and geometry in IndexedDB for fast subsequent loads.
 * Uses xxhash64 of the source file as the cache key.
 */

const DB_NAME = 'ifc-lite-cache';
const DB_VERSION = 1;
const STORE_NAME = 'models';

interface CacheEntry {
  key: string;
  buffer: ArrayBuffer;
  sourceBuffer?: ArrayBuffer; // Original IFC source for on-demand property extraction
  fileName: string;
  fileSize: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IFC Cache] Failed to open database:', request.error);
      dbPromise = null; // Reset so we can retry
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      
      // Verify the object store exists (handles corrupted DB state)
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        console.warn('[IFC Cache] Object store missing, recreating database...');
        db.close();
        dbPromise = null;
        
        // Delete and recreate the database
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => {
          // Retry opening after deletion
          openDatabase().then(resolve).catch(reject);
        };
        deleteRequest.onerror = () => {
          reject(new Error('Failed to recreate database'));
        };
        return;
      }
      
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store for cached models
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('fileName', 'fileName', { unique: false });
      }
    };
  });

  return dbPromise;
}

export interface CacheResult {
  buffer: ArrayBuffer;
  sourceBuffer?: ArrayBuffer;
}

/**
 * Get a cached model by hash key
 */
export async function getCached(key: string): Promise<CacheResult | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        if (entry) {
          resolve({
            buffer: entry.buffer,
            sourceBuffer: entry.sourceBuffer,
          });
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('[IFC Cache] Failed to get cache entry:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[IFC Cache] Cache read failed:', err);
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
  fileSize: number,
  sourceBuffer?: ArrayBuffer
): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const entry: CacheEntry = {
        key,
        buffer,
        sourceBuffer,
        fileName,
        fileSize,
        createdAt: Date.now(),
      };

      const request = store.put(entry);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('[IFC Cache] Failed to cache entry:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[IFC Cache] Cache write failed:', err);
  }
}

/**
 * Check if a cache entry exists
 */
export async function hasCached(key: string): Promise<boolean> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count(IDBKeyRange.only(key));

      request.onsuccess = () => {
        resolve(request.result > 0);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Delete a cache entry
 */
export async function deleteCached(key: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IFC Cache] Failed to delete cache entry:', err);
  }
}

/**
 * Clear all cached models
 */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IFC Cache] Failed to clear cache:', err);
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
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        resolve({
          entryCount: entries.length,
          totalSize: entries.reduce((sum, e) => sum + e.buffer.byteLength, 0),
          entries: entries.map((e) => ({
            fileName: e.fileName,
            fileSize: e.fileSize,
            createdAt: new Date(e.createdAt),
          })),
        });
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return { entryCount: 0, totalSize: 0, entries: [] };
  }
}

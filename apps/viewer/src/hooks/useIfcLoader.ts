/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files (single-model path)
 * Handles format detection, WASM geometry streaming, IFC parsing,
 * cache management, and server-side parsing delegation
 *
 * Extracted from useIfc.ts for better separation of concerns
 */

import { useCallback } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser, detectFormat, parseIfcx, type IfcDataStore } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality, type MeshData, type CoordinateInfo } from '@ifc-lite/geometry';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import { type GeometryData, loadGLBToMeshData } from '@ifc-lite/cache';

import { SERVER_URL, USE_SERVER, CACHE_SIZE_THRESHOLD, getDynamicBatchConfig } from '../utils/ifcConfig.js';
import {
  calculateMeshBounds,
  createCoordinateInfo,
  getRenderIntervalMs,
  calculateStoreyHeights,
  normalizeColor,
} from '../utils/localParsingUtils.js';

// Cache hook
import { useIfcCache, getCached } from './useIfcCache.js';

// Server hook
import { useIfcServer } from './useIfcServer.js';

// Import IfcxDataStore type from federation hook
import type { IfcxDataStore } from './useIfcFederation.js';

/**
 * Hook providing file loading operations for single-model path
 * Includes binary cache support for fast subsequent loads
 */
export function useIfcLoader() {
  const {
    setLoading,
    setError,
    setProgress,
    setIfcDataStore,
    setGeometryResult,
    appendGeometryBatch,
    updateMeshColors,
    updateCoordinateInfo,
  } = useViewerStore();

  // Cache operations from extracted hook
  const { loadFromCache, saveToCache } = useIfcCache();

  // Server operations from extracted hook
  const { loadFromServer } = useIfcServer();

  const loadFile = useCallback(async (file: File) => {
    const { resetViewerState, clearAllModels } = useViewerStore.getState();

    // Track total elapsed time for complete user experience
    const totalStartTime = performance.now();

    try {
      // Reset all viewer state before loading new file
      // Also clear models Map to ensure clean single-file state
      resetViewerState();
      clearAllModels();

      setLoading(true);
      setError(null);
      setProgress({ phase: 'Loading file', percent: 0 });

      // Read file from disk
      const buffer = await file.arrayBuffer();
      const fileSizeMB = buffer.byteLength / (1024 * 1024);

      // Detect file format (IFCX/IFC5 vs IFC4 STEP vs GLB)
      const format = detectFormat(buffer);

      // IFCX files must be parsed client-side (server only supports IFC4 STEP)
      if (format === 'ifcx') {
        setProgress({ phase: 'Parsing IFCX (client-side)', percent: 10 });

        try {
          const ifcxResult = await parseIfcx(buffer, {
            onProgress: (prog: { phase: string; percent: number }) => {
              setProgress({ phase: `IFCX ${prog.phase}`, percent: 10 + (prog.percent * 0.8) });
            },
          });

          // Convert IFCX meshes to viewer format
          // Note: IFCX geometry extractor already handles Y-up to Z-up conversion
          // and applies transforms correctly in Z-up space, so we just pass through

          const meshes: MeshData[] = ifcxResult.meshes.map((m: { expressId?: number; express_id?: number; id?: number; positions: Float32Array | number[]; indices: Uint32Array | number[]; normals: Float32Array | number[]; color?: [number, number, number, number] | [number, number, number]; ifcType?: string; ifc_type?: string }) => {
            // IFCX MeshData has: expressId, ifcType, positions (Float32Array), indices (Uint32Array), normals (Float32Array), color
            const positions = m.positions instanceof Float32Array ? m.positions : new Float32Array(m.positions || []);
            const indices = m.indices instanceof Uint32Array ? m.indices : new Uint32Array(m.indices || []);
            const normals = m.normals instanceof Float32Array ? m.normals : new Float32Array(m.normals || []);

            // Normalize color to RGBA format (4 elements)
            const color = normalizeColor(m.color);

            return {
              expressId: m.expressId || m.express_id || m.id || 0,
              positions,
              indices,
              normals,
              color,
              ifcType: m.ifcType || m.ifc_type || 'IfcProduct',
            };
          }).filter((m: MeshData) => m.positions.length > 0 && m.indices.length > 0); // Filter out empty meshes

          // Check if this is an overlay-only file (no geometry)
          if (meshes.length === 0) {
            console.warn(`[useIfc] IFCX file "${file.name}" has no geometry - this appears to be an overlay file that adds properties to a base model.`);
            console.warn('[useIfc] To use this file, load it together with a base IFCX file (select both files at once).');

            // Check if file has data references that suggest it's an overlay
            const hasReferences = ifcxResult.entityCount > 0;
            if (hasReferences) {
              setError(`"${file.name}" is an overlay file with no geometry. Please load it together with a base IFCX file (select all files at once).`);
              setLoading(false);
              return;
            }
          }

          // Calculate bounds and statistics
          const { bounds, stats } = calculateMeshBounds(meshes);
          const coordinateInfo = createCoordinateInfo(bounds);

          setGeometryResult({
            meshes,
            totalVertices: stats.totalVertices,
            totalTriangles: stats.totalTriangles,
            coordinateInfo,
          });

          // Convert IFCX data model to IfcDataStore format
          // IFCX already provides entities, properties, quantities, relationships, spatialHierarchy
          const dataStore = {
            fileSize: ifcxResult.fileSize,
            schemaVersion: 'IFC5' as const,
            entityCount: ifcxResult.entityCount,
            parseTime: ifcxResult.parseTime,
            source: new Uint8Array(buffer),
            entityIndex: {
              byId: new Map(),
              byType: new Map(),
            },
            strings: ifcxResult.strings,
            entities: ifcxResult.entities,
            properties: ifcxResult.properties,
            quantities: ifcxResult.quantities,
            relationships: ifcxResult.relationships,
            spatialHierarchy: ifcxResult.spatialHierarchy,
          } as IfcxDataStore;

          // Cast to IfcDataStore for store compatibility (IFC5 schema extension)
          setIfcDataStore(dataStore as unknown as IfcDataStore);

          setProgress({ phase: 'Complete', percent: 100 });
          setLoading(false);
          return;
        } catch (err: unknown) {
          console.error('[useIfc] IFCX parsing failed:', err);
          const message = err instanceof Error ? err.message : String(err);
          setError(`IFCX parsing failed: ${message}`);
          setLoading(false);
          return;
        }
      }

      // GLB files: parse directly to MeshData (no data model, geometry only)
      if (format === 'glb') {
        setProgress({ phase: 'Parsing GLB', percent: 10 });

        try {
          const meshes = loadGLBToMeshData(new Uint8Array(buffer));

          if (meshes.length === 0) {
            setError('GLB file contains no geometry');
            setLoading(false);
            return;
          }

          const { bounds, stats } = calculateMeshBounds(meshes);
          const coordinateInfo = createCoordinateInfo(bounds);

          setGeometryResult({
            meshes,
            totalVertices: stats.totalVertices,
            totalTriangles: stats.totalTriangles,
            coordinateInfo,
          });

          // GLB files have no IFC data model - set a minimal store
          setIfcDataStore(null);

          setProgress({ phase: 'Complete', percent: 100 });

          const totalElapsedMs = performance.now() - totalStartTime;
          console.log(`[useIfc] GLB loaded: ${meshes.length} meshes, ${stats.totalTriangles} triangles in ${totalElapsedMs.toFixed(0)}ms`);
          setLoading(false);
          return;
        } catch (err: unknown) {
          console.error('[useIfc] GLB parsing failed:', err);
          const message = err instanceof Error ? err.message : String(err);
          setError(`GLB parsing failed: ${message}`);
          setLoading(false);
          return;
        }
      }

      // INSTANT cache lookup: Use filename + size + format version as key (no hashing!)
      // Same filename + same size = same file (fast and reliable enough)
      // Include format version to invalidate old caches when format changes
      const cacheKey = `${file.name}-${buffer.byteLength}-v3`;

      if (buffer.byteLength >= CACHE_SIZE_THRESHOLD) {
        setProgress({ phase: 'Checking cache', percent: 5 });
        const cacheResult = await getCached(cacheKey);
        if (cacheResult) {
          const success = await loadFromCache(cacheResult, file.name, cacheKey);
          if (success) {
            const totalElapsedMs = performance.now() - totalStartTime;
            console.log(`[useIfc] TOTAL LOAD TIME (from cache): ${totalElapsedMs.toFixed(0)}ms (${(totalElapsedMs / 1000).toFixed(1)}s)`);
            setLoading(false);
            return;
          }
        }
      }

      // Try server parsing first (enabled by default for multi-core performance)
      // Only for IFC4 STEP files (server doesn't support IFCX)
      if (format === 'ifc' && USE_SERVER && SERVER_URL && SERVER_URL !== '') {
        // Pass buffer directly - server uses File object for parsing, buffer is only for size checks
        const serverSuccess = await loadFromServer(file, buffer);
        if (serverSuccess) {
          const totalElapsedMs = performance.now() - totalStartTime;
          console.log(`[useIfc] TOTAL LOAD TIME (server): ${totalElapsedMs.toFixed(0)}ms (${(totalElapsedMs / 1000).toFixed(1)}s)`);
          setLoading(false);
          return;
        }
        // Server not available - continue with local WASM (no error logging needed)
      } else if (format === 'unknown') {
        console.warn('[useIfc] Unknown file format - attempting to parse as IFC4 STEP');
      }

      // Using local WASM parsing
      setProgress({ phase: 'Starting geometry streaming', percent: 10 });

      // Initialize geometry processor first (WASM init is fast if already loaded)
      const geometryProcessor = new GeometryProcessor({
        quality: GeometryQuality.Balanced
      });
      await geometryProcessor.init();

      // DEFER data model parsing - start it AFTER geometry streaming begins
      // This ensures geometry gets first crack at the CPU for fast first frame
      // Data model parsing is lower priority - UI can work without it initially
      let resolveDataStore: (dataStore: IfcDataStore) => void;
      let rejectDataStore: (err: unknown) => void;
      const dataStorePromise = new Promise<IfcDataStore>((resolve, reject) => {
        resolveDataStore = resolve;
        rejectDataStore = reject;
      });

      const startDataModelParsing = () => {
        // Use main thread - worker parsing disabled (IfcDataStore has closures that can't be serialized)
        const parser = new IfcParser();
        const wasmApi = geometryProcessor.getApi();
        parser.parseColumnar(buffer, {
          wasmApi, // Pass WASM API for 5-10x faster entity scanning
        }).then(dataStore => {

          // Calculate storey heights from elevation differences if not already populated
          if (dataStore.spatialHierarchy && dataStore.spatialHierarchy.storeyHeights.size === 0 && dataStore.spatialHierarchy.storeyElevations.size > 1) {
            const calculatedHeights = calculateStoreyHeights(dataStore.spatialHierarchy.storeyElevations);
            for (const [storeyId, height] of calculatedHeights) {
              dataStore.spatialHierarchy.storeyHeights.set(storeyId, height);
            }
          }

          setIfcDataStore(dataStore);
          resolveDataStore(dataStore);
        }).catch(err => {
          console.error('[useIfc] Data model parsing failed:', err);
          rejectDataStore(err);
        });
      };

      // Schedule data model parsing to start after geometry begins streaming
      setTimeout(startDataModelParsing, 0);

      // Use adaptive processing: sync for small files, streaming for large files
      let estimatedTotal = 0;
      let totalMeshes = 0;
      const allMeshes: MeshData[] = []; // Collect all meshes for BVH building
      let finalCoordinateInfo: CoordinateInfo | null = null;
      // Capture RTC offset from WASM for proper multi-model alignment
      let capturedRtcOffset: { x: number; y: number; z: number } | null = null;

      // Clear existing geometry result
      setGeometryResult(null);

      // Timing instrumentation
      const processingStart = performance.now();
      let batchCount = 0;
      let lastBatchTime = processingStart;
      let totalWaitTime = 0; // Time waiting for WASM to yield batches
      let totalProcessTime = 0; // Time processing batches in JS
      let firstGeometryTime = 0; // Time to first rendered geometry

      // OPTIMIZATION: Accumulate meshes and batch state updates
      // First batch renders immediately, then accumulate for throughput
      // Adaptive interval: larger files get less frequent updates to reduce React re-render overhead
      let pendingMeshes: MeshData[] = [];
      let lastRenderTime = 0;
      const RENDER_INTERVAL_MS = getRenderIntervalMs(fileSizeMB);

      try {
        // Use dynamic batch sizing for optimal throughput
        const dynamicBatchConfig = getDynamicBatchConfig(fileSizeMB);

        for await (const event of geometryProcessor.processAdaptive(new Uint8Array(buffer), {
          sizeThreshold: 2 * 1024 * 1024, // 2MB threshold
          batchSize: dynamicBatchConfig, // Dynamic batches: small first, then large
        })) {
          const eventReceived = performance.now();
          const waitTime = eventReceived - lastBatchTime;

          switch (event.type) {
            case 'start':
              estimatedTotal = event.totalEstimate;
              break;
            case 'model-open':
              setProgress({ phase: 'Processing geometry', percent: 50 });
              break;
            case 'colorUpdate': {
              // Update colors for already-rendered meshes
              updateMeshColors(event.updates);
              break;
            }
            case 'rtcOffset': {
              // Capture RTC offset from WASM for multi-model alignment
              if (event.hasRtc) {
                capturedRtcOffset = event.rtcOffset;
              }
              break;
            }
            case 'batch': {
              batchCount++;
              totalWaitTime += waitTime;

              // Track time to first geometry
              if (batchCount === 1) {
                firstGeometryTime = performance.now() - totalStartTime;
              }

              const processStart = performance.now();

              // Collect meshes for BVH building (use loop to avoid stack overflow with large batches)
              for (let i = 0; i < event.meshes.length; i++) allMeshes.push(event.meshes[i]);
              finalCoordinateInfo = event.coordinateInfo ?? null;
              totalMeshes = event.totalSoFar;

              // Accumulate meshes for batched rendering
              for (let i = 0; i < event.meshes.length; i++) pendingMeshes.push(event.meshes[i]);

              // FIRST BATCH: Render immediately for fast first frame
              // SUBSEQUENT: Throttle to reduce React re-renders
              const timeSinceLastRender = eventReceived - lastRenderTime;
              const shouldRender = batchCount === 1 || timeSinceLastRender >= RENDER_INTERVAL_MS;

              if (shouldRender && pendingMeshes.length > 0) {
                appendGeometryBatch(pendingMeshes, event.coordinateInfo);
                pendingMeshes = [];
                lastRenderTime = eventReceived;

                // Update progress
                const progressPercent = 50 + Math.min(45, (totalMeshes / Math.max(estimatedTotal / 10, totalMeshes)) * 45);
                setProgress({
                  phase: `Rendering geometry (${totalMeshes} meshes)`,
                  percent: progressPercent
                });
              }

              const processTime = performance.now() - processStart;
              totalProcessTime += processTime;
              break;
            }
            case 'complete':
              // Flush any remaining pending meshes
              if (pendingMeshes.length > 0) {
                appendGeometryBatch(pendingMeshes, event.coordinateInfo);
                pendingMeshes = [];
              }

              finalCoordinateInfo = event.coordinateInfo ?? null;

              // Store captured RTC offset in coordinate info for multi-model alignment
              if (finalCoordinateInfo && capturedRtcOffset) {
                finalCoordinateInfo.wasmRtcOffset = capturedRtcOffset;
              }

              // Update geometry result with final coordinate info
              updateCoordinateInfo(finalCoordinateInfo);

              setProgress({ phase: 'Complete', percent: 100 });

              // Build spatial index and cache in background (non-blocking)
              // Wait for data model to complete first
              dataStorePromise.then(dataStore => {
                // Build spatial index from meshes (in background)
                if (allMeshes.length > 0) {
                  const buildIndex = () => {
                    try {
                      const spatialIndex = buildSpatialIndex(allMeshes);
                      dataStore.spatialIndex = spatialIndex;
                      setIfcDataStore({ ...dataStore });
                    } catch (err) {
                      console.warn('[useIfc] Failed to build spatial index:', err);
                    }
                  };

                  // Use requestIdleCallback if available (type assertion for optional browser API)
                  if ('requestIdleCallback' in window) {
                    (window as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(buildIndex, { timeout: 2000 });
                  } else {
                    setTimeout(buildIndex, 100);
                  }
                }

                // Cache the result in the background (for files above threshold)
                if (buffer.byteLength >= CACHE_SIZE_THRESHOLD && allMeshes.length > 0 && finalCoordinateInfo) {
                  const geometryData: GeometryData = {
                    meshes: allMeshes,
                    totalVertices: allMeshes.reduce((sum, m) => sum + m.positions.length / 3, 0),
                    totalTriangles: allMeshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
                    coordinateInfo: finalCoordinateInfo,
                  };
                  saveToCache(cacheKey, dataStore, geometryData, buffer, file.name);
                }
              }).catch(err => {
                // Data model parsing failed - spatial index and caching skipped
                console.warn('[useIfc] Skipping spatial index/cache - data model unavailable:', err);
              });
              break;
          }

          lastBatchTime = performance.now();
        }
      } catch (err) {
        console.error('[useIfc] Error in processing:', err);
        setError(err instanceof Error ? err.message : 'Unknown error during geometry processing');
      }

      // Log developer-friendly summary with key metrics
      const totalElapsedMs = performance.now() - totalStartTime;
      const totalVertices = allMeshes.reduce((sum, m) => sum + m.positions.length / 3, 0);
      console.log(
        `[useIfc] ✓ ${file.name} (${fileSizeMB.toFixed(1)}MB) → ` +
        `${allMeshes.length} meshes, ${(totalVertices / 1000).toFixed(0)}k vertices | ` +
        `first: ${firstGeometryTime.toFixed(0)}ms, total: ${totalElapsedMs.toFixed(0)}ms`
      );

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [setLoading, setError, setProgress, setIfcDataStore, setGeometryResult, appendGeometryBatch, updateCoordinateInfo, loadFromCache, saveToCache]);

  return { loadFile };
}

export default useIfcLoader;

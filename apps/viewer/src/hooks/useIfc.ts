/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files
 * Includes binary cache support for fast subsequent loads
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser, detectFormat, parseIfcx, type IfcDataStore } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality, type MeshData, type CoordinateInfo } from '@ifc-lite/geometry';
import { IfcQuery } from '@ifc-lite/query';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import { type GeometryData } from '@ifc-lite/cache';
import { IfcTypeEnum, RelationshipType, IfcTypeEnumFromString, IfcTypeEnumToString, EntityFlags, type SpatialHierarchy, type SpatialNode, type EntityTable, type RelationshipGraph } from '@ifc-lite/data';
import { StringTable } from '@ifc-lite/data';
import { IfcServerClient, decodeDataModel, type ParquetBatch, type DataModel, type ParquetParseResponse, type ParquetStreamResult, type ParseResponse, type ModelMetadata, type ProcessingStats, type MeshData as ServerMeshData } from '@ifc-lite/server-client';

// Extracted utilities
import { SERVER_URL, USE_SERVER, CACHE_SIZE_THRESHOLD, getDynamicBatchConfig } from '../utils/ifcConfig.js';
import { rebuildSpatialHierarchy, rebuildOnDemandMaps } from '../utils/spatialHierarchy.js';
import {
  createEmptyBounds,
  updateBoundsFromPositions,
  calculateMeshBounds,
  createCoordinateInfo,
  getRenderIntervalMs,
  getServerStreamIntervalMs,
  calculateStoreyHeights,
  normalizeColor,
  convertFloatColorToBytes,
} from '../utils/localParsingUtils.js';

// Cache hook
import { useIfcCache, getCached, type CacheResult } from './useIfcCache.js';

// Server data model conversion
import { convertServerDataModel, type ServerParseResult } from '../utils/serverDataModel.js';

// Define QuantitySet type inline (matches server-client's QuantitySet interface)
interface ServerQuantitySet {
  qset_id: number;
  qset_name: string;
  method_of_measurement?: string;
  quantities: Array<{ quantity_name: string; quantity_value: number; quantity_type: string }>;
}

/** Convert server mesh data (snake_case) to viewer format (camelCase) */
function convertServerMesh(m: ServerMeshData): MeshData {
  return {
    expressId: m.express_id,
    positions: new Float32Array(m.positions),
    indices: new Uint32Array(m.indices),
    normals: new Float32Array(m.normals),
    color: m.color,
    ifcType: m.ifc_type,
  };
}

/** Server parse result type - union of streaming and non-streaming responses */
type ServerParseResultType = ParquetParseResponse | ParquetStreamResult | ParseResponse;

// Module-level server availability cache - avoids repeated failed connection attempts
let serverAvailabilityCache: { available: boolean; checkedAt: number } | null = null;
const SERVER_CHECK_CACHE_MS = 30000; // Re-check server availability every 30 seconds

/**
 * Check if server URL is reachable from current origin
 * Returns false immediately if localhost server from non-localhost origin (would cause CORS)
 */
function isServerReachable(serverUrl: string): boolean {
  try {
    const server = new URL(serverUrl);
    const isServerLocalhost = server.hostname === 'localhost' || server.hostname === '127.0.0.1';

    // In browser, check if we're on localhost
    if (typeof window !== 'undefined') {
      const isClientLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

      // Skip localhost server when running from remote origin (avoids CORS error in console)
      if (isServerLocalhost && !isClientLocalhost) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Silently check if server is available (no console logging on failure)
 * Returns cached result if recently checked
 */
async function isServerAvailable(serverUrl: string, client: IfcServerClient): Promise<boolean> {
  // First check if server is even reachable (prevents CORS errors)
  if (!isServerReachable(serverUrl)) {
    return false;
  }

  const now = Date.now();

  // Use cached result if recent
  if (serverAvailabilityCache && (now - serverAvailabilityCache.checkedAt) < SERVER_CHECK_CACHE_MS) {
    return serverAvailabilityCache.available;
  }

  // Perform silent health check
  try {
    await client.health();
    serverAvailabilityCache = { available: true, checkedAt: now };
    return true;
  } catch {
    // Silent failure - don't log network errors for unavailable server
    serverAvailabilityCache = { available: false, checkedAt: now };
    return false;
  }
}

export function useIfc() {
  const {
    loading,
    progress,
    error,
    ifcDataStore,
    geometryResult,
    setLoading,
    setProgress,
    setError,
    setIfcDataStore,
    setGeometryResult,
    appendGeometryBatch,
    updateMeshColors,
    updateCoordinateInfo,
  } = useViewerStore();

  // Track if we've already logged for this ifcDataStore
  const lastLoggedDataStoreRef = useRef<typeof ifcDataStore>(null);

  // Cache operations from extracted hook
  const { loadFromCache, saveToCache } = useIfcCache();

  /**
   * Load from server - uses server-side PARALLEL parsing for maximum speed
   * Uses full parse endpoint (not streaming) for all-at-once parallel processing
   */
  const loadFromServer = useCallback(async (
    file: File,
    buffer: ArrayBuffer
  ): Promise<boolean> => {
    try {
      const serverStart = performance.now();
      setProgress({ phase: 'Connecting to server', percent: 5 });

      const client = new IfcServerClient({ baseUrl: SERVER_URL });

      // Silent server availability check (cached, no error logging)
      const serverAvailable = await isServerAvailable(SERVER_URL, client);
      if (!serverAvailable) {
        return false; // Silently fall back - caller handles logging
      }

      setProgress({ phase: 'Processing on server (parallel)', percent: 15 });

      // Check if Parquet is supported (requires parquet-wasm)
      const parquetSupported = await client.isParquetSupported();

      let allMeshes: MeshData[];
      let result: ServerParseResultType;
      let parseTime: number;
      let convertTime: number;

      // Use streaming for large files (>150MB) for progressive rendering
      // Smaller files use non-streaming path (faster - avoids ~1.1s background re-processing overhead)
      // Streaming overhead: ~67 batch serializations + background re-processing (~1100ms)
      // Non-streaming: single serialization (~218ms for 60k meshes)
      // Threshold chosen to balance UX (progressive rendering) vs performance (overhead)
      const fileSizeMB = buffer.byteLength / (1024 * 1024);
      const USE_STREAMING_THRESHOLD_MB = 150;

      if (parquetSupported && fileSizeMB > USE_STREAMING_THRESHOLD_MB) {
        // STREAMING PATH - for large files, render progressively
        console.log(`[useIfc] Using STREAMING endpoint for large file (${fileSizeMB.toFixed(1)}MB)`);

        allMeshes = [];
        let totalVertices = 0;
        let totalTriangles = 0;
        let cacheKey = '';
        let streamMetadata: ModelMetadata | null = null;
        let streamStats: ProcessingStats | null = null;
        let batchCount = 0;

        // Progressive bounds calculation
        const bounds = createEmptyBounds();

        const parseStart = performance.now();

        // Throttle server streaming updates - large files get less frequent UI updates
        let lastServerStreamRenderTime = 0;
        const SERVER_STREAM_INTERVAL_MS = getServerStreamIntervalMs(fileSizeMB);

        // Use streaming endpoint with batch callback
        const streamResult = await client.parseParquetStream(file, (batch: ParquetBatch) => {
          batchCount++;

          // Convert batch meshes to viewer format (snake_case to camelCase, number[] to TypedArray)
          const batchMeshes: MeshData[] = batch.meshes.map((m: ServerMeshData) => ({
            expressId: m.express_id,
            positions: new Float32Array(m.positions),
            indices: new Uint32Array(m.indices),
            normals: new Float32Array(m.normals),
            color: m.color,
            ifcType: m.ifc_type,
          }));

          // Update bounds incrementally
          for (const mesh of batchMeshes) {
            updateBoundsFromPositions(bounds, mesh.positions);
            totalVertices += mesh.positions.length / 3;
            totalTriangles += mesh.indices.length / 3;
          }

          // Add to collection
          allMeshes.push(...batchMeshes);

          // THROTTLED PROGRESSIVE RENDERING: Update UI at controlled rate
          // First batch renders immediately, subsequent batches throttled
          const now = performance.now();
          const shouldRender = batchCount === 1 || (now - lastServerStreamRenderTime >= SERVER_STREAM_INTERVAL_MS);

          if (shouldRender) {
            lastServerStreamRenderTime = now;

            // Update progress
            setProgress({
              phase: `Streaming batch ${batchCount}`,
              percent: Math.min(15 + (batchCount * 5), 85)
            });

            // PROGRESSIVE RENDERING: Set geometry after each batch
            // This allows the user to see geometry appearing progressively
            const coordinateInfo = {
              originShift: { x: 0, y: 0, z: 0 },
              originalBounds: bounds,
              shiftedBounds: bounds,
              isGeoReferenced: false,
            };

            setGeometryResult({
              meshes: [...allMeshes], // Clone to trigger re-render
              totalVertices,
              totalTriangles,
              coordinateInfo,
            });
          }
        });

        parseTime = performance.now() - parseStart;
        cacheKey = streamResult.cache_key;
        streamMetadata = streamResult.metadata;
        streamStats = streamResult.stats;

        console.log(`[useIfc] Streaming complete in ${parseTime.toFixed(0)}ms`);
        console.log(`  ${batchCount} batches, ${allMeshes.length} meshes`);
        console.log(`  Cache key: ${cacheKey}`);

        // Build final result object for data model fetching
        // Note: meshes field is omitted - allMeshes is passed separately to convertServerDataModel
        result = {
          cache_key: cacheKey,
          metadata: streamMetadata,
          stats: streamStats,
        } as ParquetStreamResult;
        convertTime = 0; // Already converted inline

        // Final geometry set with complete bounds
        const finalCoordinateInfo = {
          originShift: streamMetadata?.coordinate_info?.origin_shift
            ? { x: streamMetadata.coordinate_info.origin_shift[0], y: streamMetadata.coordinate_info.origin_shift[1], z: streamMetadata.coordinate_info.origin_shift[2] }
            : { x: 0, y: 0, z: 0 },
          originalBounds: bounds,
          shiftedBounds: bounds,
          isGeoReferenced: streamMetadata?.coordinate_info?.is_geo_referenced ?? false,
        };

        setGeometryResult({
          meshes: allMeshes,
          totalVertices,
          totalTriangles,
          coordinateInfo: finalCoordinateInfo,
        });

      } else if (parquetSupported) {
        // NON-STREAMING PATH - for smaller files, use batch request (with cache check)
        console.log(`[useIfc] Using PARQUET endpoint - 15x smaller payload, faster transfer`);

        // Use Parquet endpoint - much smaller payload (~15x compression)
        const parseStart = performance.now();
        const parquetResult = await client.parseParquet(file);
        result = parquetResult;
        parseTime = performance.now() - parseStart;

        console.log(`[useIfc] Server parse response received in ${parseTime.toFixed(0)}ms`);
        console.log(`  Server stats: ${parquetResult.stats.total_time_ms}ms total (parse: ${parquetResult.stats.parse_time_ms}ms, geometry: ${parquetResult.stats.geometry_time_ms}ms)`);
        console.log(`  Parquet payload: ${(parquetResult.parquet_stats.payload_size / 1024 / 1024).toFixed(2)}MB, decode: ${parquetResult.parquet_stats.decode_time_ms}ms`);
        console.log(`  Meshes: ${parquetResult.meshes.length}, Vertices: ${parquetResult.stats.total_vertices}, Triangles: ${parquetResult.stats.total_triangles}`);
        console.log(`  Cache key: ${parquetResult.cache_key}`);

        setProgress({ phase: 'Converting meshes', percent: 70 });

        // Convert server mesh format to viewer format (TypedArrays)
        const convertStart = performance.now();
        allMeshes = parquetResult.meshes.map((m: ServerMeshData): MeshData => ({
          expressId: m.express_id,
          positions: new Float32Array(m.positions),
          indices: new Uint32Array(m.indices),
          normals: new Float32Array(m.normals),
          color: m.color,
          ifcType: m.ifc_type,
        }));
        convertTime = performance.now() - convertStart;
        console.log(`[useIfc] Mesh conversion: ${convertTime.toFixed(0)}ms for ${allMeshes.length} meshes`);
      } else {
        console.log(`[useIfc] Parquet not available, using JSON endpoint (install parquet-wasm for 15x faster transfer)`);
        console.log(`[useIfc] Using FULL PARSE (parallel) - all geometry processed at once`);

        // Fallback to JSON endpoint
        const parseStart = performance.now();
        result = await client.parse(file);
        parseTime = performance.now() - parseStart;

        console.log(`[useIfc] Server parse response received in ${parseTime.toFixed(0)}ms`);
        console.log(`  Server stats: ${result.stats.total_time_ms}ms total (parse: ${result.stats.parse_time_ms}ms, geometry: ${result.stats.geometry_time_ms}ms)`);
        console.log(`  Meshes: ${result.meshes.length}, Vertices: ${result.stats.total_vertices}, Triangles: ${result.stats.total_triangles}`);
        console.log(`  Cache key: ${result.cache_key}`);

        setProgress({ phase: 'Converting meshes', percent: 70 });

        // Convert server mesh format to viewer format
        // NOTE: Server sends colors as floats [0-1], viewer expects bytes [0-255]
        const convertStart = performance.now();
        const jsonResult = result as ParseResponse;
        allMeshes = jsonResult.meshes.map((m: ServerMeshData) => ({
          expressId: m.express_id,
          positions: new Float32Array(m.positions),
          indices: new Uint32Array(m.indices),
          normals: m.normals ? new Float32Array(m.normals) : new Float32Array(0),
          color: m.color,
        }));
        convertTime = performance.now() - convertStart;
        console.log(`[useIfc] Mesh conversion: ${convertTime.toFixed(0)}ms for ${allMeshes.length} meshes`);
      }

      // For non-streaming paths, calculate bounds and set geometry
      // (Streaming path already handled this progressively)
      const wasStreaming = parquetSupported && fileSizeMB > USE_STREAMING_THRESHOLD_MB;

      if (!wasStreaming) {
        // Calculate bounds from mesh positions for camera fitting
        // Server sends origin_shift but not shiftedBounds - we need to calculate them
        const { bounds } = calculateMeshBounds(allMeshes);

        // Create proper CoordinateInfo with shiftedBounds for camera fitting
        const serverCoordInfo = result.metadata.coordinate_info;
        const originShift = serverCoordInfo?.origin_shift
          ? { x: serverCoordInfo.origin_shift[0], y: serverCoordInfo.origin_shift[1], z: serverCoordInfo.origin_shift[2] }
          : { x: 0, y: 0, z: 0 };
        const coordinateInfo = createCoordinateInfo(bounds, originShift, serverCoordInfo?.is_geo_referenced ?? false);

        console.log(`[useIfc] Calculated bounds:`, {
          min: `(${bounds.min.x.toFixed(1)}, ${bounds.min.y.toFixed(1)}, ${bounds.min.z.toFixed(1)})`,
          max: `(${bounds.max.x.toFixed(1)}, ${bounds.max.y.toFixed(1)}, ${bounds.max.z.toFixed(1)})`,
          size: `${(bounds.max.x - bounds.min.x).toFixed(1)} x ${(bounds.max.y - bounds.min.y).toFixed(1)} x ${(bounds.max.z - bounds.min.z).toFixed(1)}`,
        });

        // Set all geometry at once
        setProgress({ phase: 'Rendering geometry', percent: 80 });
        const renderStart = performance.now();
        setGeometryResult({
          meshes: allMeshes,
          totalVertices: result.stats.total_vertices,
          totalTriangles: result.stats.total_triangles,
          coordinateInfo,
        });
        const renderTime = performance.now() - renderStart;
        console.log(`[useIfc] Geometry set: ${renderTime.toFixed(0)}ms`);
      }

      // Fetch and decode data model asynchronously (geometry already displayed)
      // Data model is processed on server in background, fetch via separate endpoint
      const cacheKey = result.cache_key;

      // Start data model fetch in background - don't block rendering
      (async () => {
        setProgress({ phase: 'Fetching data model', percent: 85 });
        const dataModelStart = performance.now();

        try {
          // If data model was included in response (ParquetParseResponse), use it directly
          // Otherwise, fetch from the data model endpoint
          let dataModelBuffer: ArrayBuffer | null = null;
          if ('data_model' in result && result.data_model) {
            dataModelBuffer = result.data_model;
          }

          if (!dataModelBuffer || dataModelBuffer.byteLength === 0) {
            console.log('[useIfc] Fetching data model from server (background processing)...');
            dataModelBuffer = await client.fetchDataModel(cacheKey);
          }

          if (!dataModelBuffer) {
            console.log('[useIfc] ⚡ Data model not available - property panel disabled');
            return;
          }

          const dataModel: DataModel = await decodeDataModel(dataModelBuffer);

          console.log(`[useIfc] Data model decoded in ${(performance.now() - dataModelStart).toFixed(0)}ms`);
          console.log(`  Entities: ${dataModel.entities.size}`);
          console.log(`  PropertySets: ${dataModel.propertySets.size}`);
          const quantitySetsSize = (dataModel as { quantitySets?: Map<number, unknown> }).quantitySets?.size ?? 0;
          console.log(`  QuantitySets: ${quantitySetsSize}`);
          console.log(`  Relationships: ${dataModel.relationships.length}`);
          console.log(`  Spatial nodes: ${dataModel.spatialHierarchy.nodes.length}`);

          // Convert server data model to viewer data store format using utility
          const dataStore = convertServerDataModel(
            dataModel,
            result as ServerParseResult,
            file,
            allMeshes
          ) as any;

          setIfcDataStore(dataStore);
          console.log('[useIfc] ✅ Property panel ready with server data model');
          console.log(`[useIfc] Data model loaded in ${(performance.now() - dataModelStart).toFixed(0)}ms (background)`);
        } catch (err) {
          console.warn('[useIfc] Failed to decode data model:', err);
          console.log('[useIfc] ⚡ Skipping data model (decoding failed)');
        }
      })(); // End of async data model fetch block - runs in background, doesn't block

      // Geometry is ready - mark complete immediately (data model loads in background)
      setProgress({ phase: 'Complete', percent: 100 });
      const totalServerTime = performance.now() - serverStart;
      console.log(`[useIfc] SERVER PARALLEL complete: ${file.name}`);
      console.log(`  Total time: ${totalServerTime.toFixed(0)}ms`);
      console.log(`  Breakdown: health=${(healthStart - serverStart).toFixed(0)}ms, parse=${parseTime.toFixed(0)}ms, convert=${convertTime.toFixed(0)}ms`);

      return true;
    } catch (err) {
      console.error('[useIfc] Server parse failed:', err);
      return false;
    }
  }, [setProgress, setIfcDataStore, setGeometryResult]);

  const loadFile = useCallback(async (file: File) => {
    const { resetViewerState } = useViewerStore.getState();

    // Track total elapsed time for complete user experience
    const totalStartTime = performance.now();
    
    try {
      // Reset all viewer state before loading new file
      resetViewerState();

      setLoading(true);
      setError(null);
      setProgress({ phase: 'Loading file', percent: 0 });

      // Read file from disk
      const buffer = await file.arrayBuffer();
      const fileSizeMB = buffer.byteLength / (1024 * 1024);

      // Detect file format (IFCX/IFC5 vs IFC4 STEP)
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
          } as any; // Type assertion - IFCX format is compatible but schemaVersion differs

          setIfcDataStore(dataStore);

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

      // INSTANT cache lookup: Use filename + size as key (no hashing!)
      // Same filename + same size = same file (fast and reliable enough)
      const cacheKey = `${file.name}-${buffer.byteLength}`;

      if (buffer.byteLength >= CACHE_SIZE_THRESHOLD) {
        setProgress({ phase: 'Checking cache', percent: 5 });
        const cacheResult = await getCached(cacheKey);
        if (cacheResult) {
          const success = await loadFromCache(cacheResult, file.name);
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
      const dataStorePromise = new Promise<IfcDataStore>((resolve) => {
        resolveDataStore = resolve;
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
        });
      };

      // Schedule data model parsing to start after geometry begins streaming
      setTimeout(startDataModelParsing, 0);

      // Use adaptive processing: sync for small files, streaming for large files
      let estimatedTotal = 0;
      let totalMeshes = 0;
      const allMeshes: MeshData[] = []; // Collect all meshes for BVH building
      let finalCoordinateInfo: CoordinateInfo | null = null;

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
            case 'batch': {
              batchCount++;
              totalWaitTime += waitTime;

              // Track time to first geometry
              if (batchCount === 1) {
                firstGeometryTime = performance.now() - totalStartTime;
              }

              const processStart = performance.now();

              // Collect meshes for BVH building
              allMeshes.push(...event.meshes);
              finalCoordinateInfo = event.coordinateInfo ?? null;
              totalMeshes = event.totalSoFar;

              // Accumulate meshes for batched rendering
              pendingMeshes.push(...event.meshes);

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

              // Update geometry result with final coordinate info
              updateCoordinateInfo(event.coordinateInfo);

              setProgress({ phase: 'Complete', percent: 100 });

              // Build spatial index and cache in background (non-blocking)
              // Wait for data model to complete first
              dataStorePromise.then(dataStore => {
                // Build spatial index from meshes (in background)
                if (allMeshes.length > 0) {
                  const buildIndex = () => {
                    try {
                      const spatialIndex = buildSpatialIndex(allMeshes);
                      (dataStore as any).spatialIndex = spatialIndex;
                      setIfcDataStore({ ...dataStore });
                    } catch (err) {
                      console.warn('[useIfc] Failed to build spatial index:', err);
                    }
                  };

                  // Use requestIdleCallback if available
                  if ('requestIdleCallback' in window) {
                    (window as any).requestIdleCallback(buildIndex, { timeout: 2000 });
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

  // Memoize query to prevent recreation on every render
  const query = useMemo(() => {
    if (!ifcDataStore) return null;

    // Only log once per ifcDataStore
    lastLoggedDataStoreRef.current = ifcDataStore;

    return new IfcQuery(ifcDataStore);
  }, [ifcDataStore]);

  return {
    loading,
    progress,
    error,
    ifcDataStore,
    geometryResult,
    query,
    loadFile,
  };
}

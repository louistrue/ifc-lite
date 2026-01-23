/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files
 * Includes binary cache support for fast subsequent loads
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore, type FederatedModel, type SchemaVersion } from '../store.js';
import { IfcParser, detectFormat, parseIfcx, parseFederatedIfcx, type IfcDataStore, type FederatedIfcxParseResult } from '@ifc-lite/parser';
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

/**
 * Extended data store type for IFCX (IFC5) files.
 * IFCX uses schemaVersion 'IFC5' and may include federated composition metadata.
 */
interface IfcxDataStore extends Omit<IfcDataStore, 'schemaVersion'> {
  schemaVersion: 'IFC5';
  /** Federated layer info for re-composition */
  _federatedLayers?: Array<{ id: string; name: string; enabled: boolean }>;
  /** Original buffers for re-composition when adding overlays */
  _federatedBuffers?: Array<{ buffer: ArrayBuffer; name: string }>;
  /** Composition statistics */
  _compositionStats?: { totalNodes: number; layersUsed: number; inheritanceResolutions: number; crossLayerReferences: number };
  /** Layer info for display */
  _layerInfo?: Array<{ id: string; name: string; meshCount: number }>;
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
    // Multi-model state and actions
    models,
    activeModelId,
    addModel: storeAddModel,
    removeModel: storeRemoveModel,
    clearAllModels,
    setActiveModel,
    setModelVisibility,
    setModelCollapsed,
    getModel,
    getActiveModel,
    getAllVisibleModels,
    hasModels,
    // Federation Registry helpers
    registerModelOffset,
    toGlobalId,
    fromGlobalId,
    findModelForGlobalId,
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
          // ViewerDataStore is structurally compatible with IfcDataStore
          const dataStore = convertServerDataModel(
            dataModel,
            result as ServerParseResult,
            file,
            allMeshes
          ) as unknown as IfcDataStore;

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
      console.log(`  Breakdown: parse=${parseTime.toFixed(0)}ms, convert=${convertTime.toFixed(0)}ms`);

      return true;
    } catch (err) {
      console.error('[useIfc] Server parse failed:', err);
      return false;
    }
  }, [setProgress, setIfcDataStore, setGeometryResult]);

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
  // For single-model backward compatibility
  const query = useMemo(() => {
    if (!ifcDataStore) return null;

    // Only log once per ifcDataStore
    lastLoggedDataStoreRef.current = ifcDataStore;

    return new IfcQuery(ifcDataStore);
  }, [ifcDataStore]);

  /**
   * Add a model to the federation (multi-model support)
   * Uses FederationRegistry to assign unique ID offsets - BULLETPROOF against ID collisions
   * Returns the model ID on success, null on failure
   */
  const addModel = useCallback(async (
    file: File,
    options?: { name?: string }
  ): Promise<string | null> => {
    const modelId = crypto.randomUUID();
    const totalStartTime = performance.now();

    try {
      // IMPORTANT: Before adding a new model, check if there's a legacy model
      // (loaded via loadFile) that's not in the Map yet. If so, migrate it first.
      const currentModels = useViewerStore.getState().models;
      const currentIfcDataStore = useViewerStore.getState().ifcDataStore;
      const currentGeometryResult = useViewerStore.getState().geometryResult;

      if (currentModels.size === 0 && currentIfcDataStore && currentGeometryResult) {
        // Migrate the legacy model to the Map
        // Legacy model has offset 0 (IDs are unchanged)
        const legacyModelId = crypto.randomUUID();
        const legacyName = currentIfcDataStore.spatialHierarchy?.project?.name || 'Model 1';

        // Find max expressId in legacy model for registry
        // IMPORTANT: Include ALL entities, not just meshes, for proper globalId resolution
        const legacyMeshes = currentGeometryResult.meshes || [];
        const legacyMaxExpressIdFromMeshes = legacyMeshes.reduce((max, m) => Math.max(max, m.expressId), 0);
        const legacyMaxExpressIdFromEntities = currentIfcDataStore.entityIndex?.byId
          ? Math.max(0, ...Array.from(currentIfcDataStore.entityIndex.byId.keys()))
          : 0;
        const legacyMaxExpressId = Math.max(legacyMaxExpressIdFromMeshes, legacyMaxExpressIdFromEntities);

        // Register legacy model with offset 0 (IDs already in use as-is)
        const legacyOffset = registerModelOffset(legacyModelId, legacyMaxExpressId);

        const legacyModel: FederatedModel = {
          id: legacyModelId,
          name: legacyName,
          ifcDataStore: currentIfcDataStore,
          geometryResult: currentGeometryResult,
          visible: true,
          collapsed: false,
          schemaVersion: 'IFC4',
          loadedAt: Date.now() - 1000,
          fileSize: 0,
          idOffset: legacyOffset,
          maxExpressId: legacyMaxExpressId,
        };
        storeAddModel(legacyModel);
        console.log(`[useIfc] Migrated legacy model "${legacyModel.name}" to federation (offset: ${legacyOffset}, maxId: ${legacyMaxExpressId})`);
      }

      setLoading(true);
      setError(null);
      setProgress({ phase: 'Loading file', percent: 0 });

      // Read file from disk
      const buffer = await file.arrayBuffer();
      const fileSizeMB = buffer.byteLength / (1024 * 1024);

      // Detect file format
      const format = detectFormat(buffer);

      let parsedDataStore: IfcDataStore | null = null;
      let parsedGeometry: { meshes: MeshData[]; totalVertices: number; totalTriangles: number; coordinateInfo: CoordinateInfo } | null = null;
      let schemaVersion: SchemaVersion = 'IFC4';

      // IFCX files must be parsed client-side
      if (format === 'ifcx') {
        setProgress({ phase: 'Parsing IFCX (client-side)', percent: 10 });

        const ifcxResult = await parseIfcx(buffer, {
          onProgress: (prog: { phase: string; percent: number }) => {
            setProgress({ phase: `IFCX ${prog.phase}`, percent: 10 + (prog.percent * 0.8) });
          },
        });

        // Convert IFCX meshes to viewer format
        const meshes: MeshData[] = ifcxResult.meshes.map((m: { expressId?: number; express_id?: number; id?: number; positions: Float32Array | number[]; indices: Uint32Array | number[]; normals: Float32Array | number[]; color?: [number, number, number, number] | [number, number, number]; ifcType?: string; ifc_type?: string }) => {
          const positions = m.positions instanceof Float32Array ? m.positions : new Float32Array(m.positions || []);
          const indices = m.indices instanceof Uint32Array ? m.indices : new Uint32Array(m.indices || []);
          const normals = m.normals instanceof Float32Array ? m.normals : new Float32Array(m.normals || []);
          const color = normalizeColor(m.color);

          return {
            expressId: m.expressId || m.express_id || m.id || 0,
            positions,
            indices,
            normals,
            color,
            ifcType: m.ifcType || m.ifc_type || 'IfcProduct',
          };
        }).filter((m: MeshData) => m.positions.length > 0 && m.indices.length > 0);

        // Check if this is an overlay-only IFCX file (no geometry)
        if (meshes.length === 0 && ifcxResult.entityCount > 0) {
          console.warn(`[useIfc] IFCX file "${file.name}" has no geometry - this is an overlay file.`);
          setError(`"${file.name}" is an overlay file with no geometry. Please load it together with a base IFCX file (select all files at once for federated loading).`);
          setLoading(false);
          return null;
        }

        const { bounds, stats } = calculateMeshBounds(meshes);
        const coordinateInfo = createCoordinateInfo(bounds);

        parsedGeometry = {
          meshes,
          totalVertices: stats.totalVertices,
          totalTriangles: stats.totalTriangles,
          coordinateInfo,
        };

        parsedDataStore = {
          fileSize: ifcxResult.fileSize,
          schemaVersion: 'IFC5' as const,
          entityCount: ifcxResult.entityCount,
          parseTime: ifcxResult.parseTime,
          source: new Uint8Array(buffer),
          entityIndex: { byId: new Map(), byType: new Map() },
          strings: ifcxResult.strings,
          entities: ifcxResult.entities,
          properties: ifcxResult.properties,
          quantities: ifcxResult.quantities,
          relationships: ifcxResult.relationships,
          spatialHierarchy: ifcxResult.spatialHierarchy,
        } as unknown as IfcDataStore; // IFC5 schema extension

        schemaVersion = 'IFC5';

      } else {
        // IFC4/IFC2X3 STEP format - use WASM parsing
        setProgress({ phase: 'Starting geometry streaming', percent: 10 });

        const geometryProcessor = new GeometryProcessor({ quality: GeometryQuality.Balanced });
        await geometryProcessor.init();

        // Parse data model
        const parser = new IfcParser();
        const wasmApi = geometryProcessor.getApi();

        const dataStorePromise = parser.parseColumnar(buffer, { wasmApi });

        // Process geometry
        const allMeshes: MeshData[] = [];
        let finalCoordinateInfo: CoordinateInfo | null = null;

        const dynamicBatchConfig = getDynamicBatchConfig(fileSizeMB);

        for await (const event of geometryProcessor.processAdaptive(new Uint8Array(buffer), {
          sizeThreshold: 2 * 1024 * 1024,
          batchSize: dynamicBatchConfig,
        })) {
          switch (event.type) {
            case 'batch': {
              allMeshes.push(...event.meshes);
              finalCoordinateInfo = event.coordinateInfo ?? null;
              const progressPercent = 10 + Math.min(80, (allMeshes.length / 1000) * 0.8);
              setProgress({ phase: `Processing geometry (${allMeshes.length} meshes)`, percent: progressPercent });
              break;
            }
            case 'complete':
              finalCoordinateInfo = event.coordinateInfo ?? null;
              break;
          }
        }

        parsedDataStore = await dataStorePromise;

        // Calculate storey heights
        if (parsedDataStore.spatialHierarchy && parsedDataStore.spatialHierarchy.storeyHeights.size === 0 && parsedDataStore.spatialHierarchy.storeyElevations.size > 1) {
          const calculatedHeights = calculateStoreyHeights(parsedDataStore.spatialHierarchy.storeyElevations);
          for (const [storeyId, height] of calculatedHeights) {
            parsedDataStore.spatialHierarchy.storeyHeights.set(storeyId, height);
          }
        }

        // Build spatial index
        if (allMeshes.length > 0) {
          try {
            const spatialIndex = buildSpatialIndex(allMeshes);
            parsedDataStore.spatialIndex = spatialIndex;
          } catch (err) {
            console.warn('[useIfc] Failed to build spatial index:', err);
          }
        }

        parsedGeometry = {
          meshes: allMeshes,
          totalVertices: allMeshes.reduce((sum, m) => sum + m.positions.length / 3, 0),
          totalTriangles: allMeshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
          coordinateInfo: finalCoordinateInfo || createCoordinateInfo(calculateMeshBounds(allMeshes).bounds),
        };

        schemaVersion = parsedDataStore.schemaVersion === 'IFC4X3' ? 'IFC4X3' :
                        parsedDataStore.schemaVersion === 'IFC4' ? 'IFC4' : 'IFC2X3';
      }

      if (!parsedDataStore || !parsedGeometry) {
        throw new Error('Failed to parse file');
      }

      // =========================================================================
      // FEDERATION REGISTRY: Transform expressIds to globally unique IDs
      // This is the BULLETPROOF fix for multi-model ID collisions
      // =========================================================================

      // Step 1: Find max expressId in this model
      // IMPORTANT: Use ALL entities from data store, not just meshes
      // Spatial containers (IfcProject, IfcSite, etc.) don't have geometry but need valid globalId resolution
      const maxExpressIdFromMeshes = parsedGeometry.meshes.reduce((max, m) => Math.max(max, m.expressId), 0);
      const maxExpressIdFromEntities = parsedDataStore.entityIndex?.byId
        ? Math.max(0, ...Array.from(parsedDataStore.entityIndex.byId.keys()))
        : 0;
      const maxExpressId = Math.max(maxExpressIdFromMeshes, maxExpressIdFromEntities);

      // Step 2: Register with federation registry to get unique offset
      const idOffset = registerModelOffset(modelId, maxExpressId);

      // Step 3: Transform ALL mesh expressIds to globalIds
      // globalId = originalExpressId + offset
      // This ensures no two models can have the same ID
      if (idOffset > 0) {
        for (const mesh of parsedGeometry.meshes) {
          mesh.expressId = mesh.expressId + idOffset;
        }
      }

      // Create the federated model with offset info
      const federatedModel: FederatedModel = {
        id: modelId,
        name: options?.name ?? file.name,
        ifcDataStore: parsedDataStore,
        geometryResult: parsedGeometry,
        visible: true,
        collapsed: hasModels(), // Collapse if not first model
        schemaVersion,
        loadedAt: Date.now(),
        fileSize: buffer.byteLength,
        idOffset,
        maxExpressId,
      };

      // Add to store
      storeAddModel(federatedModel);

      // Also set legacy single-model state for backward compatibility
      setIfcDataStore(parsedDataStore);
      setGeometryResult(parsedGeometry);

      setProgress({ phase: 'Complete', percent: 100 });
      setLoading(false);

      const totalElapsedMs = performance.now() - totalStartTime;
      console.log(`[useIfc] ✓ Added model ${file.name} (${fileSizeMB.toFixed(1)}MB) | ${totalElapsedMs.toFixed(0)}ms`);

      return modelId;

    } catch (err) {
      console.error('[useIfc] addModel failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      return null;
    }
  }, [setLoading, setError, setProgress, setIfcDataStore, setGeometryResult, storeAddModel, hasModels]);

  /**
   * Remove a model from the federation
   */
  const removeModel = useCallback((modelId: string) => {
    storeRemoveModel(modelId);

    // Read fresh state from store after removal to avoid stale closure
    const freshModels = useViewerStore.getState().models;
    const remaining = Array.from(freshModels.values());
    if (remaining.length > 0) {
      const newActive = remaining[0];
      setIfcDataStore(newActive.ifcDataStore);
      setGeometryResult(newActive.geometryResult);
    } else {
      setIfcDataStore(null);
      setGeometryResult(null);
    }
  }, [storeRemoveModel, setIfcDataStore, setGeometryResult]);

  /**
   * Get query instance for a specific model
   */
  const getQueryForModel = useCallback((modelId: string): IfcQuery | null => {
    const model = getModel(modelId);
    if (!model) return null;
    return new IfcQuery(model.ifcDataStore);
  }, [getModel]);

  /**
   * Load multiple files sequentially (WASM parser isn't thread-safe)
   * Each file fully loads before the next one starts
   */
  const loadFilesSequentially = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      await addModel(file);
    }
  }, [addModel]);

  /**
   * Load multiple IFCX files as federated layers
   * Uses IFC5's layer composition system where later files override earlier ones.
   * Properties from overlay files are merged with the base file(s).
   *
   * @param files - Array of IFCX files (first = base/weakest, last = strongest overlay)
   *
   * @example
   * ```typescript
   * // Load base model with property overlay
   * await loadFederatedIfcx([
   *   baseFile,           // hello-wall.ifcx
   *   fireRatingFile,     // add-fire-rating.ifcx (adds FireRating property)
   * ]);
   * ```
   */
  /**
   * Internal: Load federated IFCX from buffers (used by both initial load and add overlay)
   */
  const loadFederatedIfcxFromBuffers = useCallback(async (
    buffers: Array<{ buffer: ArrayBuffer; name: string }>,
    options: { resetState?: boolean } = {}
  ): Promise<void> => {
    const { resetViewerState, clearAllModels } = useViewerStore.getState();

    try {
      // Always reset viewer state when geometry changes (selection, hidden entities, etc.)
      // This ensures 3D highlighting works correctly after re-composition
      resetViewerState();

      // Clear legacy geometry BEFORE clearing models to prevent stale fallback
      // This avoids a race condition where mergedGeometryResult uses old geometry
      // during the brief moment when storeModels.size === 0
      setGeometryResult(null);
      clearAllModels();

      setLoading(true);
      setError(null);
      setProgress({ phase: 'Parsing federated IFCX', percent: 0 });

      // Parse federated IFCX files
      const result = await parseFederatedIfcx(buffers, {
        onProgress: (prog: { phase: string; percent: number }) => {
          setProgress({ phase: `IFCX ${prog.phase}`, percent: prog.percent });
        },
      });

      // Convert IFCX meshes to viewer format
      const meshes: MeshData[] = result.meshes.map((m: { expressId?: number; express_id?: number; id?: number; positions: Float32Array | number[]; indices: Uint32Array | number[]; normals: Float32Array | number[]; color?: [number, number, number, number] | [number, number, number]; ifcType?: string; ifc_type?: string }) => {
        const positions = m.positions instanceof Float32Array ? m.positions : new Float32Array(m.positions || []);
        const indices = m.indices instanceof Uint32Array ? m.indices : new Uint32Array(m.indices || []);
        const normals = m.normals instanceof Float32Array ? m.normals : new Float32Array(m.normals || []);
        const color = normalizeColor(m.color);

        return {
          expressId: m.expressId || m.express_id || m.id || 0,
          positions,
          indices,
          normals,
          color,
          ifcType: m.ifcType || m.ifc_type || 'IfcProduct',
        };
      }).filter((m: MeshData) => m.positions.length > 0 && m.indices.length > 0);

      // Calculate bounds
      const { bounds, stats } = calculateMeshBounds(meshes);
      const coordinateInfo = createCoordinateInfo(bounds);

      const geometryResult = {
        meshes,
        totalVertices: stats.totalVertices,
        totalTriangles: stats.totalTriangles,
        coordinateInfo,
      };

      // NOTE: Do NOT call setGeometryResult() here!
      // For federated loading, geometry comes from the models Map via mergedGeometryResult.
      // Calling setGeometryResult() before models are added causes a race condition where
      // meshes are added to the scene WITHOUT modelIndex, breaking selection highlighting.

      // Get layer info with mesh counts
      const layers = result.layerStack.getLayers();

      // Create data store from federated result
      const dataStore = {
        fileSize: result.fileSize,
        schemaVersion: 'IFC5' as const,
        entityCount: result.entityCount,
        parseTime: result.parseTime,
        source: new Uint8Array(buffers[0].buffer),
        entityIndex: {
          byId: new Map(),
          byType: new Map(),
        },
        strings: result.strings,
        entities: result.entities,
        properties: result.properties,
        quantities: result.quantities,
        relationships: result.relationships,
        spatialHierarchy: result.spatialHierarchy,
        // Federated-specific: store layer info and ORIGINAL BUFFERS for re-composition
        _federatedLayers: layers.map(l => ({
          id: l.id,
          name: l.name,
          enabled: l.enabled,
        })),
        _federatedBuffers: buffers.map(b => ({
          buffer: b.buffer.slice(0), // Clone buffer
          name: b.name,
        })),
        _compositionStats: result.compositionStats,
      } as unknown as IfcDataStore; // IFC5 schema extension

      setIfcDataStore(dataStore);

      // Clear existing models and add each layer as a "model" in the Models panel
      // This shows users all the files that contributed to the composition
      clearAllModels();

      // Find max expressId for proper ID range tracking
      // This is needed for resolveGlobalIdFromModels to work correctly
      let maxExpressId = 0;
      if (result.entities?.expressId) {
        for (let i = 0; i < result.entities.count; i++) {
          const id = result.entities.expressId[i];
          if (id > maxExpressId) maxExpressId = id;
        }
      }

      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const layerBuffer = buffers.find(b => b.name === layer.name);

        // Count how many meshes came from this layer
        // For base layers: count meshes, for overlays: show as data-only
        const isBaseLayer = i === layers.length - 1; // Last layer (weakest) is typically base

        const layerModel: FederatedModel = {
          id: layer.id,
          name: layer.name,
          ifcDataStore: dataStore, // Share the composed data store
          geometryResult: isBaseLayer ? geometryResult : {
            meshes: [],
            totalVertices: 0,
            totalTriangles: 0,
            coordinateInfo,
          },
          visible: true,
          collapsed: i > 0, // Collapse overlays by default
          schemaVersion: 'IFC5',
          loadedAt: Date.now() - (layers.length - i) * 100, // Stagger timestamps
          fileSize: layerBuffer?.buffer.byteLength || 0,
          // For base layer: set proper ID range for resolveGlobalIdFromModels
          // Overlays share the same data store so they don't need their own range
          idOffset: 0,
          maxExpressId: isBaseLayer ? maxExpressId : 0,
          // Mark overlay-only layers
          _isOverlay: !isBaseLayer,
          _layerIndex: i,
        } as FederatedModel & { _isOverlay?: boolean; _layerIndex?: number };

        storeAddModel(layerModel);
      }

      console.log(`[useIfc] Federated IFCX loaded: ${layers.length} layers, ${result.entityCount} entities, ${meshes.length} meshes`);
      console.log(`[useIfc] Composition stats: ${result.compositionStats.inheritanceResolutions} inheritance resolutions, ${result.compositionStats.crossLayerReferences} cross-layer refs`);
      console.log(`[useIfc] Layers in Models panel: ${layers.map(l => l.name).join(', ')}`);

      setProgress({ phase: 'Complete', percent: 100 });
      setLoading(false);
    } catch (err: unknown) {
      console.error('[useIfc] Federated IFCX loading failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Federated IFCX loading failed: ${message}`);
      setLoading(false);
    }
  }, [setLoading, setError, setProgress, setGeometryResult, setIfcDataStore, storeAddModel, clearAllModels]);

  const loadFederatedIfcx = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) {
      setError('No files provided for federated loading');
      return;
    }

    // Check that all files are IFCX format and read buffers
    const buffers: Array<{ buffer: ArrayBuffer; name: string }> = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const format = detectFormat(buffer);
      if (format !== 'ifcx') {
        setError(`File "${file.name}" is not an IFCX file. Federated loading only supports IFCX files.`);
        return;
      }
      buffers.push({ buffer, name: file.name });
    }

    await loadFederatedIfcxFromBuffers(buffers);
  }, [setError, loadFederatedIfcxFromBuffers]);

  /**
   * Add IFCX overlay files to existing federated model
   * Re-composes all layers including new overlays
   * Also handles adding overlays to a single IFCX file that wasn't loaded via federated loading
   */
  const addIfcxOverlays = useCallback(async (files: File[]): Promise<void> => {
    const currentStore = useViewerStore.getState().ifcDataStore as IfcxDataStore | null;
    const currentModels = useViewerStore.getState().models;

    // Get existing buffers - either from federated loading or from single file load
    let existingBuffers: Array<{ buffer: ArrayBuffer; name: string }> = [];

    if (currentStore?._federatedBuffers) {
      // Already federated - use stored buffers
      existingBuffers = currentStore._federatedBuffers as Array<{ buffer: ArrayBuffer; name: string }>;
    } else if (currentStore?.source && currentStore.schemaVersion === 'IFC5') {
      // Single IFCX file loaded via loadFile() - reconstruct buffer from source
      // Get the model name from the models map
      let modelName = 'base.ifcx';
      for (const [, model] of currentModels) {
        // Compare object identity (cast needed due to IFC5 schema extension)
        if ((model.ifcDataStore as unknown) === currentStore || model.schemaVersion === 'IFC5') {
          modelName = model.name;
          break;
        }
      }

      // Convert Uint8Array source back to ArrayBuffer
      const sourceBuffer = currentStore.source.buffer.slice(
        currentStore.source.byteOffset,
        currentStore.source.byteOffset + currentStore.source.byteLength
      ) as ArrayBuffer;

      existingBuffers = [{ buffer: sourceBuffer, name: modelName }];
      console.log(`[useIfc] Converting single IFCX file "${modelName}" to federated mode`);
    } else {
      setError('Cannot add overlays: no IFCX model loaded');
      return;
    }

    // Read new overlay buffers
    const newBuffers: Array<{ buffer: ArrayBuffer; name: string }> = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const format = detectFormat(buffer);
      if (format !== 'ifcx') {
        setError(`File "${file.name}" is not an IFCX file.`);
        return;
      }
      newBuffers.push({ buffer, name: file.name });
    }

    // Combine: existing layers + new overlays (new overlays are strongest = first in array)
    const allBuffers = [...newBuffers, ...existingBuffers];

    console.log(`[useIfc] Re-composing federated IFCX with ${newBuffers.length} new overlay(s)`);
    console.log(`[useIfc] Total layers: ${allBuffers.length} (${existingBuffers.length} existing + ${newBuffers.length} new)`);

    await loadFederatedIfcxFromBuffers(allBuffers, { resetState: false });
  }, [setError, loadFederatedIfcxFromBuffers]);

  /**
   * Find which model contains a given globalId
   * Uses FederationRegistry for O(log N) lookup - BULLETPROOF
   * Returns the modelId or null if not found
   */
  const findModelForEntity = useCallback((globalId: number): string | null => {
    return findModelForGlobalId(globalId);
  }, [findModelForGlobalId]);

  /**
   * Convert a globalId back to the original (modelId, expressId) pair
   * Use this when you need to look up properties in the IfcDataStore
   */
  const resolveGlobalId = useCallback((globalId: number): { modelId: string; expressId: number } | null => {
    return fromGlobalId(globalId);
  }, [fromGlobalId]);

  return {
    // Legacy single-model API (backward compatibility)
    loading,
    progress,
    error,
    ifcDataStore,
    geometryResult,
    query,
    loadFile,

    // Multi-model API
    models,
    activeModelId,
    addModel,
    removeModel,
    clearAllModels,
    setActiveModel,
    setModelVisibility,
    setModelCollapsed,
    getModel,
    getActiveModel,
    getAllVisibleModels,
    hasModels,
    getQueryForModel,
    loadFilesSequentially,

    // Federated IFCX API (IFC5 multi-file loading with layer composition)
    loadFederatedIfcx,  // Load multiple IFCX files as federated layers
    addIfcxOverlays,    // Add overlay files to existing federated model

    // Federation Registry helpers
    findModelForEntity,  // Find model by globalId
    resolveGlobalId,     // Convert globalId -> (modelId, originalExpressId)
    toGlobalId,          // Convert (modelId, expressId) -> globalId
  };
}

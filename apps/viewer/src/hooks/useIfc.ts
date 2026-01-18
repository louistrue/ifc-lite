/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files
 * Includes binary cache support for fast subsequent loads
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser, detectFormat, parseIfcx } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality, type MeshData } from '@ifc-lite/geometry';
import { IfcQuery } from '@ifc-lite/query';
import { BufferBuilder } from '@ifc-lite/geometry';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import {
  BinaryCacheWriter,
  BinaryCacheReader,
  type IfcDataStore as CacheDataStore,
  type GeometryData,
} from '@ifc-lite/cache';
import { getCached, setCached, type CacheResult } from '../services/ifc-cache.js';
import { IfcTypeEnum, RelationshipType, IfcTypeEnumFromString, IfcTypeEnumToString, EntityFlags, type SpatialHierarchy, type SpatialNode, type EntityTable, type RelationshipGraph } from '@ifc-lite/data';
import { StringTable } from '@ifc-lite/data';
import { IfcServerClient, decodeDataModel, type ParquetBatch } from '@ifc-lite/server-client';
import type { DynamicBatchConfig } from '@ifc-lite/geometry';

// Minimum file size to cache (10MB) - smaller files parse quickly anyway
const CACHE_SIZE_THRESHOLD = 10 * 1024 * 1024;

// Server URL - can be set via environment variable or use default localhost
const SERVER_URL = import.meta.env.VITE_IFC_SERVER_URL || import.meta.env.VITE_SERVER_URL || 'http://localhost:8080';
// Enable server by default (with graceful fallback if unavailable)
// Set VITE_USE_SERVER=false to disable server parsing
const USE_SERVER = import.meta.env.VITE_USE_SERVER !== 'false';

/**
 * Calculate dynamic batch config based on file size
 */
function getDynamicBatchConfig(fileSizeMB: number): DynamicBatchConfig {
  if (fileSizeMB < 10) {
    return { initialBatchSize: 50, maxBatchSize: 200, fileSizeMB };
  } else if (fileSizeMB < 50) {
    return { initialBatchSize: 100, maxBatchSize: 500, fileSizeMB };
  } else if (fileSizeMB < 100) {
    return { initialBatchSize: 100, maxBatchSize: 1000, fileSizeMB };
  } else {
    // HUGE files (100MB+): aggressive batching for maximum throughput
    return { initialBatchSize: 100, maxBatchSize: 3000, fileSizeMB };
  }
}

/**
 * Rebuild spatial hierarchy from cache data (entities + relationships)
 * OPTIMIZED: Uses index maps for O(1) lookups instead of O(n) linear searches
 */
function rebuildSpatialHierarchy(
  entities: EntityTable,
  relationships: RelationshipGraph
): SpatialHierarchy | undefined {
  // PRE-BUILD INDEX MAP: O(n) once, then O(1) lookups
  // This eliminates the O(n²) nested loops from before
  const entityTypeMap = new Map<number, IfcTypeEnum>();
  for (let i = 0; i < entities.count; i++) {
    entityTypeMap.set(entities.expressId[i], entities.typeEnum[i]);
  }

  const spatialTypes = new Set([
    IfcTypeEnum.IfcProject,
    IfcTypeEnum.IfcSite,
    IfcTypeEnum.IfcBuilding,
    IfcTypeEnum.IfcBuildingStorey,
    IfcTypeEnum.IfcSpace
  ]);

  const byStorey = new Map<number, number[]>();
  const byBuilding = new Map<number, number[]>();
  const bySite = new Map<number, number[]>();
  const bySpace = new Map<number, number[]>();
  const storeyElevations = new Map<number, number>();
  const elementToStorey = new Map<number, number>();

  // Find IfcProject
  const projectIds = entities.getByType(IfcTypeEnum.IfcProject);
  if (projectIds.length === 0) {
    console.warn('[rebuildSpatialHierarchy] No IfcProject found');
    return undefined;
  }
  const projectId = projectIds[0];

  // Build node tree recursively - NOW O(1) lookups!
  function buildNode(expressId: number): SpatialNode {
    // O(1) lookup instead of O(n) linear search
    const typeEnum = entityTypeMap.get(expressId) ?? IfcTypeEnum.Unknown;
    const name = entities.getName(expressId) || `Entity #${expressId}`;

    // Get contained elements via IfcRelContainedInSpatialStructure
    const rawContainedElements = relationships.getRelated(
      expressId,
      RelationshipType.ContainsElements,
      'forward'
    );

    // Filter out spatial structure elements - O(1) per element now!
    const containedElements = rawContainedElements.filter(id => {
      const elemType = entityTypeMap.get(id);
      return elemType !== undefined && !spatialTypes.has(elemType);
    });

    // Get aggregated children via IfcRelAggregates
    const aggregatedChildren = relationships.getRelated(
      expressId,
      RelationshipType.Aggregates,
      'forward'
    );

    // Filter to spatial structure types and recurse - O(1) per child now!
    const childNodes: SpatialNode[] = [];
    for (const childId of aggregatedChildren) {
      const childType = entityTypeMap.get(childId);
      if (childType && spatialTypes.has(childType) && childType !== IfcTypeEnum.IfcProject) {
        childNodes.push(buildNode(childId));
      }
    }

    // Add elements to appropriate maps
    if (typeEnum === IfcTypeEnum.IfcBuildingStorey) {
      byStorey.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcBuilding) {
      byBuilding.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcSite) {
      bySite.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcSpace) {
      bySpace.set(expressId, containedElements);
    }

    return {
      expressId,
      type: typeEnum,
      name,
      children: childNodes,
      elements: containedElements,
    };
  }

  const projectNode = buildNode(projectId);

  // Build reverse lookup map: elementId -> storeyId
  for (const [storeyId, elementIds] of byStorey) {
    for (const elementId of elementIds) {
      elementToStorey.set(elementId, storeyId);
    }
  }

  // Pre-build space lookup for O(1) getContainingSpace
  const elementToSpace = new Map<number, number>();
  for (const [spaceId, elementIds] of bySpace) {
    for (const elementId of elementIds) {
      elementToSpace.set(elementId, spaceId);
    }
  }

  return {
    project: projectNode,
    byStorey,
    byBuilding,
    bySite,
    bySpace,
    storeyElevations,
    elementToStorey,

    getStoreyElements(storeyId: number): number[] {
      return byStorey.get(storeyId) ?? [];
    },

    getStoreyByElevation(): number | null {
      return null;
    },

    getContainingSpace(elementId: number): number | null {
      return elementToSpace.get(elementId) ?? null;
    },

    getPath(elementId: number): SpatialNode[] {
      const path: SpatialNode[] = [];
      const storeyId = elementToStorey.get(elementId);
      if (!storeyId) return path;

      const findPath = (node: SpatialNode, targetId: number): boolean => {
        path.push(node);
        if (node.elements.includes(targetId)) {
          return true;
        }
        for (const child of node.children) {
          if (findPath(child, targetId)) {
            return true;
          }
        }
        path.pop();
        return false;
      };

      findPath(projectNode, elementId);
      return path;
    },
  };
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
    updateCoordinateInfo,
  } = useViewerStore();

  // Track if we've already logged for this ifcDataStore
  const lastLoggedDataStoreRef = useRef<typeof ifcDataStore>(null);

  /**
   * Rebuild on-demand property/quantity maps from relationships and entity types
   * Uses FORWARD direction: pset -> elements (more efficient than inverse lookup)
   */
  const rebuildOnDemandMaps = (
    entities: EntityTable,
    relationships: RelationshipGraph
  ): { onDemandPropertyMap: Map<number, number[]>; onDemandQuantityMap: Map<number, number[]> } => {
    const onDemandPropertyMap = new Map<number, number[]>();
    const onDemandQuantityMap = new Map<number, number[]>();

    let psetCount = 0;
    let qsetCount = 0;

    // Find all property sets and quantity sets, then look up what they define
    for (let i = 0; i < entities.count; i++) {
      const psetId = entities.expressId[i];
      const psetType = entities.getTypeName(psetId);
      const psetTypeUpper = psetType?.toUpperCase() || '';

      // Only process property sets and quantity sets
      const isPropertySet = psetTypeUpper === 'IFCPROPERTYSET';
      const isQuantitySet = psetTypeUpper === 'IFCELEMENTQUANTITY';
      if (!isPropertySet && !isQuantitySet) {
        continue;
      }

      if (isPropertySet) psetCount++;
      if (isQuantitySet) qsetCount++;

      // Get elements defined by this pset (FORWARD: pset -> elements)
      const definedElements = relationships.getRelated(psetId, RelationshipType.DefinesByProperties, 'forward');

      for (const entityId of definedElements) {
        if (isPropertySet) {
          let list = onDemandPropertyMap.get(entityId);
          if (!list) { list = []; onDemandPropertyMap.set(entityId, list); }
          list.push(psetId);
        } else {
          let list = onDemandQuantityMap.get(entityId);
          if (!list) { list = []; onDemandQuantityMap.set(entityId, list); }
          list.push(psetId);
        }
      }
    }

    console.log(`[useIfc] Rebuilt on-demand maps: ${psetCount} psets, ${qsetCount} qsets -> ${onDemandPropertyMap.size} entities with properties, ${onDemandQuantityMap.size} with quantities`);
    return { onDemandPropertyMap, onDemandQuantityMap };
  };

  /**
   * Load from binary cache - INSTANT load for maximum speed
   * Large cached models load all geometry at once for fastest total time
   */
  const loadFromCache = useCallback(async (
    cacheResult: CacheResult,
    fileName: string
  ): Promise<boolean> => {
    try {
      const cacheLoadStart = performance.now();
      setProgress({ phase: 'Loading from cache', percent: 10 });

      // Reset geometry first so Viewport detects this as a new file
      setGeometryResult(null);

      const reader = new BinaryCacheReader();
      const result = await reader.read(cacheResult.buffer);
      const cacheReadTime = performance.now() - cacheLoadStart;

      // Convert cache data store to viewer data store format
      const dataStore = result.dataStore as any;

      // Restore source buffer for on-demand property extraction
      if (cacheResult.sourceBuffer) {
        dataStore.source = new Uint8Array(cacheResult.sourceBuffer);

        // Quick scan to rebuild entity index with byte offsets (needed for on-demand extraction)
        const { StepTokenizer } = await import('@ifc-lite/parser');
        const tokenizer = new StepTokenizer(dataStore.source);
        const entityIndex = {
          byId: new Map<number, any>(),
          byType: new Map<string, number[]>(),
        };

        for (const ref of tokenizer.scanEntitiesFast()) {
          entityIndex.byId.set(ref.expressId, {
            expressId: ref.expressId,
            type: ref.type,
            byteOffset: ref.offset,
            byteLength: ref.length,
            lineNumber: ref.line,
          });
          let typeList = entityIndex.byType.get(ref.type);
          if (!typeList) { typeList = []; entityIndex.byType.set(ref.type, typeList); }
          typeList.push(ref.expressId);
        }
        dataStore.entityIndex = entityIndex;

        // Rebuild on-demand maps from relationships
        const { onDemandPropertyMap, onDemandQuantityMap } = rebuildOnDemandMaps(
          dataStore.entities,
          dataStore.relationships
        );
        dataStore.onDemandPropertyMap = onDemandPropertyMap;
        dataStore.onDemandQuantityMap = onDemandQuantityMap;
        console.log('[useIfc] Restored source buffer and on-demand maps from cache');
      } else {
        console.warn('[useIfc] No source buffer in cache - on-demand property extraction disabled');
        dataStore.source = new Uint8Array(0);
      }

      // Rebuild spatial hierarchy from cache data (cache doesn't serialize it)
      if (!dataStore.spatialHierarchy && dataStore.entities && dataStore.relationships) {
        dataStore.spatialHierarchy = rebuildSpatialHierarchy(
          dataStore.entities,
          dataStore.relationships
        );
      }

      if (result.geometry) {
        const { meshes, coordinateInfo, totalVertices, totalTriangles } = result.geometry;

        // INSTANT: Set ALL geometry in ONE call - fastest for cached models
        setGeometryResult({
          meshes,
          totalVertices,
          totalTriangles,
          coordinateInfo,
        });

        // Set data store
        setIfcDataStore(dataStore);

        // Build spatial index in background (non-blocking)
        if (meshes.length > 0) {
          if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(() => {
              try {
                const spatialIndex = buildSpatialIndex(meshes);
                dataStore.spatialIndex = spatialIndex;
                setIfcDataStore({ ...dataStore });
              } catch (err) {
                console.warn('[useIfc] Failed to build spatial index:', err);
              }
            }, { timeout: 2000 });
          }
        }
      } else {
        setIfcDataStore(dataStore);
      }

      setProgress({ phase: 'Complete (from cache)', percent: 100 });
      const totalCacheTime = performance.now() - cacheLoadStart;
      console.log(
        `[useIfc] INSTANT cache load: ${fileName} (${result.geometry?.meshes.length || 0} meshes)\n` +
        `  Cache read: ${cacheReadTime.toFixed(0)}ms\n` +
        `  Total time: ${totalCacheTime.toFixed(0)}ms\n` +
        `  Expected: <2000ms for instant feel`
      );

      return true;
    } catch (err) {
      console.error('[useIfc] Failed to load from cache:', err);
      return false;
    }
  }, [setProgress, setIfcDataStore, setGeometryResult]);

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

      // Check server health first
      const healthStart = performance.now();
      try {
        await client.health();
        const healthTime = performance.now() - healthStart;
        console.log(`[useIfc] Server health check: ${healthTime.toFixed(0)}ms`);
      } catch (err) {
        console.warn('[useIfc] Server not available, falling back to local parsing:', err);
        return false;
      }

      setProgress({ phase: 'Processing on server (parallel)', percent: 15 });

      // Check if Parquet is supported (requires parquet-wasm)
      const parquetSupported = await client.isParquetSupported();

      let allMeshes: MeshData[];
      let result: any;
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
        let streamMetadata: any = null;
        let streamStats: any = null;
        let batchCount = 0;

        // Progressive bounds calculation
        const bounds = {
          min: { x: Infinity, y: Infinity, z: Infinity },
          max: { x: -Infinity, y: -Infinity, z: -Infinity },
        };

        const parseStart = performance.now();

        // Use streaming endpoint with batch callback
        const streamResult = await client.parseParquetStream(file, (batch: ParquetBatch) => {
          batchCount++;

          // Convert batch meshes to viewer format
          const batchMeshes = batch.meshes.map((m: any) => ({
            expressId: m.express_id,
            positions: m.positions,
            indices: m.indices,
            normals: m.normals,
            color: m.color,
            ifcType: m.ifc_type,
          }));

          // Update bounds incrementally
          for (const mesh of batchMeshes) {
            const positions = mesh.positions;
            for (let i = 0; i < positions.length; i += 3) {
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];
              if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                bounds.min.x = Math.min(bounds.min.x, x);
                bounds.min.y = Math.min(bounds.min.y, y);
                bounds.min.z = Math.min(bounds.min.z, z);
                bounds.max.x = Math.max(bounds.max.x, x);
                bounds.max.y = Math.max(bounds.max.y, y);
                bounds.max.z = Math.max(bounds.max.z, z);
              }
            }
            totalVertices += positions.length / 3;
            totalTriangles += mesh.indices.length / 3;
          }

          // Add to collection
          allMeshes.push(...batchMeshes);

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
        });

        parseTime = performance.now() - parseStart;
        cacheKey = streamResult.cache_key;
        streamMetadata = streamResult.metadata;
        streamStats = streamResult.stats;

        console.log(`[useIfc] Streaming complete in ${parseTime.toFixed(0)}ms`);
        console.log(`  ${batchCount} batches, ${allMeshes.length} meshes`);
        console.log(`  Cache key: ${cacheKey}`);

        // Build final result object for data model fetching
        result = {
          cache_key: cacheKey,
          meshes: allMeshes,
          metadata: streamMetadata,
          stats: streamStats,
        };
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
        result = await client.parseParquet(file);
        parseTime = performance.now() - parseStart;

        console.log(`[useIfc] Server parse response received in ${parseTime.toFixed(0)}ms`);
        console.log(`  Server stats: ${result.stats.total_time_ms}ms total (parse: ${result.stats.parse_time_ms}ms, geometry: ${result.stats.geometry_time_ms}ms)`);
        console.log(`  Parquet payload: ${(result.parquet_stats.payload_size / 1024 / 1024).toFixed(2)}MB, decode: ${result.parquet_stats.decode_time_ms}ms`);
        console.log(`  Meshes: ${result.meshes.length}, Vertices: ${result.stats.total_vertices}, Triangles: ${result.stats.total_triangles}`);
        console.log(`  Cache key: ${result.cache_key}`);

        setProgress({ phase: 'Converting meshes', percent: 70 });

        // Parquet decoder already returns the correct format
        const convertStart = performance.now();
        allMeshes = result.meshes.map((m: any) => ({
          expressId: m.express_id,
          positions: m.positions,
          indices: m.indices,
          normals: m.normals,
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
        allMeshes = result.meshes.map((m: any) => ({
          expressId: m.express_id,
          positions: new Float32Array(m.positions),
          indices: new Uint32Array(m.indices),
          normals: m.normals ? new Float32Array(m.normals) : undefined,
          color: m.color ? new Uint8Array(m.color.map((c: number) => Math.round(c * 255))) : undefined,
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
        const bounds = {
          min: { x: Infinity, y: Infinity, z: Infinity },
          max: { x: -Infinity, y: -Infinity, z: -Infinity },
        };
        for (const mesh of allMeshes) {
          const positions = mesh.positions;
          for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
              bounds.min.x = Math.min(bounds.min.x, x);
              bounds.min.y = Math.min(bounds.min.y, y);
              bounds.min.z = Math.min(bounds.min.z, z);
              bounds.max.x = Math.max(bounds.max.x, x);
              bounds.max.y = Math.max(bounds.max.y, y);
              bounds.max.z = Math.max(bounds.max.z, z);
            }
          }
        }

        // Create proper CoordinateInfo with shiftedBounds for camera fitting
        const serverCoordInfo = result.metadata.coordinate_info;
        const coordinateInfo = {
          originShift: serverCoordInfo?.origin_shift
            ? { x: serverCoordInfo.origin_shift[0], y: serverCoordInfo.origin_shift[1], z: serverCoordInfo.origin_shift[2] }
            : { x: 0, y: 0, z: 0 },
          originalBounds: bounds,
          shiftedBounds: bounds, // Positions are already shifted by server
          isGeoReferenced: serverCoordInfo?.is_geo_referenced ?? false,
        };

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
          // If data model was included in response, use it directly
          // Otherwise, fetch from the data model endpoint
          let dataModelBuffer = result.data_model;

          if (!dataModelBuffer || dataModelBuffer.byteLength === 0) {
            console.log('[useIfc] Fetching data model from server (background processing)...');
            dataModelBuffer = await client.fetchDataModel(cacheKey);
          }

          if (!dataModelBuffer) {
            console.log('[useIfc] ⚡ Data model not available - property panel disabled');
            return;
          }

          const dataModel = await decodeDataModel(dataModelBuffer);

          console.log(`[useIfc] Data model decoded in ${(performance.now() - dataModelStart).toFixed(0)}ms`);
          console.log(`  Entities: ${dataModel.entities.size}`);
          console.log(`  PropertySets: ${dataModel.propertySets.size}`);
          console.log(`  Relationships: ${dataModel.relationships.length}`);
          console.log(`  Spatial nodes: ${dataModel.spatialHierarchy.nodes.length}`);

          // Convert server data model to IfcDataStore format
          // Build spatial hierarchy from server data

          // Helper function to convert IFC type name to enum
          const ifcTypeNameToEnum = (typeName: string): IfcTypeEnum => {
            return IfcTypeEnumFromString(typeName);
          };

          // Build recursive SpatialNode tree
          const buildSpatialNodeTree = (
            nodeId: number,
            nodesMap: Map<number, typeof dataModel.spatialHierarchy.nodes[0]>
          ): SpatialNode => {
            const node = nodesMap.get(nodeId);
            if (!node) {
              throw new Error(`Spatial node ${nodeId} not found`);
            }

            const typeEnum = ifcTypeNameToEnum(node.type_name);

            return {
              expressId: node.entity_id,
              type: typeEnum,
              name: node.name || node.type_name,
              elevation: node.elevation,
              children: node.children_ids.map(childId =>
                buildSpatialNodeTree(childId, nodesMap)
              ),
              elements: node.element_ids,
            };
          };

          // Build lookup maps from spatial hierarchy data
          const byStorey = new Map<number, number[]>();
          const byBuilding = new Map<number, number[]>();
          const bySite = new Map<number, number[]>();
          const bySpace = new Map<number, number[]>();
          const storeyElevations = new Map<number, number>();

          const nodesMap = new Map(
            dataModel.spatialHierarchy.nodes.map(n => [n.entity_id, n])
          );

          for (const node of dataModel.spatialHierarchy.nodes) {
            const typeUpper = node.type_name.toUpperCase();
            if (typeUpper === 'IFCBUILDINGSTOREY') {
              byStorey.set(node.entity_id, node.element_ids);
              if (node.elevation !== undefined) {
                storeyElevations.set(node.entity_id, node.elevation);
              }
            } else if (typeUpper === 'IFCBUILDING') {
              byBuilding.set(node.entity_id, node.element_ids);
            } else if (typeUpper === 'IFCSITE') {
              bySite.set(node.entity_id, node.element_ids);
            } else if (typeUpper === 'IFCSPACE') {
              bySpace.set(node.entity_id, node.element_ids);
            }
          }

          // Build project node tree
          const projectNode = buildSpatialNodeTree(
            dataModel.spatialHierarchy.project_id,
            nodesMap
          );

          // Create SpatialHierarchy object with helper methods
          const spatialHierarchy: SpatialHierarchy = {
            project: projectNode,
            byStorey,
            byBuilding,
            bySite,
            bySpace,
            storeyElevations,
            elementToStorey: dataModel.spatialHierarchy.element_to_storey,
            getStoreyElements: (storeyId: number) => byStorey.get(storeyId) || [],
            getStoreyByElevation: (z: number) => {
              // Find closest storey by elevation
              let closest: [number, number] | null = null;
              for (const [storeyId, elev] of storeyElevations) {
                const diff = Math.abs(elev - z);
                if (!closest || diff < closest[1]) {
                  closest = [storeyId, diff];
                }
              }
              return closest ? closest[0] : null;
            },
            getContainingSpace: (elementId: number) => {
              return dataModel.spatialHierarchy.element_to_space.get(elementId) || null;
            },
            getPath: (elementId: number) => {
              // Build path from element up to project
              const path: SpatialNode[] = [];
              let currentId: number | undefined = elementId;

              // First, find which spatial node contains this element
              let containingNodeId: number | undefined;
              for (const [spatialId, elements] of byStorey) {
                if (elements.includes(elementId)) {
                  containingNodeId = spatialId;
                  break;
                }
              }
              if (!containingNodeId) {
                for (const [spatialId, elements] of bySpace) {
                  if (elements.includes(elementId)) {
                    containingNodeId = spatialId;
                    break;
                  }
                }
              }

              // Build path from containing node up to project
              currentId = containingNodeId;
              while (currentId) {
                const node = nodesMap.get(currentId);
                if (!node) break;
                path.unshift(buildSpatialNodeTree(currentId, nodesMap));
                currentId = node.parent_id || undefined;
              }

              return path;
            },
          };

          // ===== OPTIMIZED: Build all data structures in single pass =====
          const strings = new StringTable();
          const entityCount = dataModel.entities.size;

          // Pre-allocate TypedArrays
          const expressId = new Uint32Array(entityCount);
          const typeEnumArr = new Uint16Array(entityCount);
          const globalIdArr = new Uint32Array(entityCount);
          const nameArr = new Uint32Array(entityCount);
          const descriptionArr = new Uint32Array(entityCount);
          const objectTypeArr = new Uint32Array(entityCount);
          const flagsArr = new Uint8Array(entityCount);
          const containedInStoreyArr = new Int32Array(entityCount).fill(-1);
          const definedByTypeArr = new Int32Array(entityCount).fill(-1);
          const geometryIndexArr = new Int32Array(entityCount).fill(-1);

          // Maps for fast lookup
          const idToIndex = new Map<number, number>();
          const entityByIdMap = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
          const typeGroups = new Map<IfcTypeEnum, number[]>();

          // Single pass through entities
          let idx = 0;
          for (const [id, entity] of dataModel.entities) {
            idToIndex.set(id, idx);
            expressId[idx] = id;
            const typeVal = IfcTypeEnumFromString(entity.type_name);
            typeEnumArr[idx] = typeVal;
            globalIdArr[idx] = strings.intern(entity.global_id || '');
            nameArr[idx] = strings.intern(entity.name || '');
            // Server data may have description and object_type as optional fields
            descriptionArr[idx] = strings.intern((entity as { description?: string }).description || '');
            objectTypeArr[idx] = strings.intern((entity as { object_type?: string }).object_type || '');
            flagsArr[idx] = entity.has_geometry ? EntityFlags.HAS_GEOMETRY : 0;

            // Build entityByIdMap for entityIndex
            entityByIdMap.set(id, {
              expressId: id,
              type: entity.type_name,
              byteOffset: 0,
              byteLength: 0,
              lineNumber: 0,
            });

            // Group by type
            if (!typeGroups.has(typeVal)) {
              typeGroups.set(typeVal, []);
            }
            typeGroups.get(typeVal)!.push(idx);
            idx++;
          }

          // Build type ranges
          const typeRanges = new Map<IfcTypeEnum, { start: number; end: number }>();
          let rangeIdx = 0;
          for (const [type, indices] of Array.from(typeGroups.entries()).sort((a, b) => a[0] - b[0])) {
            typeRanges.set(type, { start: rangeIdx, end: rangeIdx + indices.length });
            rangeIdx += indices.length;
          }

          // EntityTable with methods
          const indexOfId = (id: number): number => idToIndex.get(id) ?? -1;

          const entities: EntityTable = {
            count: entityCount,
            expressId,
            typeEnum: typeEnumArr,
            globalId: globalIdArr,
            name: nameArr,
            description: descriptionArr,
            objectType: objectTypeArr,
            flags: flagsArr,
            containedInStorey: containedInStoreyArr,
            definedByType: definedByTypeArr,
            geometryIndex: geometryIndexArr,
            typeRanges,
            getGlobalId: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? strings.get(globalIdArr[i]) : '';
            },
            getName: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? strings.get(nameArr[i]) : '';
            },
            getDescription: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? strings.get(descriptionArr[i]) : '';
            },
            getObjectType: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? strings.get(objectTypeArr[i]) : '';
            },
            getTypeName: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? IfcTypeEnumToString(typeEnumArr[i]) : 'Unknown';
            },
            hasGeometry: (id) => {
              const i = indexOfId(id);
              return i >= 0 ? (flagsArr[i] & EntityFlags.HAS_GEOMETRY) !== 0 : false;
            },
            getByType: (type) => {
              const range = typeRanges.get(type);
              if (!range) return [];
              const ids: number[] = [];
              for (let j = range.start; j < range.end; j++) {
                ids.push(expressId[j]);
              }
              return ids;
            },
          };

          // ===== PropertyTable with getForEntity =====
          // Build entity -> pset relationships from server data
          const entityToPsets = new Map<number, Array<{ pset_id: number; pset_name: string; properties: Array<{ property_name: string; property_value: string; property_type: string }> }>>();

          // Parse relationships to link entities to their property sets
          for (const rel of dataModel.relationships) {
            if (rel.rel_type === 'IFCRELDEFINESBYPROPERTIES') {
              const pset = dataModel.propertySets.get(rel.relating_id);
              if (pset) {
                if (!entityToPsets.has(rel.related_id)) {
                  entityToPsets.set(rel.related_id, []);
                }
                entityToPsets.get(rel.related_id)!.push(pset);
              }
            }
          }

          const properties = {
            count: 0,
            entityId: new Uint32Array(0),
            psetName: new Uint32Array(0),
            psetGlobalId: new Uint32Array(0),
            propName: new Uint32Array(0),
            propType: new Uint8Array(0),
            valueString: new Uint32Array(0),
            valueReal: new Float64Array(0),
            valueInt: new Int32Array(0),
            valueBool: new Uint8Array(0),
            unitId: new Int32Array(0),
            entityIndex: new Map<number, number[]>(),
            psetIndex: new Map<number, number[]>(),
            propIndex: new Map<number, number[]>(),
            getForEntity: (exprId: number) => {
              const psets = entityToPsets.get(exprId) || [];
              return psets.map(pset => ({
                name: pset.pset_name,
                globalId: '',
                properties: pset.properties.map(p => ({
                  name: p.property_name,
                  type: 0 as const,
                  value: p.property_value,
                })),
              }));
            },
            getPropertyValue: () => null,
            findByProperty: () => [],
          };

          // ===== QuantityTable (empty but with methods) =====
          const quantities = {
            count: 0,
            entityId: new Uint32Array(0),
            qsetName: new Uint32Array(0),
            quantityName: new Uint32Array(0),
            quantityType: new Uint8Array(0),
            value: new Float64Array(0),
            unitId: new Int32Array(0),
            formula: new Uint32Array(0),
            entityIndex: new Map<number, number[]>(),
            qsetIndex: new Map<number, number[]>(),
            quantityIndex: new Map<number, number[]>(),
            getForEntity: () => [],
            getQuantityValue: () => null,
            sumByType: () => 0,
          };

          // ===== RelationshipGraph with methods =====
          // Build forward/inverse edge maps
          const forwardEdges = new Map<number, Array<{ target: number; type: RelationshipType; relationshipId: number }>>();
          const inverseEdges = new Map<number, Array<{ target: number; type: RelationshipType; relationshipId: number }>>();

          for (const rel of dataModel.relationships) {
            const relType = rel.rel_type.toUpperCase().includes('AGGREGATE') ? RelationshipType.Aggregates
              : rel.rel_type.toUpperCase().includes('CONTAINED') ? RelationshipType.ContainsElements
                : rel.rel_type.toUpperCase().includes('DEFINESBYPROP') ? RelationshipType.DefinesByProperties
                  : rel.rel_type.toUpperCase().includes('DEFINESBYTYPE') ? RelationshipType.DefinesByType
                    : rel.rel_type.toUpperCase().includes('MATERIAL') ? RelationshipType.AssociatesMaterial
                      : rel.rel_type.toUpperCase().includes('VOIDS') ? RelationshipType.VoidsElement
                        : rel.rel_type.toUpperCase().includes('FILLS') ? RelationshipType.FillsElement
                          : RelationshipType.Aggregates;

            // Forward: relating -> related
            if (!forwardEdges.has(rel.relating_id)) {
              forwardEdges.set(rel.relating_id, []);
            }
            forwardEdges.get(rel.relating_id)!.push({ target: rel.related_id, type: relType, relationshipId: 0 });

            // Inverse: related -> relating
            if (!inverseEdges.has(rel.related_id)) {
              inverseEdges.set(rel.related_id, []);
            }
            inverseEdges.get(rel.related_id)!.push({ target: rel.relating_id, type: relType, relationshipId: 0 });
          }

          const createEdgeAccessor = (edges: Map<number, Array<{ target: number; type: RelationshipType; relationshipId: number }>>) => ({
            offsets: new Map<number, number>(),
            counts: new Map<number, number>(),
            edgeTargets: new Uint32Array(0),
            edgeTypes: new Uint16Array(0),
            edgeRelIds: new Uint32Array(0),
            getEdges: (entityId: number, type?: RelationshipType) => {
              const e = edges.get(entityId) || [];
              return type !== undefined ? e.filter(edge => edge.type === type) : e;
            },
            getTargets: (entityId: number, type?: RelationshipType) => {
              const e = edges.get(entityId) || [];
              const filtered = type !== undefined ? e.filter(edge => edge.type === type) : e;
              return filtered.map(edge => edge.target);
            },
            hasAnyEdges: (entityId: number) => (edges.get(entityId)?.length ?? 0) > 0,
          });

          const relationships: RelationshipGraph = {
            forward: createEdgeAccessor(forwardEdges),
            inverse: createEdgeAccessor(inverseEdges),
            getRelated: (entityId, relType, direction) => {
              const edgeMap = direction === 'forward' ? forwardEdges : inverseEdges;
              const edges = edgeMap.get(entityId) || [];
              return edges.filter(e => e.type === relType).map(e => e.target);
            },
            hasRelationship: (sourceId, targetId, relType) => {
              const edges = forwardEdges.get(sourceId) || [];
              return edges.some(e => e.target === targetId && (relType === undefined || e.type === relType));
            },
            getRelationshipsBetween: (sourceId, targetId) => {
              const edges = forwardEdges.get(sourceId) || [];
              return edges.filter(e => e.target === targetId).map(e => ({
                relationshipId: e.relationshipId,
                type: e.type,
                typeName: RelationshipType[e.type] || 'Unknown',
              }));
            },
          };

          // Build spatial index for geometry
          const spatialIndex = allMeshes.length > 0 ? buildSpatialIndex(allMeshes) : undefined;

          // Construct dataStore compatible with parser's IfcDataStore type
          const dataStore = {
            fileSize: file.size,
            schemaVersion: result.metadata.schema_version as 'IFC2X3' | 'IFC4' | 'IFC4X3',
            entityCount,
            parseTime: result.stats.total_time_ms,
            source: new Uint8Array(0),
            entityIndex: { byId: entityByIdMap, byType: new Map() },
            strings,
            entities,
            properties,
            quantities,
            relationships,
            spatialHierarchy,
            spatialIndex,
          } as any; // Type assertion - parser IfcDataStore has slightly different type

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

  /**
   * Save to binary cache (background operation)
   */
  const saveToCache = useCallback(async (
    cacheKey: string,
    dataStore: any,
    geometry: GeometryData,
    sourceBuffer: ArrayBuffer,
    fileName: string
  ): Promise<void> => {
    try {
      const writer = new BinaryCacheWriter();

      // Adapt dataStore to cache format
      const cacheDataStore: CacheDataStore = {
        schema: dataStore.schemaVersion === 'IFC4' ? 1 : dataStore.schemaVersion === 'IFC4X3' ? 2 : 0,
        entityCount: dataStore.entityCount || dataStore.entities?.count || 0,
        strings: dataStore.strings,
        entities: dataStore.entities,
        properties: dataStore.properties,
        quantities: dataStore.quantities,
        relationships: dataStore.relationships,
        spatialHierarchy: dataStore.spatialHierarchy,
      };

      const cacheBuffer = await writer.write(
        cacheDataStore,
        geometry,
        sourceBuffer,
        { includeGeometry: true }
      );

      await setCached(cacheKey, cacheBuffer, fileName, sourceBuffer.byteLength, sourceBuffer);

      console.log(`[useIfc] Cached ${fileName} (${(cacheBuffer.byteLength / 1024 / 1024).toFixed(2)}MB cache)`);
    } catch (err) {
      console.warn('[useIfc] Failed to cache model:', err);
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const { resetViewerState } = useViewerStore.getState();

    try {
      // Reset all viewer state before loading new file
      resetViewerState();

      setLoading(true);
      setError(null);
      setProgress({ phase: 'Loading file', percent: 0 });

      // Read file
      const buffer = await file.arrayBuffer();
      const fileSizeMB = buffer.byteLength / (1024 * 1024);
      console.log(`[useIfc] File: ${file.name}, size: ${fileSizeMB.toFixed(2)}MB`);

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
            let color: [number, number, number, number];
            if (m.color) {
              color = m.color.length === 4 ? m.color as [number, number, number, number] : [m.color[0], m.color[1], m.color[2], 1.0];
            } else {
              color = [0.7, 0.7, 0.7, 1.0];
            }

            return {
              expressId: m.expressId || m.express_id || m.id || 0,
              positions,
              indices,
              normals,
              color,
              ifcType: m.ifcType || m.ifc_type || 'IfcProduct',
            };
          }).filter((m: MeshData) => m.positions.length > 0 && m.indices.length > 0); // Filter out empty meshes

          // Calculate bounds
          const bounds = {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
          };
          let totalVertices = 0;
          let totalTriangles = 0;

          for (const mesh of meshes) {
            const positions = mesh.positions;
            for (let i = 0; i < positions.length; i += 3) {
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];
              if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                bounds.min.x = Math.min(bounds.min.x, x);
                bounds.min.y = Math.min(bounds.min.y, y);
                bounds.min.z = Math.min(bounds.min.z, z);
                bounds.max.x = Math.max(bounds.max.x, x);
                bounds.max.y = Math.max(bounds.max.y, y);
                bounds.max.z = Math.max(bounds.max.z, z);
              }
            }
            totalVertices += positions.length / 3;
            totalTriangles += mesh.indices.length / 3;
          }

          const coordinateInfo = {
            originShift: { x: 0, y: 0, z: 0 },
            originalBounds: bounds,
            shiftedBounds: bounds,
            isGeoReferenced: false,
          };

          setGeometryResult({
            meshes,
            totalVertices,
            totalTriangles,
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
        } catch (err: any) {
          console.error('[useIfc] IFCX parsing failed:', err);
          setError(`IFCX parsing failed: ${err.message}`);
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
            setLoading(false);
            return;
          }
        }
      }

      // Try server parsing first (enabled by default for multi-core performance)
      // Only for IFC4 STEP files (server doesn't support IFCX)
      if (format === 'ifc' && USE_SERVER && SERVER_URL && SERVER_URL !== '') {
        setProgress({ phase: 'Trying server', percent: 8 });
        console.log(`[useIfc] Sending ${file.name} (${(buffer.byteLength / (1024 * 1024)).toFixed(2)}MB) to server at ${SERVER_URL}`);
        // Clone buffer for server parsing (prevents detachment if server fails)
        const bufferForServer = buffer.slice(0);
        const serverSuccess = await loadFromServer(file, bufferForServer);
        if (serverSuccess) {
          setLoading(false);
          return;
        }
        // Fall back to local parsing if server fails
        console.log('[useIfc] Falling back to local WASM parsing');
      } else if (format === 'unknown') {
        console.warn('[useIfc] Unknown file format - attempting to parse as IFC4 STEP');
      }

      // Cache miss - start geometry streaming IMMEDIATELY
      // Use original buffer (not detached)
      setProgress({ phase: 'Starting geometry streaming', percent: 10 });

      // Initialize geometry processor first (WASM init is fast if already loaded)
      const geometryProcessor = new GeometryProcessor({
        useWorkers: false,
        quality: GeometryQuality.Balanced
      });
      await geometryProcessor.init();

      // Start data model parsing in parallel (non-blocking)
      // This parses entities, properties, relationships for the UI panels
      // Use IfcParser directly - it has async yields every 500 entities so won't block geometry
      const parser = new IfcParser();
      const dataStorePromise = parser.parseColumnar(buffer.slice(0), {
        onProgress: (prog) => {
          // Update progress in background - don't block geometry
          console.log(`[useIfc] Data model: ${prog.phase} ${prog.percent.toFixed(0)}%`);
        },
      });

      // Handle data model completion in background
      // On-demand property extraction is now used for all modes - no background parse needed
      dataStorePromise.then(dataStore => {
        console.log('[useIfc] Data model parsing complete - properties available via on-demand extraction');
        setIfcDataStore(dataStore);
      }).catch(err => {
        console.error('[useIfc] Data model parsing failed:', err);
      });

      // Use adaptive processing: sync for small files, streaming for large files
      let estimatedTotal = 0;
      let totalMeshes = 0;
      const allMeshes: MeshData[] = []; // Collect all meshes for BVH building
      let finalCoordinateInfo: any = null;

      // Clear existing geometry result
      setGeometryResult(null);

      // Timing instrumentation
      const processingStart = performance.now();
      let batchCount = 0;
      let lastBatchTime = processingStart;
      let totalWaitTime = 0; // Time waiting for WASM to yield batches
      let totalProcessTime = 0; // Time processing batches in JS

      // OPTIMIZATION: Accumulate meshes and batch state updates
      // First batch renders immediately, then accumulate for throughput
      let pendingMeshes: MeshData[] = [];
      let lastRenderTime = 0;
      const RENDER_INTERVAL_MS = 50; // Max 20 state updates per second after first batch

      try {
        console.log(`[useIfc] Starting geometry streaming IMMEDIATELY (file size: ${fileSizeMB.toFixed(2)}MB)...`);

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
              console.log(`[useIfc] Processing started, estimated: ${estimatedTotal}`);
              break;
            case 'model-open':
              setProgress({ phase: 'Processing geometry', percent: 50 });
              console.log(`[useIfc] Model opened at ${(eventReceived - processingStart).toFixed(0)}ms`);
              break;
            case 'batch': {
              batchCount++;
              totalWaitTime += waitTime;

              const processStart = performance.now();

              // Collect meshes for BVH building
              allMeshes.push(...event.meshes);
              finalCoordinateInfo = event.coordinateInfo;
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

              // Log batch timing (first 5, then every 20th)
              if (batchCount <= 5 || batchCount % 20 === 0) {
                console.log(
                  `[useIfc] Batch #${batchCount}: ${event.meshes.length} meshes, ` +
                  `wait: ${waitTime.toFixed(0)}ms, process: ${processTime.toFixed(0)}ms, ` +
                  `total: ${totalMeshes} meshes at ${(eventReceived - processingStart).toFixed(0)}ms`
                );
              }
              break;
            }
            case 'complete':
              // Flush any remaining pending meshes
              if (pendingMeshes.length > 0) {
                appendGeometryBatch(pendingMeshes, event.coordinateInfo);
                pendingMeshes = [];
              }

              console.log(
                `[useIfc] Geometry streaming complete: ${batchCount} batches, ${event.totalMeshes} meshes\n` +
                `  Total wait (WASM): ${totalWaitTime.toFixed(0)}ms\n` +
                `  Total process (JS): ${totalProcessTime.toFixed(0)}ms\n` +
                `  First batch at: ${batchCount > 0 ? '(see Batch #1 above)' : 'N/A'}`
              );

              finalCoordinateInfo = event.coordinateInfo;

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

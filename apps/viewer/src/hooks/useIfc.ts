/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files
 * Includes binary cache support for fast subsequent loads
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality, type MeshData } from '@ifc-lite/geometry';
import { IfcQuery } from '@ifc-lite/query';
import { BufferBuilder } from '@ifc-lite/geometry';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import {
  BinaryCacheWriter,
  BinaryCacheReader,
  xxhash64Hex,
  type IfcDataStore as CacheDataStore,
  type GeometryData,
} from '@ifc-lite/cache';
import { getCached, setCached } from '../services/ifc-cache.js';
import { IfcTypeEnum, RelationshipType, type SpatialHierarchy, type SpatialNode, type EntityTable, type RelationshipGraph } from '@ifc-lite/data';

// Minimum file size to cache (10MB) - smaller files parse quickly anyway
const CACHE_SIZE_THRESHOLD = 10 * 1024 * 1024;

/**
 * Rebuild spatial hierarchy from cache data (entities + relationships)
 * This is needed because the cache doesn't serialize the spatialHierarchy directly.
 * Note: Elevations are not available since we don't have the source buffer.
 */
function rebuildSpatialHierarchy(
  entities: EntityTable,
  relationships: RelationshipGraph
): SpatialHierarchy | undefined {
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

  // Build node tree recursively
  function buildNode(expressId: number): SpatialNode {
    let typeEnum = IfcTypeEnum.Unknown;

    // Find type for this entity
    for (let i = 0; i < entities.count; i++) {
      if (entities.expressId[i] === expressId) {
        typeEnum = entities.typeEnum[i];
        break;
      }
    }

    const name = entities.getName(expressId) || `Entity #${expressId}`;

    // Get contained elements via IfcRelContainedInSpatialStructure
    const rawContainedElements = relationships.getRelated(
      expressId,
      RelationshipType.ContainsElements,
      'forward'
    );

    // Filter out spatial structure elements (storeys, buildings, etc.)
    // These should only contain actual building elements like walls, doors, etc.
    const containedElements = rawContainedElements.filter(id => {
      for (let i = 0; i < entities.count; i++) {
        if (entities.expressId[i] === id) {
          const elemType = entities.typeEnum[i];
          // Exclude spatial structure types - they shouldn't be "contained elements"
          if (
            elemType === IfcTypeEnum.IfcProject ||
            elemType === IfcTypeEnum.IfcSite ||
            elemType === IfcTypeEnum.IfcBuilding ||
            elemType === IfcTypeEnum.IfcBuildingStorey ||
            elemType === IfcTypeEnum.IfcSpace
          ) {
            return false;
          }
          return true;
        }
      }
      return true; // Keep if not found (shouldn't happen)
    });

    // Get aggregated children via IfcRelAggregates
    const aggregatedChildren = relationships.getRelated(
      expressId,
      RelationshipType.Aggregates,
      'forward'
    );

    // Filter to spatial structure types and recurse
    const childNodes: SpatialNode[] = [];
    for (const childId of aggregatedChildren) {
      let childType = IfcTypeEnum.Unknown;
      for (let i = 0; i < entities.count; i++) {
        if (entities.expressId[i] === childId) {
          childType = entities.typeEnum[i];
          break;
        }
      }

      if (
        childType === IfcTypeEnum.IfcSite ||
        childType === IfcTypeEnum.IfcBuilding ||
        childType === IfcTypeEnum.IfcBuildingStorey ||
        childType === IfcTypeEnum.IfcSpace
      ) {
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
      // Not available without source buffer
      return null;
    },

    getContainingSpace(elementId: number): number | null {
      for (const [spaceId, elementIds] of bySpace) {
        if (elementIds.includes(elementId)) {
          return spaceId;
        }
      }
      return null;
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
   * Load from binary cache (INSTANT path)
   * Key optimizations:
   * 1. Single setGeometryResult call instead of batched appendGeometryBatch
   * 2. Build spatial index in requestIdleCallback (non-blocking)
   */
  const loadFromCache = useCallback(async (
    cacheBuffer: ArrayBuffer,
    fileName: string
  ): Promise<boolean> => {
    try {
      console.time('[useIfc] cache-load');
      setProgress({ phase: 'Loading from cache', percent: 10 });

      // IMPORTANT: Reset geometry first so Viewport detects this as a new file
      // This ensures camera fitting and bounds are properly reset
      setGeometryResult(null);

      const reader = new BinaryCacheReader();
      const result = await reader.read(cacheBuffer);

      // Convert cache data store to viewer data store format
      const dataStore = result.dataStore as any;

      // Rebuild spatial hierarchy from cache data (cache doesn't serialize it)
      if (!dataStore.spatialHierarchy && dataStore.entities && dataStore.relationships) {
        console.time('[useIfc] rebuild-spatial-hierarchy');
        dataStore.spatialHierarchy = rebuildSpatialHierarchy(
          dataStore.entities,
          dataStore.relationships
        );
        console.timeEnd('[useIfc] rebuild-spatial-hierarchy');
      }

      if (result.geometry) {
        const { meshes, coordinateInfo, totalVertices, totalTriangles } = result.geometry;

        // INSTANT: Set ALL geometry in ONE state update (no batching!)
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
          // Use requestIdleCallback for non-blocking BVH build
          const buildIndex = () => {
            console.time('[useIfc] spatial-index-background');
            try {
              const spatialIndex = buildSpatialIndex(meshes);
              dataStore.spatialIndex = spatialIndex;
              // Update store with spatial index (doesn't affect rendering)
              setIfcDataStore({ ...dataStore });
              console.timeEnd('[useIfc] spatial-index-background');
            } catch (err) {
              console.warn('[useIfc] Failed to build spatial index:', err);
            }
          };

          // Schedule for idle time, or fallback to setTimeout
          if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(buildIndex, { timeout: 1000 });
          } else {
            setTimeout(buildIndex, 100);
          }
        }
      } else {
        setIfcDataStore(dataStore);
      }

      setProgress({ phase: 'Complete (from cache)', percent: 100 });
      console.timeEnd('[useIfc] cache-load');
      console.log(`[useIfc] INSTANT load: ${fileName} from cache (${result.geometry?.meshes.length || 0} meshes)`);

      return true;
    } catch (err) {
      console.error('[useIfc] Failed to load from cache:', err);
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
      console.time('[useIfc] cache-write');

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

      await setCached(cacheKey, cacheBuffer, fileName, sourceBuffer.byteLength);

      console.timeEnd('[useIfc] cache-write');
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

      // Compute cache key (hash of file content)
      setProgress({ phase: 'Checking cache', percent: 5 });
      const cacheKey = xxhash64Hex(buffer);
      console.log(`[useIfc] File: ${file.name}, size: ${fileSizeMB.toFixed(2)}MB, hash: ${cacheKey}`);

      // Try to load from cache first (only for files above threshold)
      if (buffer.byteLength >= CACHE_SIZE_THRESHOLD) {
        const cachedBuffer = await getCached(cacheKey);
        if (cachedBuffer) {
          const success = await loadFromCache(cachedBuffer, file.name);
          if (success) {
            setLoading(false);
            return;
          }
          // Cache load failed, fall through to normal parsing
          console.log('[useIfc] Cache load failed, falling back to parsing');
        }
      }

      // Cache miss or small file - parse normally
      setProgress({ phase: 'Parsing IFC', percent: 10 });

      // Parse IFC using columnar parser
      const parser = new IfcParser();
      const dataStore = await parser.parseColumnar(buffer, {
        onProgress: (prog) => {
          setProgress({
            phase: `Parsing: ${prog.phase}`,
            percent: 10 + (prog.percent * 0.4),
          });
        },
      });

      setIfcDataStore(dataStore);
      setProgress({ phase: 'Triangulating geometry', percent: 50 });

      // Process geometry with streaming for progressive rendering
      // Quality: Fast for speed, Balanced for quality, High for best quality
      const geometryProcessor = new GeometryProcessor({
        useWorkers: false,
        quality: GeometryQuality.Balanced // Can be GeometryQuality.Fast, Balanced, or High
      });
      await geometryProcessor.init();

      // Pass entity index for priority-based loading
      const entityIndexMap = new Map<number, any>();
      if (dataStore.entityIndex?.byId) {
        for (const [id, ref] of dataStore.entityIndex.byId) {
          entityIndexMap.set(id, { type: ref.type });
        }
      }

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

      try {
        console.log(`[useIfc] Starting adaptive processing (file size: ${fileSizeMB.toFixed(2)}MB)...`);
        console.time('[useIfc] total-processing');

        for await (const event of geometryProcessor.processAdaptive(new Uint8Array(buffer), {
          sizeThreshold: 2 * 1024 * 1024, // 2MB threshold
          batchSize: 25,
          entityIndex: entityIndexMap,
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

              // Append mesh batch to store (triggers React re-render)
              appendGeometryBatch(event.meshes, event.coordinateInfo);
              totalMeshes = event.totalSoFar;

              // Update progress (50-95% for geometry processing)
              const progressPercent = 50 + Math.min(45, (totalMeshes / Math.max(estimatedTotal / 10, totalMeshes)) * 45);
              setProgress({
                phase: `Rendering geometry (${totalMeshes} meshes)`,
                percent: progressPercent
              });

              const processTime = performance.now() - processStart;
              totalProcessTime += processTime;

              // Log batch timing (first 5, then every 10th)
              if (batchCount <= 5 || batchCount % 10 === 0) {
                console.log(
                  `[useIfc] Batch #${batchCount}: ${event.meshes.length} meshes, ` +
                  `wait: ${waitTime.toFixed(0)}ms, process: ${processTime.toFixed(0)}ms, ` +
                  `total: ${totalMeshes} meshes at ${(eventReceived - processingStart).toFixed(0)}ms`
                );
              }
              break;
            }
            case 'complete':
              console.log(
                `[useIfc] Processing complete: ${batchCount} batches, ${event.totalMeshes} meshes\n` +
                `  Total wait (WASM): ${totalWaitTime.toFixed(0)}ms\n` +
                `  Total process (JS): ${totalProcessTime.toFixed(0)}ms\n` +
                `  First batch at: ${batchCount > 0 ? '(see Batch #1 above)' : 'N/A'}`
              );
              console.timeEnd('[useIfc] total-processing');

              finalCoordinateInfo = event.coordinateInfo;

              // Update geometry result with final coordinate info
              updateCoordinateInfo(event.coordinateInfo);

              // Build spatial index from meshes
              if (allMeshes.length > 0) {
                setProgress({ phase: 'Building spatial index', percent: 95 });
                console.time('[useIfc] spatial-index');
                try {
                  const spatialIndex = buildSpatialIndex(allMeshes);
                  (dataStore as any).spatialIndex = spatialIndex;
                  setIfcDataStore(dataStore);
                  console.timeEnd('[useIfc] spatial-index');
                } catch (err) {
                  console.timeEnd('[useIfc] spatial-index');
                  console.warn('[useIfc] Failed to build spatial index:', err);
                }
              }

              setProgress({ phase: 'Complete', percent: 100 });

              // Cache the result in the background (for files above threshold)
              if (buffer.byteLength >= CACHE_SIZE_THRESHOLD && allMeshes.length > 0 && finalCoordinateInfo) {
                // Don't await - let it run in background
                const geometryData: GeometryData = {
                  meshes: allMeshes,
                  totalVertices: allMeshes.reduce((sum, m) => sum + m.positions.length / 3, 0),
                  totalTriangles: allMeshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
                  coordinateInfo: finalCoordinateInfo,
                };
                saveToCache(cacheKey, dataStore, geometryData, buffer, file.name);
              }
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

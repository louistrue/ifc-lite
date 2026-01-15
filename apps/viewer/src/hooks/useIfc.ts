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
  type IfcDataStore as CacheDataStore,
  type GeometryData,
} from '@ifc-lite/cache';
import { getCached, setCached } from '../services/ifc-cache.js';
import { IfcTypeEnum, RelationshipType, type SpatialHierarchy, type SpatialNode, type EntityTable, type RelationshipGraph } from '@ifc-lite/data';

// Minimum file size to cache (10MB) - smaller files parse quickly anyway
const CACHE_SIZE_THRESHOLD = 10 * 1024 * 1024;

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
   * Load from binary cache - INSTANT load for maximum speed
   * Large cached models load all geometry at once for fastest total time
   */
  const loadFromCache = useCallback(async (
    cacheBuffer: ArrayBuffer,
    fileName: string
  ): Promise<boolean> => {
    try {
      console.time('[useIfc] cache-load');
      setProgress({ phase: 'Loading from cache', percent: 10 });

      // Reset geometry first so Viewport detects this as a new file
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
      console.timeEnd('[useIfc] cache-load');
      console.log(`[useIfc] INSTANT cache load: ${fileName} (${result.geometry?.meshes.length || 0} meshes)`);

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
      console.log(`[useIfc] File: ${file.name}, size: ${fileSizeMB.toFixed(2)}MB`);

      // INSTANT cache lookup: Use filename + size as key (no hashing!)
      // Same filename + same size = same file (fast and reliable enough)
      const cacheKey = `${file.name}-${buffer.byteLength}`;

      if (buffer.byteLength >= CACHE_SIZE_THRESHOLD) {
        setProgress({ phase: 'Checking cache', percent: 5 });
        const cachedBuffer = await getCached(cacheKey);
        if (cachedBuffer) {
          const success = await loadFromCache(cachedBuffer, file.name);
          if (success) {
            setLoading(false);
            return;
          }
        }
      }

      // Cache miss - start geometry streaming IMMEDIATELY
      setProgress({ phase: 'Starting geometry streaming', percent: 10 });

      // Initialize geometry processor first (WASM init is fast if already loaded)
      const geometryProcessor = new GeometryProcessor({
        useWorkers: false,
        quality: GeometryQuality.Balanced
      });
      await geometryProcessor.init();

      // Start data model parsing in PARALLEL (non-blocking)
      // This parses entities, properties, relationships for the UI panels
      const parser = new IfcParser();
      const dataStorePromise = parser.parseColumnar(buffer, {
        onProgress: (prog) => {
          // Update progress in background - don't block geometry
          console.log(`[useIfc] Data model: ${prog.phase} ${prog.percent.toFixed(0)}%`);
        },
      });

      // Handle data model completion in background
      dataStorePromise.then(dataStore => {
        console.log('[useIfc] Data model parsing complete - enabling property panel');
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
        console.time('[useIfc] total-processing');

        for await (const event of geometryProcessor.processAdaptive(new Uint8Array(buffer), {
          sizeThreshold: 2 * 1024 * 1024, // 2MB threshold
          batchSize: 100, // Large batches for maximum throughput
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
              console.timeEnd('[useIfc] total-processing');

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
                    console.time('[useIfc] spatial-index-background');
                    try {
                      const spatialIndex = buildSpatialIndex(allMeshes);
                      (dataStore as any).spatialIndex = spatialIndex;
                      setIfcDataStore({ ...dataStore });
                      console.timeEnd('[useIfc] spatial-index-background');
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

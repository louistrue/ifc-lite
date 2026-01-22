/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for IFC file caching operations
 * Handles loading from and saving to binary cache for fast subsequent loads
 *
 * Extracted from useIfc.ts for better separation of concerns
 */

import { useCallback } from 'react';
import {
  BinaryCacheWriter,
  BinaryCacheReader,
  type IfcDataStore as CacheDataStore,
  type GeometryData,
} from '@ifc-lite/cache';
import { SpatialHierarchyBuilder, extractLengthUnitScale, type IfcDataStore } from '@ifc-lite/parser';
import { buildSpatialIndex } from '@ifc-lite/spatial';
import type { MeshData } from '@ifc-lite/geometry';

import { useViewerStore } from '../store.js';
import { getCached, setCached, type CacheResult } from '../services/cacheService.js';
import { rebuildSpatialHierarchy, rebuildOnDemandMaps } from '../utils/spatialHierarchy.js';
import { calculateStoreyHeights } from '../utils/localParsingUtils.js';

// Re-export types for convenience
export type { CacheResult } from '../services/cacheService.js';
export { getCached, setCached } from '../services/cacheService.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Progress callback for cache operations
 */
export interface CacheProgress {
  phase: string;
  percent: number;
}

/**
 * Geometry result from cache
 */
export interface CacheGeometryResult {
  meshes: MeshData[];
  totalVertices: number;
  totalTriangles: number;
  coordinateInfo?: {
    originShift: { x: number; y: number; z: number };
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  };
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook providing cache loading and saving operations
 */
export function useIfcCache() {
  const {
    setProgress,
    setIfcDataStore,
    setGeometryResult,
  } = useViewerStore();

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
          if (!typeList) {
            typeList = [];
            entityIndex.byType.set(ref.type, typeList);
          }
          typeList.push(ref.expressId);
        }
        dataStore.entityIndex = entityIndex;

        // Rebuild on-demand maps from relationships
        // Pass entityIndex which contains ALL entity types including IfcPropertySet/IfcElementQuantity
        // (the entity table may not include these since they're filtered during fresh parse)
        const { onDemandPropertyMap, onDemandQuantityMap } = rebuildOnDemandMaps(
          dataStore.entities,
          dataStore.relationships,
          dataStore.entityIndex
        );
        dataStore.onDemandPropertyMap = onDemandPropertyMap;
        dataStore.onDemandQuantityMap = onDemandQuantityMap;
      } else {
        console.warn('[useIfcCache] No source buffer in cache - on-demand property extraction disabled');
        dataStore.source = new Uint8Array(0);
      }

      // Rebuild spatial hierarchy from cache data (cache doesn't serialize it)
      // Use SpatialHierarchyBuilder to extract elevations from source buffer
      if (!dataStore.spatialHierarchy && dataStore.entities && dataStore.relationships) {
        // Ensure we have source buffer and entityIndex for elevation extraction
        if (dataStore.source && dataStore.source.length > 0 && dataStore.entityIndex && dataStore.strings) {
          const lengthUnitScale = extractLengthUnitScale(dataStore.source, dataStore.entityIndex);
          const builder = new SpatialHierarchyBuilder();
          dataStore.spatialHierarchy = builder.build(
            dataStore.entities,
            dataStore.relationships,
            dataStore.strings,
            dataStore.source,
            dataStore.entityIndex,
            lengthUnitScale
          );

          // Calculate storey heights from elevation differences (fallback if no property data)
          if (dataStore.spatialHierarchy.storeyHeights.size === 0 && dataStore.spatialHierarchy.storeyElevations.size > 1) {
            const calculatedHeights = calculateStoreyHeights(dataStore.spatialHierarchy.storeyElevations);
            for (const [storeyId, height] of calculatedHeights) {
              dataStore.spatialHierarchy.storeyHeights.set(storeyId, height);
            }
          }
        } else {
          console.warn('[useIfcCache] Missing data for elevation extraction:', {
            hasSource: !!dataStore.source,
            sourceLength: dataStore.source?.length ?? 0,
            hasEntityIndex: !!dataStore.entityIndex,
            hasStrings: !!dataStore.strings,
          });
          // Fallback: use simplified rebuild if source data not available
          dataStore.spatialHierarchy = rebuildSpatialHierarchy(
            dataStore.entities,
            dataStore.relationships
          );
        }
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
          const buildIndex = () => {
            try {
              const spatialIndex = buildSpatialIndex(meshes);
              dataStore.spatialIndex = spatialIndex;
              setIfcDataStore({ ...dataStore });
            } catch (err) {
              console.warn('[useIfcCache] Failed to build spatial index:', err);
            }
          };

          if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(buildIndex, { timeout: 2000 });
          } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(buildIndex, 100);
          }
        }
      } else {
        setIfcDataStore(dataStore);
      }

      setProgress({ phase: 'Complete (from cache)', percent: 100 });
      const totalCacheTime = performance.now() - cacheLoadStart;
      const meshCount = result.geometry?.meshes.length || 0;
      console.log(`[useIfcCache] ✓ ${fileName} (cached) → ${meshCount} meshes | ${totalCacheTime.toFixed(0)}ms`);

      return true;
    } catch (err) {
      console.error('[useIfcCache] Failed to load from cache:', err);
      return false;
    }
  }, [setProgress, setIfcDataStore, setGeometryResult]);

  /**
   * Save parsed data and geometry to cache
   */
  const saveToCache = useCallback(async (
    cacheKey: string,
    dataStore: IfcDataStore,
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

      const cacheBuffer = await writer.write(cacheDataStore, geometry, sourceBuffer, { includeGeometry: true });

      await setCached(cacheKey, cacheBuffer, fileName, sourceBuffer.byteLength, sourceBuffer);
    } catch (err) {
      console.warn('[useIfcCache] Failed to cache model:', err);
    }
  }, []);

  return {
    loadFromCache,
    saveToCache,
    getCached,
    setCached,
  };
}

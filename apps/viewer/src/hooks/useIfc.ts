/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for loading and processing IFC files
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality, type MeshData } from '@ifc-lite/geometry';
import { IfcQuery } from '@ifc-lite/query';
import { BufferBuilder } from '@ifc-lite/geometry';
import { buildSpatialIndex } from '@ifc-lite/spatial';

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

      // Use streaming processing for progressive rendering
      const bufferBuilder = new BufferBuilder();
      let estimatedTotal = 0;
      let totalMeshes = 0;
      const allMeshes: MeshData[] = []; // Collect all meshes for BVH building

      // Clear existing geometry result
      setGeometryResult(null);

      try {
        for await (const event of geometryProcessor.processStreaming(new Uint8Array(buffer), entityIndexMap, 100)) {
          switch (event.type) {
            case 'start':
              estimatedTotal = event.totalEstimate;
              break;
            case 'model-open':
              setProgress({ phase: 'Processing geometry', percent: 50 });
              break;
            case 'batch':
              // Collect meshes for BVH building
              allMeshes.push(...event.meshes);
              
              // Convert MeshData[] to GPU-ready format and append
              const gpuMeshes = bufferBuilder.processMeshes(event.meshes).meshes;
              appendGeometryBatch(gpuMeshes, event.coordinateInfo);
              totalMeshes = event.totalSoFar;

              // Update progress (50-95% for geometry processing)
              const progressPercent = 50 + Math.min(45, (totalMeshes / Math.max(estimatedTotal, totalMeshes)) * 45);
              setProgress({
                phase: `Rendering geometry (${totalMeshes} meshes)`,
                percent: progressPercent
              });
              break;
            case 'complete':
              // Update geometry result with final coordinate info
              updateCoordinateInfo(event.coordinateInfo);
              
              // Build spatial index from all collected meshes
              if (allMeshes.length > 0) {
                setProgress({ phase: 'Building spatial index', percent: 95 });
                try {
                  const spatialIndex = buildSpatialIndex(allMeshes);
                  // Attach spatial index to dataStore
                  (dataStore as any).spatialIndex = spatialIndex;
                  setIfcDataStore(dataStore); // Update store with spatial index
                } catch (err) {
                  console.warn('[useIfc] Failed to build spatial index:', err);
                  // Continue without spatial index - it's optional
                }
              }
              
              setProgress({ phase: 'Complete', percent: 100 });
              break;
          }
        }
      } catch (err) {
        console.error('[useIfc] Error in streaming processing:', err);
        setError(err instanceof Error ? err.message : 'Unknown error during geometry processing');
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [setLoading, setError, setProgress, setIfcDataStore, setGeometryResult, appendGeometryBatch, updateCoordinateInfo]);

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

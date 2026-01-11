/**
 * Hook for loading and processing IFC files
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor, GeometryQuality } from '@ifc-lite/geometry';
import { IfcQuery } from '@ifc-lite/query';
import { BufferBuilder } from '@ifc-lite/geometry';

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
    try {
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

      // Clear existing geometry result
      setGeometryResult(null);

      try {
        console.log('[useIfc] Starting streaming geometry processing...');
        for await (const event of geometryProcessor.processStreaming(new Uint8Array(buffer), entityIndexMap, 100)) {
          console.log('[useIfc] Streaming event:', event.type);
          switch (event.type) {
            case 'start':
              estimatedTotal = event.totalEstimate;
              console.log('[useIfc] Start event, estimated total:', estimatedTotal);
              break;
            case 'model-open':
              setProgress({ phase: 'Processing geometry', percent: 50 });
              console.log('[useIfc] Model opened, ID:', event.modelID);
              break;
            case 'batch':
              // Convert MeshData[] to GPU-ready format and append
              console.log('[useIfc] Batch event:', event.meshes.length, 'meshes, total so far:', event.totalSoFar);
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
              console.log('[useIfc] Complete event, total meshes:', event.totalMeshes);
              // Use functional update to get current state (avoids stale closure)
              updateCoordinateInfo(event.coordinateInfo);
              setProgress({ phase: 'Complete', percent: 100 });
              break;
          }
        }
        console.log('[useIfc] Streaming processing complete');
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
    const shouldLog = lastLoggedDataStoreRef.current !== ifcDataStore;
    if (shouldLog) {
      lastLoggedDataStoreRef.current = ifcDataStore;
      console.log('[useIfc] Entity count:', ifcDataStore.entityCount);
      console.log('[useIfc] Properties available via columnar table');
    }

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

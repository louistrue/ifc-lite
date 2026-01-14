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

      // Use adaptive processing: sync for small files, streaming for large files
      let estimatedTotal = 0;
      let totalMeshes = 0;
      const allMeshes: MeshData[] = []; // Collect all meshes for BVH building

      // Clear existing geometry result
      setGeometryResult(null);

      // Timing instrumentation
      const processingStart = performance.now();
      let batchCount = 0;
      let lastBatchTime = processingStart;
      let totalWaitTime = 0; // Time waiting for WASM to yield batches
      let totalProcessTime = 0; // Time processing batches in JS

      try {
        const fileSizeMB = buffer.byteLength / (1024 * 1024);
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

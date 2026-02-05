import { useRef, useEffect, useState, useCallback } from 'react';
import { GeometryProcessor } from '@ifc-lite/geometry';
import type { MeshData } from '@ifc-lite/geometry';
import type { Renderer } from '@ifc-lite/renderer';

interface LoaderState {
  loading: boolean;
  progress: number;
  error: string | null;
}

/**
 * Handles IFC model fetching, WASM geometry processing, and progressive
 * upload to the Renderer.
 *
 * Key behaviors:
 * - Caches the loaded URL to avoid re-parsing when Superset re-renders
 * - Uses processAdaptive() for streaming (large files) or sync (small files)
 * - Accumulates all MeshData for later instancing optimization
 * - Cancels in-flight loads when the URL changes or component unmounts
 */
export function useIFCLoader(
  rendererRef: React.RefObject<Renderer | null>,
  rendererReady: boolean,
  modelUrl: string,
) {
  const processorRef = useRef<GeometryProcessor | null>(null);
  const loadedUrlRef = useRef('');
  const allMeshesRef = useRef<MeshData[]>([]);
  const [state, setState] = useState<LoaderState>({
    loading: false,
    progress: 0,
    error: null,
  });

  // Initialize the geometry processor once
  useEffect(() => {
    const processor = new GeometryProcessor();
    processorRef.current = processor;

    let disposed = false;
    processor.init().catch((err: Error) => {
      if (!disposed) {
        setState((s) => ({
          ...s,
          error: `WASM init failed: ${err.message}`,
        }));
      }
    });

    return () => {
      disposed = true;
      processor.dispose();
      processorRef.current = null;
    };
  }, []);

  // Load model when URL changes (and renderer + processor are ready)
  useEffect(() => {
    const renderer = rendererRef.current;
    const processor = processorRef.current;

    if (!renderer || !rendererReady || !processor || !modelUrl) return;
    if (modelUrl === loadedUrlRef.current) return; // Already loaded

    let cancelled = false;
    allMeshesRef.current = [];

    setState({ loading: true, progress: 0, error: null });

    (async () => {
      // Fetch the IFC file
      const response = await fetch(modelUrl);
      if (cancelled) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;

      // Process geometry with adaptive streaming
      for await (const event of processor.processAdaptive(buffer, {
        sizeThreshold: 2 * 1024 * 1024,
        batchSize: { initialBatchSize: 50, maxBatchSize: 500 },
      })) {
        if (cancelled) return;

        switch (event.type) {
          case 'batch': {
            renderer.addMeshes(event.meshes, true);
            // Accumulate for potential instancing optimization later
            for (const mesh of event.meshes) {
              allMeshesRef.current.push(mesh);
            }
            setState((s) => ({
              ...s,
              progress: event.totalSoFar,
            }));
            break;
          }
          case 'complete': {
            renderer.fitToView();
            break;
          }
        }
      }

      if (!cancelled) {
        loadedUrlRef.current = modelUrl;
        setState({ loading: false, progress: allMeshesRef.current.length, error: null });
      }
    })().catch((err: Error) => {
      if (!cancelled) {
        setState({ loading: false, progress: 0, error: `Load failed: ${err.message}` });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rendererRef, rendererReady, modelUrl]);

  /** Get all loaded meshes (for instancing optimization or property lookup). */
  const getAllMeshes = useCallback(() => allMeshesRef.current, []);

  return {
    ...state,
    getAllMeshes,
  };
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import type { IFCViewerProps } from './types.js';
import { useIFCRenderer } from './hooks/useIFCRenderer.js';
import { useIFCLoader } from './hooks/useIFCLoader.js';
import { useEntityColorMap, useNumericEntitySet } from './hooks/useEntityColorMap.js';
import { useCameraControls } from './hooks/useCameraControls.js';

/**
 * IFC 3D Viewer chart component for Apache Superset.
 *
 * This component is lazy-loaded via `loadChart: () => import('./IFCViewerChart')`
 * so its entire dependency tree (WebGPU renderer, WASM geometry processor) is
 * code-split away from Superset's main bundle.
 *
 * Lifecycle:
 * 1. Mount → create canvas → init WebGPU Renderer
 * 2. modelUrl set → fetch IFC → stream geometry → progressive render
 * 3. entityColorMap changes → re-render with updated colors
 * 4. Unmount → destroy GPUDevice (prevents context exhaustion)
 */
const IFCViewerChart: React.FC<IFCViewerProps> = ({
  width,
  height,
  modelUrl,
  entityColorMap,
  backgroundColor,
  enablePicking,
  setDataMask,
  entityIdColumn,
  filteredEntityIds,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // ---- WebGPU Renderer lifecycle ----
  const { rendererRef, isReady, error: rendererError, resize } = useIFCRenderer(canvasRef);

  // ---- IFC model loading ----
  const {
    loading,
    progress,
    error: loaderError,
  } = useIFCLoader(rendererRef, isReady, modelUrl);

  // ---- Color & filter maps (string → numeric conversion) ----
  const numericColorMap = useEntityColorMap(entityColorMap);
  const isolatedIds = useNumericEntitySet(filteredEntityIds);

  // ---- Camera controls (orbit, pan, zoom) ----
  const { onPointerDown, onPointerMove, onPointerUp, onWheel } = useCameraControls(
    rendererRef,
    canvasRef,
    isReady,
    backgroundColor,
  );

  // ---- Handle resize ----
  useEffect(() => {
    resize(width, height);
  }, [width, height, resize]);

  // ---- Render when colors, isolation, or background change ----
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady()) return;

    // Cancel any pending frame to avoid double-rendering
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      // TODO: When the renderer supports per-entity color overrides,
      // apply numericColorMap here before rendering.
      // For now, we render with the model's original colors and
      // use isolation to highlight filtered entities.

      renderer.render({
        clearColor: backgroundColor,
        isolatedIds: isolatedIds ?? undefined,
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  // Also re-render when loading completes (loading changes from true to false)
  // NOTE: numericColorMap intentionally excluded — add when renderer supports per-entity color overrides
  }, [rendererRef, isolatedIds, backgroundColor, loading]);

  // ---- Click handler → cross-filter ----
  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!enablePicking || !setDataMask || !entityIdColumn) return;

      const renderer = rendererRef.current;
      if (!renderer?.isReady()) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      try {
        const result = await renderer.pick(x, y);

        if (result) {
          // Entity clicked → apply cross-filter
          setDataMask({
            extraFormData: {
              filters: [
                {
                  col: entityIdColumn,
                  op: '==',
                  val: String(result.expressId),
                },
              ],
            },
            filterState: {
              value: String(result.expressId),
            },
          });
        } else {
          // Background clicked → clear cross-filter
          setDataMask({
            extraFormData: { filters: [] },
            filterState: { value: null },
          });
        }
      } catch {
        // Pick failed — ignore silently (e.g., GPU context lost)
      }
    },
    [enablePicking, setDataMask, entityIdColumn, rendererRef],
  );

  // ---- Combine errors ----
  const error = rendererError ?? loaderError;

  // ---- Status overlay ----
  const statusOverlay = useMemo(() => {
    if (error) {
      return (
        <div style={styles.errorOverlay}>
          <div style={styles.errorIcon}>!</div>
          <div>{error}</div>
        </div>
      );
    }
    if (loading) {
      return (
        <div style={styles.loadingOverlay}>
          Loading model... ({progress} meshes)
        </div>
      );
    }
    if (!modelUrl) {
      return (
        <div style={styles.emptyOverlay}>
          <div style={styles.emptyIcon}>&#9651;</div>
          <div>Configure a model URL to display an IFC model</div>
        </div>
      );
    }
    return null;
  }, [error, loading, progress, modelUrl]);

  const containerStyle = useMemo(
    () => ({ position: 'relative' as const, width, height, overflow: 'hidden' as const }),
    [width, height],
  );

  return (
    <div style={containerStyle}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        style={styles.canvas}
      />
      {statusOverlay}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Styles                                                                    */
/* -------------------------------------------------------------------------- */

const styles = {
  canvas: {
    display: 'block' as const,
    width: '100%',
    height: '100%',
    cursor: 'grab',
  },
  loadingOverlay: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '4px 12px',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
    pointerEvents: 'none' as const,
  },
  errorOverlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#c00',
    fontSize: 14,
    padding: 24,
    textAlign: 'center' as const,
  },
  errorIcon: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#fee',
    color: '#c00',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold' as const,
    fontSize: 18,
  },
  emptyOverlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(245, 245, 245, 0.95)',
    color: '#666',
    fontSize: 14,
    textAlign: 'center' as const,
  },
  emptyIcon: {
    fontSize: 32,
    color: '#aaa',
  },
} as const;

export default IFCViewerChart;

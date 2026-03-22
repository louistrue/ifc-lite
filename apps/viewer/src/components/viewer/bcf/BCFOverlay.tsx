/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCFOverlay — renders BCF topic markers as 3D-positioned overlays in the viewport.
 *
 * Connects:
 *   - Zustand store (BCF topics, active topic)
 *   - Renderer (camera projection, entity bounds)
 *   - BCFOverlayRenderer (pure DOM marker rendering)
 *   - BCF panel (click marker → open topic, bidirectional sync)
 *
 * KEY DESIGN: Bounds lookup queries the renderer Scene directly via a
 * mutable ref (not React state). Marker computation is triggered by an
 * `overlayReady` counter that bumps once the renderer is available AND
 * when loading completes (ensuring bounding boxes are cached).
 * The camera's current distance is passed as `targetDistance` so fallback
 * markers land at the orbit center — not at hardcoded 10 units.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import {
  computeMarkerPositions,
  BCFOverlayRenderer,
  type BCFOverlayProjection,
  type OverlayBBox,
  type OverlayPoint3D,
  type EntityBoundsLookup,
} from '@ifc-lite/bcf';
import type { Renderer } from '@ifc-lite/renderer';

// ============================================================================
// WebGPU projection adapter
// ============================================================================

function createWebGPUProjection(
  renderer: Renderer,
  canvas: HTMLCanvasElement,
): BCFOverlayProjection {
  let prevPosX = NaN;
  let prevPosY = NaN;
  let prevPosZ = NaN;
  let prevTgtX = NaN;
  let prevTgtY = NaN;
  let prevTgtZ = NaN;
  let prevWidth = 0;
  let prevHeight = 0;

  const listeners = new Set<() => void>();
  let rafId: number | null = null;
  let listenerCount = 0;

  function poll() {
    rafId = requestAnimationFrame(poll);
    const cam = renderer.getCamera();
    const pos = cam.getPosition();
    const tgt = cam.getTarget();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (
      pos.x !== prevPosX || pos.y !== prevPosY || pos.z !== prevPosZ ||
      tgt.x !== prevTgtX || tgt.y !== prevTgtY || tgt.z !== prevTgtZ ||
      w !== prevWidth || h !== prevHeight
    ) {
      prevPosX = pos.x; prevPosY = pos.y; prevPosZ = pos.z;
      prevTgtX = tgt.x; prevTgtY = tgt.y; prevTgtZ = tgt.z;
      prevWidth = w; prevHeight = h;
      for (const cb of listeners) cb();
    }
  }

  return {
    projectToScreen(worldPos: OverlayPoint3D) {
      return renderer.getCamera().projectToScreen(
        worldPos,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    },

    getEntityBounds(expressId: number): OverlayBBox | null {
      return renderer.getScene().getEntityBoundingBox(expressId);
    },

    getCanvasSize() {
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    },

    getCameraPosition(): OverlayPoint3D {
      return renderer.getCamera().getPosition();
    },

    onCameraChange(callback: () => void) {
      listeners.add(callback);
      listenerCount++;
      if (listenerCount === 1) rafId = requestAnimationFrame(poll);
      return () => {
        listeners.delete(callback);
        listenerCount--;
        if (listenerCount === 0 && rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      };
    },
  };
}

// ============================================================================
// React Component
// ============================================================================

export function BCFOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<BCFOverlayRenderer | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Bumped when overlay/renderer is ready or geometry finishes loading,
  // triggering marker recomputation with real bounding boxes.
  const [overlayReady, setOverlayReady] = useState(0);

  // Store selectors
  const bcfProject = useViewerStore((s) => s.bcfProject);
  const activeTopicId = useViewerStore((s) => s.activeTopicId);
  const bcfPanelVisible = useViewerStore((s) => s.bcfPanelVisible);
  const setActiveTopic = useViewerStore((s) => s.setActiveTopic);
  const setBcfPanelVisible = useViewerStore((s) => s.setBcfPanelVisible);
  const models = useViewerStore((s) => s.models);
  const loading = useViewerStore((s) => s.loading);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);

  // GlobalId → expressId lookup
  const globalIdToExpressId = useCallback(
    (globalIdString: string): { expressId: number; modelId: string } | null => {
      // Multi-model path
      for (const [modelId, model] of models.entries()) {
        const localExpressId = model.ifcDataStore?.entities?.getExpressIdByGlobalId(globalIdString);
        if (localExpressId !== undefined && localExpressId > 0) {
          const offset = model.idOffset ?? 0;
          return { expressId: localExpressId + offset, modelId };
        }
      }
      // Single-model fallback
      if (models.size === 0 && ifcDataStore?.entities) {
        const localExpressId = ifcDataStore.entities.getExpressIdByGlobalId(globalIdString);
        if (localExpressId !== undefined && localExpressId > 0) {
          return { expressId: localExpressId, modelId: 'legacy' };
        }
      }
      return null;
    },
    [models, ifcDataStore],
  );

  // Bounds lookup — queries the renderer Scene directly
  const boundsLookup: EntityBoundsLookup = useCallback(
    (ifcGuid: string): OverlayBBox | null => {
      const r = rendererRef.current;
      if (!r) return null;
      const result = globalIdToExpressId(ifcGuid);
      if (!result) return null;
      return r.getScene().getEntityBoundingBox(result.expressId);
    },
    [globalIdToExpressId],
  );

  // Get current camera distance (for proper fallback marker placement)
  const getCameraDistance = useCallback((): number => {
    const r = rendererRef.current;
    if (!r) return 50; // safe default
    return r.getCamera().getDistance();
  }, []);

  // Topics list
  const topics = (() => {
    if (!bcfProject) return [];
    return Array.from(bcfProject.topics.values());
  })();

  // Compute markers — recomputes when topics, bounds, loading, or readiness changes
  const markersRef = useRef<ReturnType<typeof computeMarkerPositions>>([]);
  const prevDepsRef = useRef({ topics, boundsLookup, overlayReady, loading });

  if (
    topics !== prevDepsRef.current.topics ||
    boundsLookup !== prevDepsRef.current.boundsLookup ||
    overlayReady !== prevDepsRef.current.overlayReady ||
    loading !== prevDepsRef.current.loading
  ) {
    prevDepsRef.current = { topics, boundsLookup, overlayReady, loading };
    markersRef.current = computeMarkerPositions(topics, boundsLookup, {
      targetDistance: getCameraDistance(),
    });
  }
  const markers = markersRef.current;

  // Initialize overlay renderer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = getGlobalRenderer();
    if (!renderer) return;

    const canvas = container.closest('[data-viewport]')?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    rendererRef.current = renderer;

    const projection = createWebGPUProjection(renderer, canvas);
    const overlay = new BCFOverlayRenderer(container, projection, {
      showConnectors: true,
      showTooltips: true,
      verticalOffset: 36,
    });
    overlayRef.current = overlay;

    // Trigger marker recomputation now that renderer is available
    setOverlayReady((n) => n + 1);

    return () => {
      overlay.dispose();
      overlayRef.current = null;
      rendererRef.current = null;
    };
  }, [models]);

  // Recompute markers when loading finishes (bounding boxes get cached)
  useEffect(() => {
    if (!loading && rendererRef.current) {
      setOverlayReady((n) => n + 1);
    }
  }, [loading]);

  // Push markers to overlay renderer
  useEffect(() => {
    overlayRef.current?.setMarkers(markers);
  }, [markers, overlayReady]);

  // Sync active marker
  useEffect(() => {
    overlayRef.current?.setActiveMarker(activeTopicId);
  }, [activeTopicId, overlayReady]);

  // Visibility
  useEffect(() => {
    const hasTopics = bcfProject !== null && bcfProject.topics.size > 0;
    overlayRef.current?.setVisible(hasTopics);
  }, [bcfProject, overlayReady]);

  // Click handler
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    return overlay.onMarkerClick((topicGuid) => {
      setActiveTopic(topicGuid);
      if (!bcfPanelVisible) setBcfPanelVisible(true);
    });
  }, [overlayReady, bcfPanelVisible, setActiveTopic, setBcfPanelVisible]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-20"
      data-bcf-overlay
    />
  );
}

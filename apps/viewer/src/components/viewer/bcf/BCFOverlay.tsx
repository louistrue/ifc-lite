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
 * KEY FIX: Bounds lookup queries the renderer Scene directly (not via a
 * ref that's null during first render). Marker computation is deferred
 * until the overlay renderer is initialised and bounds are available.
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

/**
 * Create a BCFOverlayProjection adapter for the built-in WebGPU renderer.
 *
 * The polling RAF detects camera/viewport changes and fires listeners
 * **synchronously in the same frame** so the overlay re-projects with
 * zero lag during orbit, pan and zoom.
 */
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

      // Fire synchronously — overlay re-projects in this same frame
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
      if (listenerCount === 1) {
        rafId = requestAnimationFrame(poll);
      }
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

  // Renderer ref stored outside React state so the bounds lookup can read
  // it without triggering re-renders or being stale.
  const rendererRef = useRef<Renderer | null>(null);

  // Bumped when the overlay is ready so we recompute markers with real bounds.
  const [overlayReady, setOverlayReady] = useState(0);

  // Store selectors
  const bcfProject = useViewerStore((s) => s.bcfProject);
  const activeTopicId = useViewerStore((s) => s.activeTopicId);
  const bcfPanelVisible = useViewerStore((s) => s.bcfPanelVisible);
  const setActiveTopic = useViewerStore((s) => s.setActiveTopic);
  const setBcfPanelVisible = useViewerStore((s) => s.setBcfPanelVisible);
  const models = useViewerStore((s) => s.models);

  // ---- GlobalId → expressId lookup (stable across renders) ----
  const globalIdToExpressId = useCallback(
    (globalIdString: string): { expressId: number; modelId: string } | null => {
      for (const [modelId, model] of models.entries()) {
        const localExpressId = model.ifcDataStore?.entities?.getExpressIdByGlobalId(globalIdString);
        if (localExpressId !== undefined && localExpressId > 0) {
          const offset = model.idOffset ?? 0;
          return { expressId: localExpressId + offset, modelId };
        }
      }
      return null;
    },
    [models],
  );

  // ---- Bounds lookup queries the renderer Scene directly ----
  // Uses rendererRef (mutable ref) so it always has the latest renderer
  // even during the first useMemo pass after the overlay is created.
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

  // ---- Topics list ----
  const topics = (() => {
    if (!bcfProject) return [];
    return Array.from(bcfProject.topics.values());
  })();

  // ---- Compute markers (recomputes when topics, models, or overlay readiness changes) ----
  // `overlayReady` ensures we recompute once the renderer is available so
  // boundsLookup actually resolves entity bounding boxes.
  const markersRef = useRef<ReturnType<typeof computeMarkerPositions>>([]);
  const prevTopicsRef = useRef(topics);
  const prevBoundsRef = useRef(boundsLookup);
  const prevReadyRef = useRef(overlayReady);

  if (
    topics !== prevTopicsRef.current ||
    boundsLookup !== prevBoundsRef.current ||
    overlayReady !== prevReadyRef.current
  ) {
    prevTopicsRef.current = topics;
    prevBoundsRef.current = boundsLookup;
    prevReadyRef.current = overlayReady;
    markersRef.current = computeMarkerPositions(topics, boundsLookup);
  }
  const markers = markersRef.current;

  // ---- Initialize overlay renderer ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = getGlobalRenderer();
    if (!renderer) return;

    const canvas = container.closest('[data-viewport]')?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    // Store renderer in mutable ref so boundsLookup can read it immediately
    rendererRef.current = renderer;

    const projection = createWebGPUProjection(renderer, canvas);

    const overlay = new BCFOverlayRenderer(container, projection, {
      showConnectors: true,
      showTooltips: true,
      verticalOffset: 36,
    });
    overlayRef.current = overlay;

    // Signal that the overlay is ready — triggers marker recomputation
    // with real bounding boxes (not camera-direction fallbacks).
    setOverlayReady((n) => n + 1);

    return () => {
      overlay.dispose();
      overlayRef.current = null;
      rendererRef.current = null;
    };
  }, [models]);

  // ---- Push markers to overlay renderer ----
  useEffect(() => {
    overlayRef.current?.setMarkers(markers);
  }, [markers, overlayReady]);

  // ---- Sync active marker ----
  useEffect(() => {
    overlayRef.current?.setActiveMarker(activeTopicId);
  }, [activeTopicId, overlayReady]);

  // ---- Visibility ----
  useEffect(() => {
    const hasTopics = bcfProject !== null && bcfProject.topics.size > 0;
    overlayRef.current?.setVisible(hasTopics);
  }, [bcfProject, overlayReady]);

  // ---- Click handler: click marker → open BCF panel + select topic ----
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

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
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import {
  computeMarkerPositions,
  BCFOverlayRenderer,
  type BCFOverlayProjection,
  type OverlayBBox,
  type OverlayPoint3D,
} from '@ifc-lite/bcf';
import type { Renderer } from '@ifc-lite/renderer';

/**
 * Create a BCFOverlayProjection adapter for the built-in WebGPU renderer.
 */
function createWebGPUProjection(
  renderer: Renderer,
  canvas: HTMLCanvasElement,
): BCFOverlayProjection {
  // Track camera state for change detection
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

  function poll() {
    rafId = requestAnimationFrame(poll);
    const cam = renderer.getCamera();
    const pos = cam.getPosition();
    const tgt = cam.getTarget();
    const w = canvas.width;
    const h = canvas.height;

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

  // Start polling when first listener subscribes
  let listenerCount = 0;

  return {
    projectToScreen(worldPos: OverlayPoint3D): { x: number; y: number } | null {
      const cam = renderer.getCamera();
      return cam.projectToScreen(worldPos, canvas.clientWidth, canvas.clientHeight);
    },

    getEntityBounds(expressId: number): OverlayBBox | null {
      const scene = renderer.getScene();
      const bbox = scene.getEntityBoundingBox(expressId);
      if (!bbox) return null;
      return bbox;
    },

    getCanvasSize(): { width: number; height: number } {
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    },

    onCameraChange(callback: () => void): () => void {
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

/**
 * BCFOverlay component — mounts the overlay renderer over the 3D viewport.
 *
 * Place this as a sibling/child within the viewport container so it
 * overlays the canvas.
 */
export function BCFOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<BCFOverlayRenderer | null>(null);
  const projectionRef = useRef<BCFOverlayProjection | null>(null);

  // Store selectors
  const bcfProject = useViewerStore((s) => s.bcfProject);
  const activeTopicId = useViewerStore((s) => s.activeTopicId);
  const bcfPanelVisible = useViewerStore((s) => s.bcfPanelVisible);
  const setActiveTopic = useViewerStore((s) => s.setActiveTopic);
  const setBcfPanelVisible = useViewerStore((s) => s.setBcfPanelVisible);
  const models = useViewerStore((s) => s.models);

  // Build a globalId → expressId lookup from all loaded models
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

  // Bounds lookup that resolves IFC GlobalId → bounding box via the renderer
  const boundsLookup = useCallback(
    (ifcGuid: string): OverlayBBox | null => {
      const result = globalIdToExpressId(ifcGuid);
      if (!result) return null;

      const projection = projectionRef.current;
      if (!projection) return null;

      return projection.getEntityBounds(result.expressId);
    },
    [globalIdToExpressId],
  );

  // Compute markers from topics
  const topics = useMemo(() => {
    if (!bcfProject) return [];
    return Array.from(bcfProject.topics.values());
  }, [bcfProject]);

  const markers = useMemo(
    () => computeMarkerPositions(topics, boundsLookup),
    [topics, boundsLookup],
  );

  // Initialize overlay renderer when container mounts
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = getGlobalRenderer();
    if (!renderer) return;

    // Find the canvas in the viewport
    const canvas = container.closest('[data-viewport]')?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const projection = createWebGPUProjection(renderer, canvas);
    projectionRef.current = projection;

    const overlay = new BCFOverlayRenderer(container, projection, {
      showConnectors: true,
      showTooltips: true,
      verticalOffset: 40,
    });
    overlayRef.current = overlay;

    return () => {
      overlay.dispose();
      overlayRef.current = null;
      projectionRef.current = null;
    };
  }, [models]); // Re-create when models change (renderer might be new)

  // Update markers when topics change
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setMarkers(markers);
  }, [markers]);

  // Sync active marker with store
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setActiveMarker(activeTopicId);
  }, [activeTopicId]);

  // Show/hide overlay based on whether BCF project exists
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const hasTopics = bcfProject !== null && bcfProject.topics.size > 0;
    overlay.setVisible(hasTopics);
  }, [bcfProject]);

  // Register click handler: click marker → open BCF panel + select topic
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const unsub = overlay.onMarkerClick((topicGuid) => {
      setActiveTopic(topicGuid);
      if (!bcfPanelVisible) {
        setBcfPanelVisible(true);
      }
    });

    return unsub;
  }, [bcfPanelVisible, setActiveTopic, setBcfPanelVisible]);

  // Invisible mount point — the BCFOverlayRenderer creates its own DOM
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-20"
      data-bcf-overlay
    />
  );
}

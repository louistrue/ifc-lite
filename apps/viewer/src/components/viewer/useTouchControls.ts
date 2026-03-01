/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Touch controls hook for the 3D viewport
 * Handles multi-touch gesture handling (orbit, pinch-zoom, pan, tap-to-select)
 */

import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { Renderer, PickResult } from '@ifc-lite/renderer';
import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlane } from '@/store';
import { getEntityCenter } from '../../utils/viewportUtils.js';

export interface TouchState {
  touches: Touch[];
  lastDistance: number;
  lastCenter: { x: number; y: number };
  tapStartTime: number;
  tapStartPos: { x: number; y: number };
  didMove: boolean;
  multiTouch: boolean;
}

export interface UseTouchControlsParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;
  touchStateRef: MutableRefObject<TouchState>;
  activeToolRef: MutableRefObject<string>;
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  clearColorRef: MutableRefObject<[number, number, number, number]>;
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  geometryRef: MutableRefObject<MeshData[] | null>;
  handlePickForSelection: (pickResult: PickResult | null) => void;
  getPickOptions: () => { isStreaming: boolean; hiddenIds: Set<number>; isolatedIds: Set<number> | null };
}

export function useTouchControls(params: UseTouchControlsParams): void {
  const {
    canvasRef,
    rendererRef,
    isInitialized,
    touchStateRef,
    activeToolRef,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    clearColorRef,
    sectionPlaneRef,
    sectionRangeRef,
    geometryRef,
    handlePickForSelection,
    getPickOptions,
  } = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !isInitialized) return;

    const camera = renderer.getCamera();
    const touchState = touchStateRef.current;

    const handleTouchStart = async (e: TouchEvent) => {
      e.preventDefault();
      touchState.touches = Array.from(e.touches);

      // Track multi-touch to prevent false tap-select after pinch/zoom
      if (touchState.touches.length > 1) {
        touchState.multiTouch = true;
      }

      if (touchState.touches.length === 1 && !touchState.multiTouch) {
        touchState.lastCenter = {
          x: touchState.touches[0].clientX,
          y: touchState.touches[0].clientY,
        };
        // Record tap start for tap-to-select detection
        touchState.tapStartTime = Date.now();
        touchState.tapStartPos = {
          x: touchState.touches[0].clientX,
          y: touchState.touches[0].clientY,
        };
        touchState.didMove = false;

        // Set orbit pivot to what user touches (same as mouse click behavior)
        const rect = canvas.getBoundingClientRect();
        const x = touchState.touches[0].clientX - rect.left;
        const y = touchState.touches[0].clientY - rect.top;

        // Uses visibility filtering so hidden elements don't affect orbit pivot
        const pickResult = await renderer.pick(x, y, getPickOptions());
        if (pickResult !== null) {
          const center = getEntityCenter(geometryRef.current, pickResult.expressId);
          if (center) {
            camera.setOrbitPivot(center);
          } else {
            camera.setOrbitPivot(null);
          }
        } else {
          camera.setOrbitPivot(null);
        }
      } else if (touchState.touches.length === 1) {
        // Single touch after multi-touch - just update center for orbit
        touchState.lastCenter = {
          x: touchState.touches[0].clientX,
          y: touchState.touches[0].clientY,
        };
      } else if (touchState.touches.length === 2) {
        const dx = touchState.touches[1].clientX - touchState.touches[0].clientX;
        const dy = touchState.touches[1].clientY - touchState.touches[0].clientY;
        touchState.lastDistance = Math.sqrt(dx * dx + dy * dy);
        touchState.lastCenter = {
          x: (touchState.touches[0].clientX + touchState.touches[1].clientX) / 2,
          y: (touchState.touches[0].clientY + touchState.touches[1].clientY) / 2,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      touchState.touches = Array.from(e.touches);

      if (touchState.touches.length === 1) {
        const dx = touchState.touches[0].clientX - touchState.lastCenter.x;
        const dy = touchState.touches[0].clientY - touchState.lastCenter.y;

        // Mark as moved if significant movement (prevents tap-select during drag)
        const totalDx = touchState.touches[0].clientX - touchState.tapStartPos.x;
        const totalDy = touchState.touches[0].clientY - touchState.tapStartPos.y;
        if (Math.abs(totalDx) > 10 || Math.abs(totalDy) > 10) {
          touchState.didMove = true;
        }

        camera.orbit(dx, dy, false);
        touchState.lastCenter = {
          x: touchState.touches[0].clientX,
          y: touchState.touches[0].clientY,
        };
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          isInteracting: true,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
      } else if (touchState.touches.length === 2) {
        const dx1 = touchState.touches[1].clientX - touchState.touches[0].clientX;
        const dy1 = touchState.touches[1].clientY - touchState.touches[0].clientY;
        const distance = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        const centerX = (touchState.touches[0].clientX + touchState.touches[1].clientX) / 2;
        const centerY = (touchState.touches[0].clientY + touchState.touches[1].clientY) / 2;
        const panDx = centerX - touchState.lastCenter.x;
        const panDy = centerY - touchState.lastCenter.y;
        camera.pan(panDx, panDy, false);

        const zoomDelta = distance - touchState.lastDistance;
        const rect = canvas.getBoundingClientRect();
        camera.zoom(zoomDelta * 10, false, centerX - rect.left, centerY - rect.top, canvas.width, canvas.height);

        touchState.lastDistance = distance;
        touchState.lastCenter = { x: centerX, y: centerY };
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          isInteracting: true,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
      }
    };

    const handleTouchEnd = async (e: TouchEvent) => {
      e.preventDefault();
      const previousTouchCount = touchState.touches.length;
      const wasMultiTouch = touchState.multiTouch;
      touchState.touches = Array.from(e.touches);

      if (touchState.touches.length === 0) {
        camera.stopInertia();
        camera.setOrbitPivot(null);

        // Tap-to-select: detect quick tap without significant movement
        const tapDuration = Date.now() - touchState.tapStartTime;
        const tool = activeToolRef.current;

        // Only select if:
        // - Was a single-finger touch (not after multi-touch gesture)
        // - Tap was quick (< 300ms)
        // - Didn't move significantly
        // - Tool supports selection (not orbit/pan/walk/measure)
        if (
          previousTouchCount === 1 &&
          !wasMultiTouch &&
          tapDuration < 300 &&
          !touchState.didMove &&
          tool !== 'orbit' &&
          tool !== 'pan' &&
          tool !== 'walk' &&
          tool !== 'measure'
        ) {
          const rect = canvas.getBoundingClientRect();
          const x = touchState.tapStartPos.x - rect.left;
          const y = touchState.tapStartPos.y - rect.top;

          const pickResult = await renderer.pick(x, y, getPickOptions());
          handlePickForSelection(pickResult);
        }

        // Reset multi-touch flag when all touches end
        touchState.multiTouch = false;
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isInitialized]);
}

export default useTouchControls;

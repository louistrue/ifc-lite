/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keyboard controls hook for the 3D viewport
 * Handles keyboard shortcuts, first-person mode, continuous movement
 */

import { useEffect, type MutableRefObject } from 'react';
import type { Renderer } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import type { SectionPlane } from '@/store';
import { goHomeFromStore } from '@/store/homeView';
import { getEntityBounds } from '../../utils/viewportUtils.js';

export interface UseKeyboardControlsParams {
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;
  keyboardHandlersRef: MutableRefObject<{
    handleKeyDown: ((e: KeyboardEvent) => void) | null;
    handleKeyUp: ((e: KeyboardEvent) => void) | null;
  }>;
  firstPersonModeRef: MutableRefObject<boolean>;
  geometryBoundsRef: MutableRefObject<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>;
  coordinateInfoRef: MutableRefObject<CoordinateInfo | undefined>;
  geometryRef: MutableRefObject<MeshData[] | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  clearColorRef: MutableRefObject<[number, number, number, number]>;
  activeToolRef: MutableRefObject<string>;
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  updateCameraRotationRealtime: (rotation: { azimuth: number; elevation: number }) => void;
  calculateScale: () => void;
}

export function useKeyboardControls(params: UseKeyboardControlsParams): void {
  const {
    rendererRef,
    isInitialized,
    keyboardHandlersRef,
    firstPersonModeRef,
    geometryBoundsRef,
    coordinateInfoRef,
    geometryRef,
    selectedEntityIdRef,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedModelIndexRef,
    clearColorRef,
    activeToolRef,
    sectionPlaneRef,
    sectionRangeRef,
    updateCameraRotationRealtime,
    calculateScale,
  } = params;

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    const camera = renderer.getCamera();
    let aborted = false;

    const keyState: { [key: string]: boolean } = {};
    let moveLoopRunning = false;
    let moveFrameId: number | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      keyState[e.key.toLowerCase()] = true;

      // Start movement loop when a movement key is pressed
      const isMovementKey = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase());
      if (isMovementKey && !moveLoopRunning) {
        moveLoopRunning = true;
        keyboardMove();
      }

      // Preset views - set view and re-render
      const setViewAndRender = (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right') => {
        const rotation = coordinateInfoRef.current?.buildingRotation;
        camera.setPresetView(view, geometryBoundsRef.current, rotation);
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
        updateCameraRotationRealtime(camera.getRotation());
        calculateScale();
      };

      if (e.key === '1') setViewAndRender('top');
      if (e.key === '2') setViewAndRender('bottom');
      if (e.key === '3') setViewAndRender('front');
      if (e.key === '4') setViewAndRender('back');
      if (e.key === '5') setViewAndRender('left');
      if (e.key === '6') setViewAndRender('right');

      // Frame selection (F) - zoom to fit selection, or fit all if nothing selected
      if (e.key === 'f' || e.key === 'F') {
        const selectedId = selectedEntityIdRef.current;
        if (selectedId !== null) {
          // Frame selection - zoom to fit selected element
          const bounds = getEntityBounds(geometryRef.current, selectedId);
          if (bounds) {
            camera.frameBounds(bounds.min, bounds.max, 300);
          }
        } else {
          // No selection - fit all
          camera.zoomExtent(geometryBoundsRef.current.min, geometryBoundsRef.current.max, 300);
        }
        calculateScale();
      }

      // Home view (H) - reset to isometric
      if (e.key === 'h' || e.key === 'H') {
        goHomeFromStore();
      }

      // Fit all / Zoom extents (Z)
      if (e.key === 'z' || e.key === 'Z') {
        camera.zoomExtent(geometryBoundsRef.current.min, geometryBoundsRef.current.max, 300);
        calculateScale();
      }

      // Toggle first-person mode
      if (e.key === 'c' || e.key === 'C') {
        firstPersonModeRef.current = !firstPersonModeRef.current;
        camera.enableFirstPersonMode(firstPersonModeRef.current);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keyState[e.key.toLowerCase()] = false;

      // Stop movement loop when no movement keys are held
      const anyMovementKey = keyState['arrowup'] || keyState['arrowdown'] || keyState['arrowleft'] || keyState['arrowright'];
      if (!anyMovementKey && moveLoopRunning) {
        moveLoopRunning = false;
        if (moveFrameId !== null) {
          cancelAnimationFrame(moveFrameId);
          moveFrameId = null;
        }
      }
    };

    keyboardHandlersRef.current.handleKeyDown = handleKeyDown;
    keyboardHandlersRef.current.handleKeyUp = handleKeyUp;

    const keyboardMove = () => {
      if (aborted || !moveLoopRunning) return;

      let moved = false;
      const panSpeed = 5;

      if (firstPersonModeRef.current) {
        // Arrow keys for first-person navigation (camera-relative)
        if (keyState['arrowup']) { camera.moveFirstPerson(-1, 0, 0); moved = true; }
        if (keyState['arrowdown']) { camera.moveFirstPerson(1, 0, 0); moved = true; }
        if (keyState['arrowleft']) { camera.moveFirstPerson(0, 1, 0); moved = true; }
        if (keyState['arrowright']) { camera.moveFirstPerson(0, -1, 0); moved = true; }
      } else {
        // Arrow keys for panning (camera-relative: arrow direction = camera movement)
        if (keyState['arrowup']) { camera.pan(0, -panSpeed, false); moved = true; }
        if (keyState['arrowdown']) { camera.pan(0, panSpeed, false); moved = true; }
        if (keyState['arrowleft']) { camera.pan(panSpeed, 0, false); moved = true; }
        if (keyState['arrowright']) { camera.pan(-panSpeed, 0, false); moved = true; }
      }

      if (moved) {
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
      }
      moveFrameId = requestAnimationFrame(keyboardMove);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      aborted = true;
      moveLoopRunning = false;
      if (moveFrameId !== null) {
        cancelAnimationFrame(moveFrameId);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInitialized]);
}

export default useKeyboardControls;

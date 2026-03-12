/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Animation loop hook for the 3D viewport
 *
 * Handles requestAnimationFrame loop, camera update, ViewCube sync,
 * and continuous rendering during gizmo drag interaction.
 */

import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { Renderer, VisualEnhancementOptions } from '@ifc-lite/renderer';
import type { SectionPlane } from '@/store';

export interface UseAnimationLoopParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;
  animationFrameRef: MutableRefObject<number | null>;
  lastFrameTimeRef: MutableRefObject<number>;
  mouseIsDraggingRef: MutableRefObject<boolean>;
  activeToolRef: MutableRefObject<string>;
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  clearColorRef: MutableRefObject<[number, number, number, number]>;
  visualEnhancementRef: MutableRefObject<VisualEnhancementOptions>;
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  lastCameraStateRef: MutableRefObject<{
    position: { x: number; y: number; z: number };
    rotation: { azimuth: number; elevation: number };
    distance: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null>;
  updateCameraRotationRealtime: (rotation: { azimuth: number; elevation: number }) => void;
  calculateScale: () => void;
  updateMeasurementScreenCoords: (projector: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null) => void;
  hasPendingMeasurements: () => boolean;
}

/** Build section render option from refs */
function buildSectionOption(
  activeToolRef: MutableRefObject<string>,
  sectionPlaneRef: MutableRefObject<SectionPlane>,
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>,
) {
  if (activeToolRef.current !== 'section') return undefined;
  return {
    ...sectionPlaneRef.current,
    min: sectionRangeRef.current?.min,
    max: sectionRangeRef.current?.max,
  };
}

export function useAnimationLoop(params: UseAnimationLoopParams): void {
  const {
    canvasRef,
    rendererRef,
    isInitialized,
    animationFrameRef,
    lastFrameTimeRef,
    mouseIsDraggingRef,
    activeToolRef,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    clearColorRef,
    visualEnhancementRef,
    sectionPlaneRef,
    sectionRangeRef,
    lastCameraStateRef,
    updateCameraRotationRealtime,
    calculateScale,
    updateMeasurementScreenCoords,
    hasPendingMeasurements,
  } = params;

  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas || !isInitialized) return;

    const camera = renderer.getCamera();
    let aborted = false;

    let lastRotationUpdate = 0;
    let lastScaleUpdate = 0;

    const animate = (currentTime: number) => {
      if (aborted) return;

      const deltaTime = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;

      const isAnimating = camera.update(deltaTime);

      // Determine if we need to render this frame:
      // 1. Camera is animating (preset transitions, inertia, etc.)
      // 2. Gizmo is being dragged (section plane position changing continuously)
      const isGizmoDragging = sectionPlaneRef.current.gizmo.dragging;
      const needsRender = isAnimating || isGizmoDragging;

      if (needsRender) {
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          visualEnhancement: visualEnhancementRef.current,
          sectionPlane: buildSectionOption(activeToolRef, sectionPlaneRef, sectionRangeRef),
        });

        if (isAnimating) {
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
        }
      } else if (!mouseIsDraggingRef.current && currentTime - lastRotationUpdate > 500) {
        updateCameraRotationRealtime(camera.getRotation());
        lastRotationUpdate = currentTime;
      }

      // Scale bar (throttled)
      if (currentTime - lastScaleUpdate > 500) {
        calculateScale();
        lastScaleUpdate = currentTime;
      }

      // Measurement screen coord updates
      if (activeToolRef.current === 'measure' && hasPendingMeasurements()) {
        const cameraPos = camera.getPosition();
        const cameraRot = camera.getRotation();
        const cameraDist = camera.getDistance();
        const currentCameraState = {
          position: cameraPos,
          rotation: cameraRot,
          distance: cameraDist,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };

        const lastState = lastCameraStateRef.current;
        const cameraChanged =
          !lastState ||
          lastState.position.x !== currentCameraState.position.x ||
          lastState.position.y !== currentCameraState.position.y ||
          lastState.position.z !== currentCameraState.position.z ||
          lastState.rotation.azimuth !== currentCameraState.rotation.azimuth ||
          lastState.rotation.elevation !== currentCameraState.rotation.elevation ||
          lastState.distance !== currentCameraState.distance ||
          lastState.canvasWidth !== currentCameraState.canvasWidth ||
          lastState.canvasHeight !== currentCameraState.canvasHeight;

        if (cameraChanged) {
          lastCameraStateRef.current = currentCameraState;
          updateMeasurementScreenCoords((worldPos) => {
            return camera.projectToScreen(worldPos, canvas.width, canvas.height);
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    lastFrameTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      aborted = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isInitialized]);
}

export default useAnimationLoop;

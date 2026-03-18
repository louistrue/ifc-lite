/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * THE render loop for the 3D viewport.
 *
 * This is the single place where renderer.render() is called during normal
 * operation.  Everything else (mouse, touch, keyboard, streaming, visibility
 * changes, theme, lens) calls renderer.requestRender() to set a dirty flag.
 *
 * Each frame:
 *   1. Drain the scene's mesh queue (streaming uploads with time budget).
 *   2. Update camera (animation / inertia).
 *   3. If dirty OR animating → render with current state from refs.
 *   4. Sync ViewCube, scale bar, measurements.
 */

import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { Renderer, VisualEnhancementOptions } from '@ifc-lite/renderer';
import type { CoordinateInfo } from '@ifc-lite/geometry';
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
  selectedEntityIdsRef: MutableRefObject<Set<number> | undefined>;
  coordinateInfoRef: MutableRefObject<CoordinateInfo | undefined>;
  isInteractingRef: MutableRefObject<boolean>;
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
    selectedEntityIdsRef,
    coordinateInfoRef,
    isInteractingRef,
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
    const scene = renderer.getScene();
    let aborted = false;

    let lastRotationUpdate = 0;
    let lastScaleUpdate = 0;

    const animate = (currentTime: number) => {
      if (aborted) return;

      const deltaTime = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;

      // 1. Drain mesh queue (streaming GPU uploads)
      let queueFlushed = false;
      if (scene.hasQueuedMeshes()) {
        const device = renderer.getGPUDevice();
        const pipeline = renderer.getPipeline();
        if (device && pipeline) {
          queueFlushed = scene.flushPending(device, pipeline);
          if (queueFlushed) renderer.clearCaches();
        }
      }

      // 2. Camera update (animation / inertia)
      const isAnimating = camera.update(deltaTime);

      // 3. Render if anything changed
      const renderRequested = renderer.consumeRenderRequest();
      if (isAnimating || renderRequested || queueFlushed) {
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          selectedIds: selectedEntityIdsRef.current,
          selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          visualEnhancement: visualEnhancementRef.current,
          isInteracting: isInteractingRef.current,
          buildingRotation: coordinateInfoRef.current?.buildingRotation,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
      }

      // 4. Sync UI widgets
      if (isAnimating || renderRequested || queueFlushed) {
        updateCameraRotationRealtime(camera.getRotation());
        calculateScale();
      } else if (!mouseIsDraggingRef.current && currentTime - lastRotationUpdate > 500) {
        updateCameraRotationRealtime(camera.getRotation());
        lastRotationUpdate = currentTime;
      }

      if (currentTime - lastScaleUpdate > 500) {
        calculateScale();
        lastScaleUpdate = currentTime;
      }

      // 5. Measurement screen coords
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

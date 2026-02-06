/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef, useCallback, useEffect } from 'react';
import type { Renderer } from '@ifc-lite/renderer';

interface PointerState {
  isDown: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  button: number;
}

/**
 * Hook to handle camera controls (orbit, pan, zoom) for the IFC viewer.
 * 
 * - Left drag: Orbit
 * - Right drag / Middle drag / Shift+Left drag: Pan
 * - Wheel: Zoom
 */
export function useCameraControls(
  rendererRef: React.RefObject<Renderer | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  isReady: boolean,
  backgroundColor?: [number, number, number, number],
) {
  const pointerState = useRef<PointerState>({
    isDown: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    button: 0,
  });

  const rafId = useRef<number | null>(null);
  const needsRender = useRef(false);

  // Animation loop for smooth rendering during interaction
  const scheduleRender = useCallback(() => {
    if (needsRender.current) return;
    needsRender.current = true;

    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
    }

    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      needsRender.current = false;

      const renderer = rendererRef.current;
      if (renderer?.isReady()) {
        renderer.render({ clearColor: backgroundColor });
      }
    });
  }, [rendererRef, backgroundColor]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isReady) return;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.setPointerCapture(e.pointerId);
      }

      pointerState.current = {
        isDown: true,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        button: e.button,
      };
    },
    [isReady, canvasRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isReady || !pointerState.current.isDown) return;

      const renderer = rendererRef.current;
      if (!renderer?.isReady()) return;

      const camera = renderer.getCamera();
      if (!camera) return;

      const dx = e.clientX - pointerState.current.lastX;
      const dy = e.clientY - pointerState.current.lastY;

      pointerState.current.lastX = e.clientX;
      pointerState.current.lastY = e.clientY;

      // Determine action based on button/modifier
      const isPan =
        pointerState.current.button === 1 || // Middle button
        pointerState.current.button === 2 || // Right button
        e.shiftKey; // Shift+Left

      if (isPan) {
        camera.pan(dx, -dy, false);
      } else {
        camera.orbit(dx, dy, false);
      }

      scheduleRender();
    },
    [isReady, rendererRef, scheduleRender],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas && pointerState.current.isDown) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if capture was already released
        }
      }

      pointerState.current.isDown = false;
    },
    [canvasRef],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!isReady) return;
      e.preventDefault();

      const renderer = rendererRef.current;
      if (!renderer?.isReady()) return;

      const camera = renderer.getCamera();
      if (!camera) return;

      // Get mouse position relative to canvas
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      camera.zoom(e.deltaY, false, mouseX, mouseY, rect.width, rect.height);
      scheduleRender();
    },
    [isReady, rendererRef, scheduleRender],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
  };
}

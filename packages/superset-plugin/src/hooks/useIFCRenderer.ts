import { useRef, useEffect, useState, useCallback } from 'react';
import { Renderer } from '@ifc-lite/renderer';

/**
 * Manages the WebGPU Renderer lifecycle within a Superset chart component.
 *
 * Handles:
 * - Initialization of the Renderer when a canvas ref becomes available
 * - GPU device cleanup on unmount (critical to avoid context exhaustion)
 * - Resize when Superset's layout changes
 * - Error state for WebGPU unavailability
 */
export function useIFCRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const rendererRef = useRef<Renderer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize renderer when canvas is available
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Feature-detect WebGPU before attempting init
    if (!navigator.gpu) {
      setError(
        'WebGPU is not available in this browser. ' +
        'Please use Chrome 113+, Edge 113+, or Safari 18+.',
      );
      return;
    }

    let destroyed = false;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    renderer
      .init()
      .then(() => {
        if (!destroyed) {
          setIsReady(true);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!destroyed) {
          setError(`WebGPU initialization failed: ${err.message}`);
          setIsReady(false);
        }
      });

    // Critical cleanup: destroy GPU device on unmount.
    // Follows the deck.gl pattern (WEBGL_lose_context) adapted for WebGPU.
    // Without this, browsers exhaust their GPU context limit (~8-16 contexts).
    return () => {
      console.log('[IFC Renderer] Component unmounting, destroying WebGPU device');
      destroyed = true;
      setIsReady(false);
      const device = renderer.getGPUDevice();
      if (device) {
        device.destroy();
      }
      rendererRef.current = null;
    };
  }, [canvasRef]);

  // Resize handler
  const resize = useCallback((width: number, height: number) => {
    const renderer = rendererRef.current;
    if (renderer?.isReady() && width > 0 && height > 0) {
      renderer.resize(width, height);
    }
  }, []);

  return {
    rendererRef,
    isReady,
    error,
    resize,
  };
}

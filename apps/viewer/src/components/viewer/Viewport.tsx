/**
 * 3D viewport component
 */

import { useEffect, useRef, useState } from 'react';
import { Renderer, MathUtils } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';

interface ViewportProps {
  geometry: MeshData[] | null;
  coordinateInfo?: CoordinateInfo;
}

export function Viewport({ geometry, coordinateInfo }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);
  const hiddenEntities = useViewerStore((state) => state.hiddenEntities);
  const isolatedEntities = useViewerStore((state) => state.isolatedEntities);
  const activeTool = useViewerStore((state) => state.activeTool);

  // Animation frame ref
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Mouse state
  const mouseStateRef = useRef({
    isDragging: false,
    isPanning: false,
    lastX: 0,
    lastY: 0,
    button: 0,
  });

  // Touch state
  const touchStateRef = useRef({
    touches: [] as Touch[],
    lastDistance: 0,
    lastCenter: { x: 0, y: 0 },
  });

  // Double-click detection
  const lastClickTimeRef = useRef<number>(0);
  const lastClickPosRef = useRef<{ x: number; y: number } | null>(null);

  // Keyboard handlers refs
  const keyboardHandlersRef = useRef<{
    handleKeyDown: ((e: KeyboardEvent) => void) | null;
    handleKeyUp: ((e: KeyboardEvent) => void) | null;
  }>({ handleKeyDown: null, handleKeyUp: null });

  // First-person mode state
  const firstPersonModeRef = useRef<boolean>(false);

  // Visibility state refs for animation loop
  const hiddenEntitiesRef = useRef<Set<number>>(hiddenEntities);
  const isolatedEntitiesRef = useRef<Set<number> | null>(isolatedEntities);
  const selectedEntityIdRef = useRef<number | null>(selectedEntityId);
  const activeToolRef = useRef<string>(activeTool);

  // Keep refs in sync
  useEffect(() => { hiddenEntitiesRef.current = hiddenEntities; }, [hiddenEntities]);
  useEffect(() => { isolatedEntitiesRef.current = isolatedEntities; }, [isolatedEntities]);
  useEffect(() => { selectedEntityIdRef.current = selectedEntityId; }, [selectedEntityId]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsInitialized(false);

    let aborted = false;
    let resizeObserver: ResizeObserver | null = null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;

    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    renderer.init().then(() => {
      if (aborted) return;

      setIsInitialized(true);

      const camera = renderer.getCamera();
      const mouseState = mouseStateRef.current;
      const touchState = touchStateRef.current;

      // Animation loop
      const animate = (currentTime: number) => {
        if (aborted) return;

        const deltaTime = currentTime - lastFrameTimeRef.current;
        lastFrameTimeRef.current = currentTime;

        const isAnimating = camera.update(deltaTime);
        if (isAnimating) {
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
          });
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(animate);

      // Mouse controls - respect active tool
      canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mouseState.isDragging = true;
        mouseState.button = e.button;
        mouseState.lastX = e.clientX;
        mouseState.lastY = e.clientY;

        // Determine action based on active tool and mouse button
        const tool = activeToolRef.current;
        if (tool === 'pan' || e.button === 1 || e.button === 2) {
          mouseState.isPanning = true;
          canvas.style.cursor = 'move';
        } else if (tool === 'orbit') {
          mouseState.isPanning = false;
          canvas.style.cursor = 'grabbing';
        } else if (tool === 'select') {
          // Select tool: shift+drag = pan, normal drag = orbit
          mouseState.isPanning = e.shiftKey;
          canvas.style.cursor = e.shiftKey ? 'move' : 'grabbing';
        } else {
          // Default behavior
          mouseState.isPanning = e.shiftKey;
          canvas.style.cursor = e.shiftKey ? 'move' : 'grabbing';
        }
      });

      canvas.addEventListener('mousemove', (e) => {
        if (mouseState.isDragging) {
          const dx = e.clientX - mouseState.lastX;
          const dy = e.clientY - mouseState.lastY;
          const tool = activeToolRef.current;

          if (mouseState.isPanning || tool === 'pan') {
            camera.pan(dx, dy, false);
          } else if (tool === 'walk') {
            // Walk mode: left/right rotates, up/down moves forward/backward
            camera.orbit(dx * 0.5, 0, false); // Only horizontal rotation
            if (Math.abs(dy) > 2) {
              camera.zoom(dy * 2, false); // Forward/backward movement
            }
          } else {
            camera.orbit(dx, dy, false);
          }

          mouseState.lastX = e.clientX;
          mouseState.lastY = e.clientY;
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
          });
        }
      });

      canvas.addEventListener('mouseup', () => {
        mouseState.isDragging = false;
        mouseState.isPanning = false;
        const tool = activeToolRef.current;
        canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'orbit' ? 'grab' : 'default');
      });

      canvas.addEventListener('mouseleave', () => {
        mouseState.isDragging = false;
        mouseState.isPanning = false;
        camera.stopInertia();
        canvas.style.cursor = 'default';
      });

      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        camera.zoom(e.deltaY, false, mouseX, mouseY, canvas.width, canvas.height);
        renderer.render();
      });

      // Click handling
      canvas.addEventListener('click', async (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const now = Date.now();
        const timeSinceLastClick = now - lastClickTimeRef.current;
        const clickPos = { x, y };

        if (lastClickPosRef.current &&
            timeSinceLastClick < 300 &&
            Math.abs(clickPos.x - lastClickPosRef.current.x) < 5 &&
            Math.abs(clickPos.y - lastClickPosRef.current.y) < 5) {
          // Double-click
          const pickedId = await renderer.pick(x, y);
          if (pickedId) {
            setSelectedEntityId(pickedId);
          }
          lastClickTimeRef.current = 0;
          lastClickPosRef.current = null;
        } else {
          // Single click
          const pickedId = await renderer.pick(x, y);
          setSelectedEntityId(pickedId);
          lastClickTimeRef.current = now;
          lastClickPosRef.current = clickPos;
        }
      });

      // Touch controls
      canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);

        if (touchState.touches.length === 1) {
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
      });

      canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);

        if (touchState.touches.length === 1) {
          const dx = touchState.touches[0].clientX - touchState.lastCenter.x;
          const dy = touchState.touches[0].clientY - touchState.lastCenter.y;
          camera.orbit(dx, dy, false);
          touchState.lastCenter = {
            x: touchState.touches[0].clientX,
            y: touchState.touches[0].clientY,
          };
          renderer.render();
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
          renderer.render();
        }
      });

      canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);
        if (touchState.touches.length === 0) {
          camera.stopInertia();
        }
      });

      // Keyboard controls
      const keyState: { [key: string]: boolean } = {};

      const handleKeyDown = (e: KeyboardEvent) => {
        if (document.activeElement?.tagName === 'INPUT' ||
            document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }

        keyState[e.key.toLowerCase()] = true;

        // Preset views
        if (e.key === '1') camera.setPresetView('top');
        if (e.key === '2') camera.setPresetView('bottom');
        if (e.key === '3') camera.setPresetView('front');
        if (e.key === '4') camera.setPresetView('back');
        if (e.key === '5') camera.setPresetView('left');
        if (e.key === '6') camera.setPresetView('right');

        // Frame selection
        if ((e.key === 'f' || e.key === 'F') && selectedEntityId) {
          const bounds = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
          camera.zoomToFit(bounds.min, bounds.max, 500);
        }

        // Home view
        if (e.key === 'h' || e.key === 'H') {
          const bounds = { min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } };
          camera.zoomToFit(bounds.min, bounds.max, 500);
        }

        // Toggle first-person mode
        if (e.key === 'c' || e.key === 'C') {
          firstPersonModeRef.current = !firstPersonModeRef.current;
          camera.enableFirstPersonMode(firstPersonModeRef.current);
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        keyState[e.key.toLowerCase()] = false;
      };

      keyboardHandlersRef.current.handleKeyDown = handleKeyDown;
      keyboardHandlersRef.current.handleKeyUp = handleKeyUp;

      const keyboardMove = () => {
        if (aborted) return;

        let moved = false;
        const panSpeed = 5;
        const zoomSpeed = 0.1;

        if (firstPersonModeRef.current) {
          if (keyState['w'] || keyState['arrowup']) { camera.moveFirstPerson(1, 0, 0); moved = true; }
          if (keyState['s'] || keyState['arrowdown']) { camera.moveFirstPerson(-1, 0, 0); moved = true; }
          if (keyState['a'] || keyState['arrowleft']) { camera.moveFirstPerson(0, -1, 0); moved = true; }
          if (keyState['d'] || keyState['arrowright']) { camera.moveFirstPerson(0, 1, 0); moved = true; }
          if (keyState['q']) { camera.moveFirstPerson(0, 0, -1); moved = true; }
          if (keyState['e']) { camera.moveFirstPerson(0, 0, 1); moved = true; }
        } else {
          if (keyState['w'] || keyState['arrowup']) { camera.pan(0, panSpeed, false); moved = true; }
          if (keyState['s'] || keyState['arrowdown']) { camera.pan(0, -panSpeed, false); moved = true; }
          if (keyState['a'] || keyState['arrowleft']) { camera.pan(-panSpeed, 0, false); moved = true; }
          if (keyState['d'] || keyState['arrowright']) { camera.pan(panSpeed, 0, false); moved = true; }
          if (keyState['q']) { camera.zoom(-zoomSpeed * 100, false); moved = true; }
          if (keyState['e']) { camera.zoom(zoomSpeed * 100, false); moved = true; }
        }

        if (moved) renderer.render();
        requestAnimationFrame(keyboardMove);
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      keyboardMove();

      resizeObserver = new ResizeObserver(() => {
        if (aborted) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.resize(width, height);
        renderer.render();
      });
      resizeObserver.observe(canvas);

      renderer.render();
    });

    return () => {
      aborted = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (keyboardHandlersRef.current.handleKeyDown) {
        window.removeEventListener('keydown', keyboardHandlersRef.current.handleKeyDown);
      }
      if (keyboardHandlersRef.current.handleKeyUp) {
        window.removeEventListener('keyup', keyboardHandlersRef.current.handleKeyUp);
      }
      setIsInitialized(false);
      rendererRef.current = null;
    };
  // Note: selectedEntityId is intentionally NOT in dependencies
  // The click handler captures setSelectedEntityId via closure
  // Adding selectedEntityId would destroy/recreate the renderer on every selection change
  }, [setSelectedEntityId]);

  // Track processed meshes for incremental updates
  const processedMeshIdsRef = useRef<Set<number>>(new Set());
  const lastGeometryLengthRef = useRef<number>(0);
  const lastGeometryRef = useRef<MeshData[] | null>(null);
  const cameraFittedRef = useRef<boolean>(false);

  useEffect(() => {
    const renderer = rendererRef.current;

    if (!renderer || !geometry || !isInitialized) return;

    const device = renderer.getGPUDevice();
    if (!device) return;

    const scene = renderer.getScene();
    const currentLength = geometry.length;
    const geometryChanged = lastGeometryRef.current !== geometry;

    if (geometryChanged && lastGeometryRef.current !== null) {
      scene.clear();
      processedMeshIdsRef.current.clear();
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = geometry;
    } else if (currentLength > lastGeometryLengthRef.current) {
      lastGeometryRef.current = geometry;
    } else if (currentLength === 0) {
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = null;
      return;
    } else if (currentLength === lastGeometryLengthRef.current && !geometryChanged) {
      return;
    } else {
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = geometry;
    }

    if (lastGeometryRef.current === null) {
      lastGeometryRef.current = geometry;
    }

    const startIndex = lastGeometryLengthRef.current;
    const meshesToAdd = geometry.slice(startIndex);

    for (const meshData of meshesToAdd) {
      if (processedMeshIdsRef.current.has(meshData.expressId)) continue;

      const vertexCount = meshData.positions.length / 3;
      const interleaved = new Float32Array(vertexCount * 6);
      for (let i = 0; i < vertexCount; i++) {
        const base = i * 6;
        const posBase = i * 3;
        interleaved[base] = meshData.positions[posBase];
        interleaved[base + 1] = meshData.positions[posBase + 1];
        interleaved[base + 2] = meshData.positions[posBase + 2];
        interleaved[base + 3] = meshData.normals[posBase];
        interleaved[base + 4] = meshData.normals[posBase + 1];
        interleaved[base + 5] = meshData.normals[posBase + 2];
      }

      const vertexBuffer = device.createBuffer({
        size: interleaved.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, interleaved);

      const indexBuffer = device.createBuffer({
        size: meshData.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(indexBuffer, 0, meshData.indices);

      scene.addMesh({
        expressId: meshData.expressId,
        vertexBuffer,
        indexBuffer,
        indexCount: meshData.indices.length,
        transform: MathUtils.identity(),
        color: meshData.color,
      });

      processedMeshIdsRef.current.add(meshData.expressId);
    }

    lastGeometryLengthRef.current = currentLength;

    // Fit camera
    if (!cameraFittedRef.current && coordinateInfo?.shiftedBounds) {
      const shiftedBounds = coordinateInfo.shiftedBounds;
      const maxSize = Math.max(
        shiftedBounds.max.x - shiftedBounds.min.x,
        shiftedBounds.max.y - shiftedBounds.min.y,
        shiftedBounds.max.z - shiftedBounds.min.z
      );
      if (maxSize > 0 && Number.isFinite(maxSize)) {
        renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
        cameraFittedRef.current = true;
      }
    } else if (!cameraFittedRef.current && geometry.length > 0) {
      const fallbackBounds = {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };

      for (const meshData of geometry) {
        for (let i = 0; i < meshData.positions.length; i += 3) {
          const x = meshData.positions[i];
          const y = meshData.positions[i + 1];
          const z = meshData.positions[i + 2];
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            fallbackBounds.min.x = Math.min(fallbackBounds.min.x, x);
            fallbackBounds.min.y = Math.min(fallbackBounds.min.y, y);
            fallbackBounds.min.z = Math.min(fallbackBounds.min.z, z);
            fallbackBounds.max.x = Math.max(fallbackBounds.max.x, x);
            fallbackBounds.max.y = Math.max(fallbackBounds.max.y, y);
            fallbackBounds.max.z = Math.max(fallbackBounds.max.z, z);
          }
        }
      }

      if (fallbackBounds.min.x !== Infinity) {
        renderer.getCamera().fitToBounds(fallbackBounds.min, fallbackBounds.max);
        cameraFittedRef.current = true;
      }
    }

    renderer.render({
      hiddenIds: hiddenEntities,
      isolatedIds: isolatedEntities,
      selectedId: selectedEntityId,
    });
  }, [geometry, isInitialized, coordinateInfo, hiddenEntities, isolatedEntities, selectedEntityId]);

  // Re-render when visibility changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    renderer.render({
      hiddenIds: hiddenEntities,
      isolatedIds: isolatedEntities,
      selectedId: selectedEntityId,
    });
  }, [hiddenEntities, isolatedEntities, selectedEntityId, isInitialized]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}

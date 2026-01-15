/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D viewport component
 */

import { useEffect, useRef, useState } from 'react';
import { Renderer, MathUtils } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { useViewerStore, type MeasurePoint } from '@/store';

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
  const updateCameraRotationRealtime = useViewerStore((state) => state.updateCameraRotationRealtime);
  const updateScaleRealtime = useViewerStore((state) => state.updateScaleRealtime);
  const setCameraCallbacks = useViewerStore((state) => state.setCameraCallbacks);
  const theme = useViewerStore((state) => state.theme);

  // New store subscriptions for enhanced features
  const setHoverState = useViewerStore((state) => state.setHoverState);
  const clearHover = useViewerStore((state) => state.clearHover);
  const hoverTooltipsEnabled = useViewerStore((state) => state.hoverTooltipsEnabled);
  const openContextMenu = useViewerStore((state) => state.openContextMenu);
  const toggleSelection = useViewerStore((state) => state.toggleSelection);
  const pendingMeasurePoint = useViewerStore((state) => state.pendingMeasurePoint);
  const addMeasurePoint = useViewerStore((state) => state.addMeasurePoint);
  const completeMeasurement = useViewerStore((state) => state.completeMeasurement);
  const sectionPlane = useViewerStore((state) => state.sectionPlane);

  // Theme-aware clear color ref (updated when theme changes)
  const clearColorRef = useRef<[number, number, number, number]>([0.1, 0.1, 0.1, 1]);

  useEffect(() => {
    // Update clear color when theme changes
    if (theme === 'light') {
      clearColorRef.current = [0.95, 0.95, 0.95, 1]; // Light gray/white for light mode
    } else {
      clearColorRef.current = [0.1, 0.1, 0.1, 1]; // Dark gray for dark mode
    }
    // Re-render with new clear color
    const renderer = rendererRef.current;
    if (renderer && isInitialized) {
      renderer.render({
        hiddenIds: hiddenEntitiesRef.current,
        isolatedIds: isolatedEntitiesRef.current,
        selectedId: selectedEntityIdRef.current,
        clearColor: clearColorRef.current,
      });
    }
  }, [theme, isInitialized]);

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
    startX: 0,  // Track start position for drag detection
    startY: 0,
    didDrag: false,  // True if mouse moved significantly during drag
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

  // Geometry bounds for camera controls
  const geometryBoundsRef = useRef<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>({
    min: { x: -100, y: -100, z: -100 },
    max: { x: 100, y: 100, z: 100 },
  });

  // Visibility state refs for animation loop
  const hiddenEntitiesRef = useRef<Set<number>>(hiddenEntities);
  const isolatedEntitiesRef = useRef<Set<number> | null>(isolatedEntities);
  const selectedEntityIdRef = useRef<number | null>(selectedEntityId);
  const activeToolRef = useRef<string>(activeTool);
  const pendingMeasurePointRef = useRef<MeasurePoint | null>(pendingMeasurePoint);
  const sectionPlaneRef = useRef(sectionPlane);
  const geometryRef = useRef<MeshData[] | null>(geometry);

  // Hover throttling
  const lastHoverCheckRef = useRef<number>(0);
  const hoverThrottleMs = 50; // Check hover every 50ms
  const hoverTooltipsEnabledRef = useRef(hoverTooltipsEnabled);

  // Keep refs in sync
  useEffect(() => { hiddenEntitiesRef.current = hiddenEntities; }, [hiddenEntities]);
  useEffect(() => { isolatedEntitiesRef.current = isolatedEntities; }, [isolatedEntities]);
  useEffect(() => { selectedEntityIdRef.current = selectedEntityId; }, [selectedEntityId]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { pendingMeasurePointRef.current = pendingMeasurePoint; }, [pendingMeasurePoint]);
  useEffect(() => { sectionPlaneRef.current = sectionPlane; }, [sectionPlane]);
  useEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);
  useEffect(() => {
    hoverTooltipsEnabledRef.current = hoverTooltipsEnabled;
    if (!hoverTooltipsEnabled) {
      // Clear hover state when disabled
      clearHover();
    }
  }, [hoverTooltipsEnabled, clearHover]);

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

      // Helper function to get current pick options with visibility filtering
      // This ensures users can only select visible elements (respects hide/isolate/type visibility)
      function getPickOptions() {
        const currentProgress = useViewerStore.getState().progress;
        const currentIsStreaming = currentProgress !== null && currentProgress.percent < 100;
        return {
          isStreaming: currentIsStreaming,
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
        };
      }

      // Helper function to get entity bounds (min/max) - defined early for callbacks
      function getEntityBounds(
        geom: MeshData[] | null,
        entityId: number
      ): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
        if (!geom) {
          console.warn('[Viewport] getEntityBounds: geometry is null');
          return null;
        }
        const mesh = geom.find(m => m.expressId === entityId);
        if (!mesh) {
          console.warn(`[Viewport] getEntityBounds: mesh not found for entityId ${entityId}`);
          return null;
        }
        if (mesh.positions.length < 3) {
          console.warn(`[Viewport] getEntityBounds: mesh has insufficient positions for entityId ${entityId}`);
          return null;
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < mesh.positions.length; i += 3) {
          const x = mesh.positions[i];
          const y = mesh.positions[i + 1];
          const z = mesh.positions[i + 2];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        }

        return {
          min: { x: minX, y: minY, z: minZ },
          max: { x: maxX, y: maxY, z: maxZ },
        };
      }

      // Helper function to get entity center from geometry (uses bounding box center)
      function getEntityCenter(
        geom: MeshData[] | null,
        entityId: number
      ): { x: number; y: number; z: number } | null {
        const bounds = getEntityBounds(geom, entityId);
        if (bounds) {
          return {
            x: (bounds.min.x + bounds.max.x) / 2,
            y: (bounds.min.y + bounds.max.y) / 2,
            z: (bounds.min.z + bounds.max.z) / 2,
          };
        }
        return null;
      }

      // Register camera callbacks for ViewCube and other controls
      setCameraCallbacks({
        setPresetView: (view) => {
          // Pass actual geometry bounds to avoid distance drift
          camera.setPresetView(view, geometryBoundsRef.current);
          // Initial render - animation loop will continue rendering during animation
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          calculateScale();
        },
        fitAll: () => {
          // Zoom to fit without changing view direction
          camera.zoomExtent(geometryBoundsRef.current.min, geometryBoundsRef.current.max, 300);
          calculateScale();
        },
        home: () => {
          // Reset to isometric view
          camera.zoomToFit(geometryBoundsRef.current.min, geometryBoundsRef.current.max, 500);
          calculateScale();
        },
        zoomIn: () => {
          camera.zoom(-50, false);
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          calculateScale();
        },
        zoomOut: () => {
          camera.zoom(50, false);
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          calculateScale();
        },
        frameSelection: () => {
          // Frame selection - zoom to fit selected element
          const selectedId = selectedEntityIdRef.current;
          const geom = geometryRef.current;
          if (selectedId !== null && geom) {
            const bounds = getEntityBounds(geom, selectedId);
            if (bounds) {
              camera.frameBounds(bounds.min, bounds.max, 300);
              calculateScale();
            } else {
              console.warn('[Viewport] frameSelection: Could not get bounds for selected element');
            }
          } else {
            console.warn('[Viewport] frameSelection: No selection or geometry');
          }
        },
        orbit: (deltaX: number, deltaY: number) => {
          // Orbit camera from ViewCube drag
          camera.orbit(deltaX, deltaY, false);
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
        },
      });

      // Calculate scale bar value (world-space size for 96px scale bar)
      const calculateScale = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const viewportHeight = canvas.height;
        const distance = camera.getDistance();
        const fov = camera.getFOV();
        const scaleBarPixels = 96; // w-24 = 6rem = 96px

        // Calculate world-space size: (screen pixels / viewport height) * (distance * tan(FOV/2) * 2)
        const worldSize = (scaleBarPixels / viewportHeight) * (distance * Math.tan(fov / 2) * 2);
        updateScaleRealtime(worldSize);
      };

      // Animation loop - update ViewCube in real-time
      let lastRotationUpdate = 0;
      let lastScaleUpdate = 0;
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
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          // Update ViewCube during camera animation (e.g., preset view transitions)
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
        } else if (!mouseState.isDragging && currentTime - lastRotationUpdate > 100) {
          // Update camera rotation for ViewCube when not dragging (throttled)
          updateCameraRotationRealtime(camera.getRotation());
          lastRotationUpdate = currentTime;
        }

        // Update scale bar (throttled to every 100ms)
        if (currentTime - lastScaleUpdate > 100) {
          calculateScale();
          lastScaleUpdate = currentTime;
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(animate);

      // Mouse controls - respect active tool
      canvas.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        mouseState.isDragging = true;
        mouseState.button = e.button;
        mouseState.lastX = e.clientX;
        mouseState.lastY = e.clientY;
        mouseState.startX = e.clientX;
        mouseState.startY = e.clientY;
        mouseState.didDrag = false;

        // Determine action based on active tool and mouse button
        const tool = activeToolRef.current;

        const willOrbit = !(tool === 'pan' || e.button === 1 || e.button === 2 ||
          (tool === 'select' && e.shiftKey) ||
          (tool !== 'orbit' && tool !== 'select' && e.shiftKey));

        // Set orbit pivot to what user clicks on (standard CAD/BIM behavior)
        // Simple and predictable: orbit around clicked geometry, or model center if empty space
        if (willOrbit && tool !== 'measure' && tool !== 'walk') {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Pick at cursor position - orbit around what user is clicking on
          // Uses visibility filtering so hidden elements don't affect orbit pivot
          const pickedId = await renderer.pick(x, y, getPickOptions());
          if (pickedId !== null) {
            const center = getEntityCenter(geometryRef.current, pickedId);
            if (center) {
              camera.setOrbitPivot(center);
            } else {
              camera.setOrbitPivot(null);
            }
          } else {
            // No geometry under cursor - orbit around current target (model center)
            camera.setOrbitPivot(null);
          }
        }

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
        } else if (tool === 'measure') {
          // Measure tool - cursor indicates measurement mode
          canvas.style.cursor = 'crosshair';
        } else {
          // Default behavior
          mouseState.isPanning = e.shiftKey;
          canvas.style.cursor = e.shiftKey ? 'move' : 'grabbing';
        }
      });

      canvas.addEventListener('mousemove', async (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (mouseState.isDragging) {
          const dx = e.clientX - mouseState.lastX;
          const dy = e.clientY - mouseState.lastY;
          const tool = activeToolRef.current;

          // Check if this counts as a drag (moved more than 5px from start)
          const totalDx = e.clientX - mouseState.startX;
          const totalDy = e.clientY - mouseState.startY;
          if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
            mouseState.didDrag = true;
          }

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
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
          // Update ViewCube rotation in real-time during drag
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
          // Clear hover while dragging
          clearHover();
        } else if (hoverTooltipsEnabledRef.current) {
          // Hover detection (throttled) - only if tooltips are enabled
          const now = Date.now();
          if (now - lastHoverCheckRef.current > hoverThrottleMs) {
            lastHoverCheckRef.current = now;
            // Uses visibility filtering so hidden elements don't show hover tooltips
            const pickedId = await renderer.pick(x, y, getPickOptions());
            if (pickedId) {
              setHoverState({ entityId: pickedId, screenX: e.clientX, screenY: e.clientY });
            } else {
              clearHover();
            }
          }
        }
      });

      canvas.addEventListener('mouseup', () => {
        mouseState.isDragging = false;
        mouseState.isPanning = false;
        const tool = activeToolRef.current;
        canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'orbit' ? 'grab' : 'default');
        // Clear orbit pivot after each orbit operation
        camera.setOrbitPivot(null);
      });

      canvas.addEventListener('mouseleave', () => {
        mouseState.isDragging = false;
        mouseState.isPanning = false;
        camera.stopInertia();
        camera.setOrbitPivot(null);
        canvas.style.cursor = 'default';
        clearHover();
      });

      canvas.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Uses visibility filtering so hidden elements don't appear in context menu
        const pickedId = await renderer.pick(x, y, getPickOptions());
        openContextMenu(pickedId, e.clientX, e.clientY);
      });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        camera.zoom(e.deltaY, false, mouseX, mouseY, canvas.width, canvas.height);
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          clearColor: clearColorRef.current,
          sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
        });
      });

      // Click handling
      canvas.addEventListener('click', async (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const tool = activeToolRef.current;

        // Skip selection if user was dragging (orbiting/panning)
        if (mouseState.didDrag) {
          return;
        }

        // Skip selection for orbit/pan tools - they don't select
        if (tool === 'orbit' || tool === 'pan' || tool === 'walk') {
          return;
        }

        // Handle measure tool clicks
        if (tool === 'measure') {
          // Uses visibility filtering so measurements only snap to visible elements
          const pickedId = await renderer.pick(x, y, getPickOptions());
          if (pickedId) {
            // Get 3D position from mesh vertices (simplified - uses center of clicked entity)
            // In a full implementation, you'd use ray-triangle intersection
            const worldPos = getApproximateWorldPosition(geometryRef.current, pickedId, x, y, canvas.width, canvas.height);
            const measurePoint: MeasurePoint = {
              x: worldPos.x,
              y: worldPos.y,
              z: worldPos.z,
              screenX: e.clientX,
              screenY: e.clientY,
            };

            if (pendingMeasurePointRef.current) {
              // Complete the measurement
              completeMeasurement(measurePoint);
            } else {
              // Start a new measurement
              addMeasurePoint(measurePoint);
            }
          }
          return;
        }

        const now = Date.now();
        const timeSinceLastClick = now - lastClickTimeRef.current;
        const clickPos = { x, y };

        if (lastClickPosRef.current &&
          timeSinceLastClick < 300 &&
          Math.abs(clickPos.x - lastClickPosRef.current.x) < 5 &&
          Math.abs(clickPos.y - lastClickPosRef.current.y) < 5) {
          // Double-click - isolate element
          // Uses visibility filtering so only visible elements can be selected
          const pickedId = await renderer.pick(x, y, getPickOptions());
          if (pickedId) {
            setSelectedEntityId(pickedId);
          }
          lastClickTimeRef.current = 0;
          lastClickPosRef.current = null;
        } else {
          // Single click - uses visibility filtering so only visible elements can be selected
          const pickedId = await renderer.pick(x, y, getPickOptions());

          // Multi-selection with Ctrl/Cmd
          if (e.ctrlKey || e.metaKey) {
            if (pickedId) {
              toggleSelection(pickedId);
            }
          } else {
            setSelectedEntityId(pickedId);
          }

          lastClickTimeRef.current = now;
          lastClickPosRef.current = clickPos;
        }
      });


      // Helper function to get approximate world position (for measurement tool)
      function getApproximateWorldPosition(
        geom: MeshData[] | null,
        entityId: number,
        _screenX: number,
        _screenY: number,
        _canvasWidth: number,
        _canvasHeight: number
      ): { x: number; y: number; z: number } {
        return getEntityCenter(geom, entityId) || { x: 0, y: 0, z: 0 };
      }

      // Touch controls
      canvas.addEventListener('touchstart', async (e) => {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);

        if (touchState.touches.length === 1) {
          touchState.lastCenter = {
            x: touchState.touches[0].clientX,
            y: touchState.touches[0].clientY,
          };

          // Set orbit pivot to what user touches (same as mouse click behavior)
          const rect = canvas.getBoundingClientRect();
          const x = touchState.touches[0].clientX - rect.left;
          const y = touchState.touches[0].clientY - rect.top;

          // Uses visibility filtering so hidden elements don't affect orbit pivot
          const pickedId = await renderer.pick(x, y, getPickOptions());
          if (pickedId !== null) {
            const center = getEntityCenter(geometryRef.current, pickedId);
            if (center) {
              camera.setOrbitPivot(center);
            } else {
              camera.setOrbitPivot(null);
            }
          } else {
            camera.setOrbitPivot(null);
          }
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
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
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
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
        }
      });

      canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);
        if (touchState.touches.length === 0) {
          camera.stopInertia();
          camera.setOrbitPivot(null);
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

        // Preset views - set view and re-render
        const setViewAndRender = (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right') => {
          camera.setPresetView(view, geometryBoundsRef.current);
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
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
          camera.zoomToFit(geometryBoundsRef.current.min, geometryBoundsRef.current.max, 500);
          calculateScale();
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

        if (moved) {
          renderer.render({
            hiddenIds: hiddenEntitiesRef.current,
            isolatedIds: isolatedEntitiesRef.current,
            selectedId: selectedEntityIdRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: sectionPlaneRef.current.enabled ? sectionPlaneRef.current : undefined,
          });
        }
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
        renderer.render({
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          selectedId: selectedEntityIdRef.current,
          clearColor: clearColorRef.current,
        });
      });
      resizeObserver.observe(canvas);

      renderer.render({
        hiddenIds: hiddenEntitiesRef.current,
        isolatedIds: isolatedEntitiesRef.current,
        selectedId: selectedEntityIdRef.current,
        clearColor: clearColorRef.current,
      });
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
  const finalBoundsRefittedRef = useRef<boolean>(false); // Track if we've refitted after streaming

  // Render throttling during streaming
  const lastRenderTimeRef = useRef<number>(0);
  const RENDER_THROTTLE_MS = 200; // Render at most every 200ms during streaming
  const progress = useViewerStore((state) => state.progress);
  const isStreaming = progress !== null && progress.percent < 100;

  useEffect(() => {
    const renderer = rendererRef.current;

    // Handle geometry cleared/null - reset refs so next load is treated as new file
    if (!geometry) {
      if (lastGeometryLengthRef.current > 0 || lastGeometryRef.current !== null) {
        // Geometry was cleared - reset tracking refs
        lastGeometryLengthRef.current = 0;
        lastGeometryRef.current = null;
        processedMeshIdsRef.current.clear();
        cameraFittedRef.current = false;
        finalBoundsRefittedRef.current = false;
        // Clear scene if renderer is ready
        if (renderer && isInitialized) {
          renderer.getScene().clear();
          renderer.getCamera().reset();
          geometryBoundsRef.current = {
            min: { x: -100, y: -100, z: -100 },
            max: { x: 100, y: 100, z: 100 },
          };
        }
      }
      return;
    }

    if (!renderer || !isInitialized) return;

    const device = renderer.getGPUDevice();
    if (!device) return;

    const scene = renderer.getScene();
    const currentLength = geometry.length;
    const lastLength = lastGeometryLengthRef.current;

    // Use length-based detection instead of reference comparison
    // React creates new array references on every appendGeometryBatch call,
    // so reference comparison would always trigger scene.clear()
    const isIncremental = currentLength > lastLength && lastLength > 0;
    const isNewFile = currentLength > 0 && lastLength === 0;
    const isCleared = currentLength === 0;

    if (isCleared) {
      // Geometry cleared - reset camera and bounds
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      finalBoundsRefittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = null;
      // Reset camera state
      renderer.getCamera().reset();
      // Reset geometry bounds to default
      geometryBoundsRef.current = {
        min: { x: -100, y: -100, z: -100 },
        max: { x: 100, y: 100, z: 100 },
      };
      return;
    } else if (isNewFile) {
      // New file loaded - reset camera and bounds
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      finalBoundsRefittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = geometry;
      // Reset camera state (clear orbit pivot, stop inertia, cancel animations)
      renderer.getCamera().reset();
      // Reset geometry bounds to default
      geometryBoundsRef.current = {
        min: { x: -100, y: -100, z: -100 },
        max: { x: 100, y: 100, z: 100 },
      };
    } else if (!isIncremental && currentLength !== lastLength) {
      // Length decreased (shouldn't happen during streaming) - reset
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      finalBoundsRefittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = geometry;
      // Reset camera state
      renderer.getCamera().reset();
      // Reset geometry bounds to default
      geometryBoundsRef.current = {
        min: { x: -100, y: -100, z: -100 },
        max: { x: 100, y: 100, z: 100 },
      };
    } else if (currentLength === lastLength) {
      // No geometry change - but check if we need to update bounds when streaming completes
      if (cameraFittedRef.current && !isStreaming && !finalBoundsRefittedRef.current && coordinateInfo?.shiftedBounds) {
        const shiftedBounds = coordinateInfo.shiftedBounds;
        const newMaxSize = Math.max(
          shiftedBounds.max.x - shiftedBounds.min.x,
          shiftedBounds.max.y - shiftedBounds.min.y,
          shiftedBounds.max.z - shiftedBounds.min.z
        );

        if (newMaxSize > 0 && Number.isFinite(newMaxSize)) {
          // Only refit camera for LARGE models (>1000 meshes) where geometry streamed in multiple batches
          // Small models complete in one batch, so their initial camera fit is already correct
          const isLargeModel = geometry.length > 1000;

          if (isLargeModel) {
            const oldBounds = geometryBoundsRef.current;
            const oldMaxSize = Math.max(
              oldBounds.max.x - oldBounds.min.x,
              oldBounds.max.y - oldBounds.min.y,
              oldBounds.max.z - oldBounds.min.z
            );

            // Refit camera if bounds expanded significantly (>10% larger)
            // This handles skyscrapers where upper floors arrive in later batches
            const boundsExpanded = newMaxSize > oldMaxSize * 1.1;

            if (boundsExpanded) {
              console.log('[Viewport] Refitting camera after streaming complete - bounds expanded:', {
                oldMaxSize: oldMaxSize.toFixed(1),
                newMaxSize: newMaxSize.toFixed(1),
                expansion: ((newMaxSize / oldMaxSize - 1) * 100).toFixed(0) + '%'
              });
              renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
            }
          }

          // Always update bounds for accurate zoom-to-fit, home view, etc.
          geometryBoundsRef.current = { min: { ...shiftedBounds.min }, max: { ...shiftedBounds.max } };
          finalBoundsRefittedRef.current = true;
        }
      }
      return;
    }

    // For incremental batches: update reference and continue to add new meshes
    if (isIncremental) {
      lastGeometryRef.current = geometry;
    } else if (lastGeometryRef.current === null) {
      lastGeometryRef.current = geometry;
    }

    // FIX: When not streaming (type visibility toggle), new meshes can be ANYWHERE in the array,
    // not just at the end. During streaming, new meshes ARE appended, so slice is safe.
    // After streaming completes, filter changes can insert meshes at any position.
    const meshesToAdd = isStreaming
      ? geometry.slice(lastGeometryLengthRef.current)  // Streaming: new meshes at end
      : geometry;  // Post-streaming: scan entire array for unprocessed meshes

    // Filter out already processed meshes
    const newMeshes: MeshData[] = [];
    for (const meshData of meshesToAdd) {
      if (!processedMeshIdsRef.current.has(meshData.expressId)) {
        newMeshes.push(meshData);
        processedMeshIdsRef.current.add(meshData.expressId);
      }
    }

    if (newMeshes.length > 0) {
      // Batch meshes by color for efficient rendering (reduces draw calls from N to ~100-500)
      // This dramatically improves performance for large models (50K+ meshes)
      const pipeline = renderer.getPipeline();
      if (pipeline) {
        // Use batched rendering - groups meshes by color into single draw calls
        (scene as any).appendToBatches(newMeshes, device, pipeline);

        // Store mesh data for on-demand selection rendering
        // We DON'T create GPU buffers here during streaming - that's 2x the overhead!
        // Instead, store MeshData references and create buffers lazily when selected
        for (const meshData of newMeshes) {
          // Store minimal mesh data for picker and lazy selection buffer creation
          scene.addMeshData(meshData);
        }
      } else {
        // Fallback: add individual meshes if pipeline not ready
        for (const meshData of newMeshes) {
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
        }
      }
    }

    lastGeometryLengthRef.current = currentLength;

    // Fit camera and store bounds
    // IMPORTANT: Fit camera immediately when we have valid bounds to avoid starting inside model
    // The default camera position (50, 50, 100) is inside most models that are shifted to origin
    if (!cameraFittedRef.current && coordinateInfo?.shiftedBounds) {
      const shiftedBounds = coordinateInfo.shiftedBounds;
      const maxSize = Math.max(
        shiftedBounds.max.x - shiftedBounds.min.x,
        shiftedBounds.max.y - shiftedBounds.min.y,
        shiftedBounds.max.z - shiftedBounds.min.z
      );
      // Fit camera immediately when we have valid bounds
      // For streaming: the first batch already has complete bounds from coordinate handler
      // (bounds are calculated from ALL geometry before streaming starts)
      // Waiting for streaming to complete causes the camera to start inside the model
      if (maxSize > 0 && Number.isFinite(maxSize)) {
        renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
        geometryBoundsRef.current = { min: { ...shiftedBounds.min }, max: { ...shiftedBounds.max } };
        cameraFittedRef.current = true;
      }
    } else if (!cameraFittedRef.current && geometry.length > 0 && !isStreaming) {
      // Fallback: calculate bounds from geometry array (only when streaming is complete)
      // This ensures we have complete bounds before fitting camera
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

      const maxSize = Math.max(
        fallbackBounds.max.x - fallbackBounds.min.x,
        fallbackBounds.max.y - fallbackBounds.min.y,
        fallbackBounds.max.z - fallbackBounds.min.z
      );

      if (fallbackBounds.min.x !== Infinity && maxSize > 0 && Number.isFinite(maxSize)) {
        renderer.getCamera().fitToBounds(fallbackBounds.min, fallbackBounds.max);
        geometryBoundsRef.current = fallbackBounds;
        cameraFittedRef.current = true;
      }
    }

    // Note: Background instancing conversion removed
    // Regular MeshData meshes are rendered directly with their correct positions
    // Instancing conversion would require preserving actual mesh transforms, which is complex
    // For now, we render regular meshes directly (fast enough for most cases)

    // Render throttling: During streaming, only render every RENDER_THROTTLE_MS
    // This prevents rendering 28K+ meshes from blocking WASM batch processing
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTimeRef.current;
    const shouldRender = !isStreaming || timeSinceLastRender >= RENDER_THROTTLE_MS;

    if (shouldRender) {
      renderer.render();
      lastRenderTimeRef.current = now;
    }
  }, [geometry, coordinateInfo, isInitialized, isStreaming]);

  // Force render when streaming completes (progress goes from <100% to 100% or null)
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    // If streaming just completed (was streaming, now not), force immediate render
    if (prevIsStreamingRef.current && !isStreaming) {
      renderer.render();
      lastRenderTimeRef.current = Date.now();
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, isInitialized]);

  // Get selectedEntityIds from store for multi-selection
  const selectedEntityIds = useViewerStore((state) => state.selectedEntityIds);

  // Re-render when visibility, selection, or section plane changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    renderer.render({
      hiddenIds: hiddenEntities,
      isolatedIds: isolatedEntities,
      selectedId: selectedEntityId,
      selectedIds: selectedEntityIds,
      clearColor: clearColorRef.current,
      sectionPlane: sectionPlane.enabled ? sectionPlane : undefined,
    });
  }, [hiddenEntities, isolatedEntities, selectedEntityId, selectedEntityIds, isInitialized, sectionPlane]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}

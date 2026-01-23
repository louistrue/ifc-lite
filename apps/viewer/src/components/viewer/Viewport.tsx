/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D viewport component
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { Renderer, MathUtils, type SnapTarget, type PickResult } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { useViewerStore, type MeasurePoint, type SnapVisualization } from '@/store';
import {
  useSelectionState,
  useVisibilityState,
  useToolState,
  useMeasurementState,
  useCameraState,
  useHoverState,
  useThemeState,
  useContextMenuState,
  useColorUpdateState,
  useIfcDataState,
} from '../../hooks/useViewerSelectors.js';
import { useModelSelection } from '../../hooks/useModelSelection.js';
import {
  getEntityBounds,
  getEntityCenter,
  buildRenderOptions,
  getRenderThrottleMs,
  getThemeClearColor,
  calculateScaleBarSize,
  type ViewportStateRefs,
} from '../../utils/viewportUtils.js';

interface ViewportProps {
  geometry: MeshData[] | null;
  coordinateInfo?: CoordinateInfo;
  computedIsolatedIds?: Set<number> | null;
  modelIdToIndex?: Map<string, number>;
}

export function Viewport({ geometry, coordinateInfo, computedIsolatedIds, modelIdToIndex }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Selection state
  const { selectedEntityId, selectedEntityIds, setSelectedEntityId, setSelectedEntity, toggleSelection, models } = useSelectionState();
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  // Get the bulletproof store-based resolver (more reliable than singleton)
  const resolveGlobalIdFromModels = useViewerStore((s) => s.resolveGlobalIdFromModels);

  // Sync selectedEntityId with model-aware selectedEntity for PropertiesPanel
  useModelSelection();

  // Create reverse mapping from modelIndex to modelId for selection
  const modelIndexToId = useMemo(() => {
    if (!modelIdToIndex) return new Map<number, string>();
    const reverse = new Map<number, string>();
    for (const [modelId, index] of modelIdToIndex) {
      reverse.set(index, modelId);
    }
    return reverse;
  }, [modelIdToIndex]);

  // Compute selectedModelIndex for renderer (multi-model selection highlighting)
  const selectedModelIndex = selectedEntity && modelIdToIndex
    ? modelIdToIndex.get(selectedEntity.modelId) ?? undefined
    : undefined;

  // Helper to handle pick result and set selection properly
  // IMPORTANT: pickResult.expressId is now a globalId (transformed at load time)
  // We use the store-based resolver to find (modelId, originalExpressId)
  // This is more reliable than the singleton registry which can have bundling issues
  const handlePickForSelection = (pickResult: PickResult | null) => {
    if (!pickResult) {
      setSelectedEntityId(null);
      return;
    }

    const globalId = pickResult.expressId;

    // Set globalId for renderer (highlighting uses globalIds directly)
    setSelectedEntityId(globalId);

    // Resolve globalId -> (modelId, originalExpressId) for property panel
    // Use store-based resolver instead of singleton for reliability
    const resolved = resolveGlobalIdFromModels(globalId);
    if (resolved) {
      // Set the EntityRef with ORIGINAL expressId (for property lookup in IfcDataStore)
      setSelectedEntity({ modelId: resolved.modelId, expressId: resolved.expressId });
    } else {
      // Fallback for single-model mode (offset = 0, globalId = expressId)
      // Try to find model from the old modelIndex if available
      if (pickResult.modelIndex !== undefined && modelIndexToId) {
        const modelId = modelIndexToId.get(pickResult.modelIndex);
        if (modelId) {
          setSelectedEntity({ modelId, expressId: globalId });
        }
      }
    }
  };

  // Visibility state - use computedIsolatedIds from parent (includes storey selection)
  // Fall back to store isolation if computedIsolatedIds is not provided
  const { hiddenEntities, isolatedEntities: storeIsolatedEntities } = useVisibilityState();
  const isolatedEntities = computedIsolatedIds ?? storeIsolatedEntities ?? null;

  // Tool state
  const { activeTool, sectionPlane } = useToolState();

  // Camera state
  const { updateCameraRotationRealtime, updateScaleRealtime, setCameraCallbacks } = useCameraState();

  // Theme state
  const { theme } = useThemeState();

  // Hover state
  const { hoverTooltipsEnabled, setHoverState, clearHover } = useHoverState();

  // Context menu state
  const { openContextMenu } = useContextMenuState();

  // Measurement state
  const {
    measurements,
    pendingMeasurePoint,
    activeMeasurement,
    addMeasurePoint,
    completeMeasurement,
    startMeasurement,
    updateMeasurement,
    finalizeMeasurement,
    cancelMeasurement,
    updateMeasurementScreenCoords,
    snapEnabled,
    setSnapTarget,
    setSnapVisualization,
    edgeLockState,
    setEdgeLock,
    updateEdgeLockPosition,
    clearEdgeLock,
    incrementEdgeLockStrength,
  } = useMeasurementState();

  // Color update state
  const { pendingColorUpdates, clearPendingColorUpdates } = useColorUpdateState();

  // IFC data state
  const { ifcDataStore } = useIfcDataState();

  // Calculate section plane range based on storey heights only
  const sectionRange = useMemo(() => {
    if (!ifcDataStore?.spatialHierarchy || !coordinateInfo) return null;

    const { storeyElevations } = ifcDataStore.spatialHierarchy;
    if (storeyElevations.size === 0) return null;

    // Storey elevations are in original IFC coordinates - need to apply origin shift
    const yShift = coordinateInfo.originShift.y;

    let minLevel = Infinity;
    let maxLevel = -Infinity;

    // Find lowest and highest storey elevations (shifted to match geometry)
    for (const elevation of storeyElevations.values()) {
      const shiftedElevation = elevation - yShift;
      if (shiftedElevation < minLevel) minLevel = shiftedElevation;
      if (shiftedElevation > maxLevel) maxLevel = shiftedElevation;
    }

    // Use storey bounds with fixed 5m margin
    const minWithMargin = minLevel - 5;
    const maxWithMargin = maxLevel + 5;

    return Number.isFinite(minWithMargin) && Number.isFinite(maxWithMargin) ? { min: minWithMargin, max: maxWithMargin } : null;
  }, [ifcDataStore, coordinateInfo]);

  // Theme-aware clear color ref (updated when theme changes)
  // Tokyo Night storm: #1a1b26 = rgb(26, 27, 38)
  const clearColorRef = useRef<[number, number, number, number]>([0.102, 0.106, 0.149, 1]);

  useEffect(() => {
    // Update clear color when theme changes
    clearColorRef.current = getThemeClearColor(theme as 'light' | 'dark');
    // Re-render with new clear color
    const renderer = rendererRef.current;
    if (renderer && isInitialized) {
      renderer.render({
        hiddenIds: hiddenEntitiesRef.current,
        isolatedIds: isolatedEntitiesRef.current,
        selectedId: selectedEntityIdRef.current,
            selectedModelIndex: selectedModelIndexRef.current,
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
  const selectedModelIndexRef = useRef<number | undefined>(selectedModelIndex);
  const activeToolRef = useRef<string>(activeTool);
  const pendingMeasurePointRef = useRef<MeasurePoint | null>(pendingMeasurePoint);
  const activeMeasurementRef = useRef(activeMeasurement);
  const snapEnabledRef = useRef(snapEnabled);
  const edgeLockStateRef = useRef(edgeLockState);
  const sectionPlaneRef = useRef(sectionPlane);
  const sectionRangeRef = useRef<{ min: number; max: number } | null>(null);
  const geometryRef = useRef<MeshData[] | null>(geometry);

  // Hover throttling
  const lastHoverCheckRef = useRef<number>(0);
  const hoverThrottleMs = 50; // Check hover every 50ms
  const hoverTooltipsEnabledRef = useRef(hoverTooltipsEnabled);

  // Measure tool throttling (16ms = 60fps max)
  const measureRaycastPendingRef = useRef(false);
  const measureRaycastFrameRef = useRef<number | null>(null);
  // Hover-only snap detection throttling (100ms = 10fps max for hover, 60fps for active measurement)
  const lastHoverSnapTimeRef = useRef<number>(0);
  const HOVER_SNAP_THROTTLE_MS = 100;

  // Render throttling during orbit/pan
  // Adaptive: 16ms (60fps) for small models, up to 33ms (30fps) for very large models
  const lastRenderTimeRef = useRef<number>(0);
  const renderPendingRef = useRef<boolean>(false);
  const RENDER_THROTTLE_MS_SMALL = 16;  // ~60fps for models < 10K meshes
  const RENDER_THROTTLE_MS_LARGE = 25;  // ~40fps for models 10K-50K meshes
  const RENDER_THROTTLE_MS_HUGE = 33;   // ~30fps for models > 50K meshes

  // Camera state tracking for measurement updates (only update when camera actually moved)
  const lastCameraStateRef = useRef<{
    position: { x: number; y: number; z: number };
    rotation: { azimuth: number; elevation: number };
    distance: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null>(null);

  // Keep refs in sync
  useEffect(() => { hiddenEntitiesRef.current = hiddenEntities; }, [hiddenEntities]);
  useEffect(() => { isolatedEntitiesRef.current = isolatedEntities; }, [isolatedEntities]);
  useEffect(() => { selectedEntityIdRef.current = selectedEntityId; }, [selectedEntityId]);
  useEffect(() => { selectedModelIndexRef.current = selectedModelIndex; }, [selectedModelIndex]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { pendingMeasurePointRef.current = pendingMeasurePoint; }, [pendingMeasurePoint]);
  useEffect(() => { activeMeasurementRef.current = activeMeasurement; }, [activeMeasurement]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);
  useEffect(() => { edgeLockStateRef.current = edgeLockState; }, [edgeLockState]);
  useEffect(() => { sectionPlaneRef.current = sectionPlane; }, [sectionPlane]);
  useEffect(() => { sectionRangeRef.current = sectionRange; }, [sectionRange]);
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

  // Cleanup measurement state when tool changes + set cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (activeTool !== 'measure') {
      // Cancel any active measurement
      if (activeMeasurement) {
        cancelMeasurement();
      }
      // Clear pending raycast requests
      if (measureRaycastFrameRef.current !== null) {
        cancelAnimationFrame(measureRaycastFrameRef.current);
        measureRaycastFrameRef.current = null;
        measureRaycastPendingRef.current = false;
      }
    }

    // Set cursor based on active tool
    if (activeTool === 'measure') {
      canvas.style.cursor = 'crosshair';
    } else if (activeTool === 'pan' || activeTool === 'orbit') {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  }, [activeTool, activeMeasurement, cancelMeasurement]);

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

      // Helper function to compute snap visualization (edge highlights, sliding dot, corner rings, plane indicators)
      // Stores 3D coordinates so edge highlights stay positioned correctly during camera rotation
      function updateSnapVisualization(snapTarget: SnapTarget | null, edgeLockInfo?: { edgeT: number; isCorner: boolean; cornerValence: number }) {
        if (!snapTarget || !canvas) {
          setSnapVisualization(null);
          return;
        }

        const viz: Partial<SnapVisualization> = {};

        // For edge snaps: store 3D world coordinates (will be projected to screen by ToolOverlays)
        if ((snapTarget.type === 'edge' || snapTarget.type === 'vertex') && snapTarget.metadata?.vertices) {
          const [v0, v1] = snapTarget.metadata.vertices;

          // Store 3D coordinates - these will be projected dynamically during rendering
          viz.edgeLine3D = {
            v0: { x: v0.x, y: v0.y, z: v0.z },
            v1: { x: v1.x, y: v1.y, z: v1.z },
          };

          // Add sliding dot t-parameter along the edge
          if (edgeLockInfo) {
            viz.slidingDot = { t: edgeLockInfo.edgeT };

            // Add corner rings if at a corner with high valence
            if (edgeLockInfo.isCorner && edgeLockInfo.cornerValence >= 2) {
              viz.cornerRings = {
                atStart: edgeLockInfo.edgeT < 0.5,
                valence: edgeLockInfo.cornerValence,
              };
            }
          } else {
            // No edge lock info - calculate t from snap position
            const edge = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
            const toSnap = { x: snapTarget.position.x - v0.x, y: snapTarget.position.y - v0.y, z: snapTarget.position.z - v0.z };
            const edgeLenSq = edge.x * edge.x + edge.y * edge.y + edge.z * edge.z;
            const t = edgeLenSq > 0 ? (toSnap.x * edge.x + toSnap.y * edge.y + toSnap.z * edge.z) / edgeLenSq : 0.5;
            viz.slidingDot = { t: Math.max(0, Math.min(1, t)) };
          }
        }

        // For face snaps: show plane indicator (still screen-space since it's just an indicator)
        if ((snapTarget.type === 'face' || snapTarget.type === 'face_center') && snapTarget.normal) {
          const pos = camera.projectToScreen(snapTarget.position, canvas.width, canvas.height);
          if (pos) {
            viz.planeIndicator = {
              x: pos.x,
              y: pos.y,
              normal: snapTarget.normal,
            };
          }
        }

        setSnapVisualization(viz);
      }

      // Note: getEntityBounds and getEntityCenter are now imported from viewportUtils.ts

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
            selectedModelIndex: selectedModelIndexRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: activeToolRef.current === 'section' ? {
              ...sectionPlaneRef.current,
              min: sectionRangeRef.current?.min,
              max: sectionRangeRef.current?.max,
            } : undefined,
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
            selectedModelIndex: selectedModelIndexRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: activeToolRef.current === 'section' ? {
              ...sectionPlaneRef.current,
              min: sectionRangeRef.current?.min,
              max: sectionRangeRef.current?.max,
            } : undefined,
          });
          calculateScale();
        },
        zoomOut: () => {
          camera.zoom(50, false);
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
        },
        projectToScreen: (worldPos: { x: number; y: number; z: number }) => {
          // Project 3D world position to 2D screen coordinates
          const canvas = canvasRef.current;
          if (!canvas) return null;
          return camera.projectToScreen(worldPos, canvas.width, canvas.height);
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
            selectedModelIndex: selectedModelIndexRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: activeToolRef.current === 'section' ? {
              ...sectionPlaneRef.current,
              min: sectionRangeRef.current?.min,
              max: sectionRangeRef.current?.max,
            } : undefined,
          });
          // Update ViewCube during camera animation (e.g., preset view transitions)
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
        } else if (!mouseState.isDragging && currentTime - lastRotationUpdate > 500) {
          // Update camera rotation for ViewCube when not dragging (throttled to every 500ms when idle)
          updateCameraRotationRealtime(camera.getRotation());
          lastRotationUpdate = currentTime;
        }

        // Update scale bar (throttled to every 500ms - scale rarely needs frequent updates)
        if (currentTime - lastScaleUpdate > 500) {
          calculateScale();
          lastScaleUpdate = currentTime;
        }

        // Update measurement screen coordinates only when:
        // 1. Measure tool is active (not in other modes)
        // 2. Measurements exist
        // 3. Camera actually changed
        // This prevents unnecessary store updates and re-renders when not measuring
        if (activeToolRef.current === 'measure') {
          const state = useViewerStore.getState();
          if (state.measurements.length > 0 || state.activeMeasurement) {
            const canvas = canvasRef.current;
            if (canvas) {
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

              // Check if camera state changed
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
          }
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
          const pickResult = await renderer.pick(x, y, getPickOptions());
          if (pickResult !== null) {
            const center = getEntityCenter(geometryRef.current, pickResult.expressId);
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
          // Measure tool - shift+drag = orbit, normal drag = measure
          if (e.shiftKey) {
            // Shift pressed: allow orbit (not pan)
            // Mouse positions already initialized at start of mousedown handler
            mouseState.isPanning = false;
            canvas.style.cursor = 'grabbing';
            // Don't return early - fall through to allow orbit handling in mousemove
          } else {
            // Normal drag: start measurement
            mouseState.isDragging = true; // Mark as dragging for measure tool
            canvas.style.cursor = 'crosshair';

            // Calculate canvas-relative coordinates
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Use magnetic snap for better edge locking
            const currentLock = edgeLockStateRef.current;
            const result = renderer.raycastSceneMagnetic(x, y, {
              edge: currentLock.edge,
              meshExpressId: currentLock.meshExpressId,
              lockStrength: currentLock.lockStrength,
            }, {
              hiddenIds: hiddenEntitiesRef.current,
              isolatedIds: isolatedEntitiesRef.current,
              snapOptions: snapEnabled ? {
                snapToVertices: true,
                snapToEdges: true,
                snapToFaces: true,
                screenSnapRadius: 60,
              } : {
                snapToVertices: false,
                snapToEdges: false,
                snapToFaces: false,
                screenSnapRadius: 0,
              },
            });

            if (result.intersection || result.snapTarget) {
              const snapPoint = result.snapTarget || result.intersection;
              const pos = snapPoint ? ('position' in snapPoint ? snapPoint.position : snapPoint.point) : null;

              if (pos) {
                // Project snapped 3D position to screen - measurement starts from indicator, not cursor
                const screenPos = camera.projectToScreen(pos, canvas.width, canvas.height);
                const measurePoint: MeasurePoint = {
                  x: pos.x,
                  y: pos.y,
                  z: pos.z,
                  screenX: screenPos?.x ?? x,
                  screenY: screenPos?.y ?? y,
                };

                startMeasurement(measurePoint);

                if (result.snapTarget) {
                  setSnapTarget(result.snapTarget);
                }

                // Update edge lock state
                if (result.edgeLock.shouldRelease) {
                  // Clear stale lock when release is signaled
                  clearEdgeLock();
                  updateSnapVisualization(result.snapTarget || null);
                } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                  setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId, result.edgeLock.edgeT);
                  updateSnapVisualization(result.snapTarget, {
                    edgeT: result.edgeLock.edgeT,
                    isCorner: result.edgeLock.isCorner,
                    cornerValence: result.edgeLock.cornerValence,
                  });
                } else {
                  updateSnapVisualization(result.snapTarget);
                }
              }
            }
            return; // Early return for measure tool (non-shift)
          }
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
        const tool = activeToolRef.current;

        // Handle measure tool live preview while dragging
        // IMPORTANT: Check tool first, not activeMeasurement, to prevent orbit conflict
        if (tool === 'measure' && mouseState.isDragging) {
          // Shift+drag: allow orbit instead of measurement
          if (e.shiftKey) {
            // Cancel any active measurement and allow orbit
            if (activeMeasurementRef.current) {
              cancelMeasurement();
            }
            // Fall through to orbit handling below
          } else {
            // Normal measure tool drag
            // Only raycast if we have an active measurement
            if (!activeMeasurementRef.current) {
              // Just started dragging, measurement will be set soon
              // Don't do anything yet to avoid race condition
              return;
            }

            // Throttle raycasting to 60fps max using requestAnimationFrame
            if (!measureRaycastPendingRef.current) {
              measureRaycastPendingRef.current = true;

              measureRaycastFrameRef.current = requestAnimationFrame(() => {
                measureRaycastPendingRef.current = false;
                measureRaycastFrameRef.current = null;

                // Use magnetic snap for edge sliding behavior
                const currentLock = edgeLockStateRef.current;
                const result = renderer.raycastSceneMagnetic(x, y, {
                  edge: currentLock.edge,
                  meshExpressId: currentLock.meshExpressId,
                  lockStrength: currentLock.lockStrength,
                }, {
                  hiddenIds: hiddenEntitiesRef.current,
                  isolatedIds: isolatedEntitiesRef.current,
                  snapOptions: snapEnabledRef.current ? {
                    snapToVertices: true,
                    snapToEdges: true,
                    snapToFaces: true,
                    screenSnapRadius: 60,
                  } : {
                    snapToVertices: false,
                    snapToEdges: false,
                    snapToFaces: false,
                    screenSnapRadius: 0,
                  },
                });

                if (result.intersection || result.snapTarget) {
                  const snapPoint = result.snapTarget || result.intersection;
                  const pos = snapPoint ? ('position' in snapPoint ? snapPoint.position : snapPoint.point) : null;

                  if (pos) {
                    // Project snapped 3D position to screen - indicator position, not raw cursor
                    const screenPos = camera.projectToScreen(pos, canvas.width, canvas.height);
                    const measurePoint: MeasurePoint = {
                      x: pos.x,
                      y: pos.y,
                      z: pos.z,
                      screenX: screenPos?.x ?? x,
                      screenY: screenPos?.y ?? y,
                    };

                    updateMeasurement(measurePoint);
                    setSnapTarget(result.snapTarget || null);

                    // Update edge lock state
                    if (result.edgeLock.shouldRelease) {
                      // Clear stale lock when release is signaled
                      clearEdgeLock();
                      updateSnapVisualization(result.snapTarget || null);
                    } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                      // Check if we're on the same edge to preserve lock strength (hysteresis)
                      // Also check reversed edge ordering (v0↔v1 swap)
                      const sameDirection = currentLock.edge &&
                        Math.abs(currentLock.edge.v0.x - result.edgeLock.edge.v0.x) < 0.0001 &&
                        Math.abs(currentLock.edge.v0.y - result.edgeLock.edge.v0.y) < 0.0001 &&
                        Math.abs(currentLock.edge.v0.z - result.edgeLock.edge.v0.z) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.x - result.edgeLock.edge.v1.x) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.y - result.edgeLock.edge.v1.y) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.z - result.edgeLock.edge.v1.z) < 0.0001;
                      const reversedDirection = currentLock.edge &&
                        Math.abs(currentLock.edge.v0.x - result.edgeLock.edge.v1.x) < 0.0001 &&
                        Math.abs(currentLock.edge.v0.y - result.edgeLock.edge.v1.y) < 0.0001 &&
                        Math.abs(currentLock.edge.v0.z - result.edgeLock.edge.v1.z) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.x - result.edgeLock.edge.v0.x) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.y - result.edgeLock.edge.v0.y) < 0.0001 &&
                        Math.abs(currentLock.edge.v1.z - result.edgeLock.edge.v0.z) < 0.0001;
                      const isSameEdge = currentLock.edge &&
                        currentLock.meshExpressId === result.edgeLock.meshExpressId &&
                        (sameDirection || reversedDirection);

                      if (isSameEdge) {
                        // Same edge - just update position and grow lock strength
                        updateEdgeLockPosition(result.edgeLock.edgeT, result.edgeLock.isCorner, result.edgeLock.cornerValence);
                        incrementEdgeLockStrength();
                      } else {
                        // New edge - reset lock state
                        setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId, result.edgeLock.edgeT);
                        updateEdgeLockPosition(result.edgeLock.edgeT, result.edgeLock.isCorner, result.edgeLock.cornerValence);
                      }
                      // Update visualization with edge lock info
                      updateSnapVisualization(result.snapTarget, {
                        edgeT: result.edgeLock.edgeT,
                        isCorner: result.edgeLock.isCorner,
                        cornerValence: result.edgeLock.cornerValence,
                      });
                    } else {
                      updateSnapVisualization(result.snapTarget || null);
                    }
                  }
                }
              });
            }

            // Mark as dragged (any movement counts for measure tool)
            mouseState.didDrag = true;
            return;
          }
        }

        // Handle measure tool hover preview (BEFORE dragging starts)
        // Show snap indicators to help user see where they can snap
        if (tool === 'measure' && !mouseState.isDragging && snapEnabledRef.current) {
          // Throttle hover snap detection more aggressively (100ms) to avoid performance issues
          // Active measurement still uses 60fps throttling via requestAnimationFrame
          const now = Date.now();
          if (now - lastHoverSnapTimeRef.current < HOVER_SNAP_THROTTLE_MS) {
            return; // Skip hover snap detection if throttled
          }
          lastHoverSnapTimeRef.current = now;

          // Throttle raycasting to avoid performance issues
          if (!measureRaycastPendingRef.current) {
            measureRaycastPendingRef.current = true;

            measureRaycastFrameRef.current = requestAnimationFrame(() => {
              measureRaycastPendingRef.current = false;
              measureRaycastFrameRef.current = null;

              // Use magnetic snap for hover preview
              const currentLock = edgeLockStateRef.current;
              const result = renderer.raycastSceneMagnetic(x, y, {
                edge: currentLock.edge,
                meshExpressId: currentLock.meshExpressId,
                lockStrength: currentLock.lockStrength,
              }, {
                hiddenIds: hiddenEntitiesRef.current,
                isolatedIds: isolatedEntitiesRef.current,
                snapOptions: {
                  snapToVertices: true,
                  snapToEdges: true,
                  snapToFaces: true,
                  screenSnapRadius: 40, // Good radius for hover snap detection
                },
              });

              // Update snap target for visual feedback
              if (result.snapTarget) {
                setSnapTarget(result.snapTarget);

                // Update edge lock state for hover
                if (result.edgeLock.shouldRelease) {
                  // Clear stale lock when release is signaled
                  clearEdgeLock();
                  updateSnapVisualization(result.snapTarget);
                } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                  setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId, result.edgeLock.edgeT);
                  updateSnapVisualization(result.snapTarget, {
                    edgeT: result.edgeLock.edgeT,
                    isCorner: result.edgeLock.isCorner,
                    cornerValence: result.edgeLock.cornerValence,
                  });
                } else {
                  updateSnapVisualization(result.snapTarget);
                }
              } else {
                setSnapTarget(null);
                clearEdgeLock();
                updateSnapVisualization(null);
              }
            });
          }
          return; // Don't fall through to other tool handlers
        }

        // Handle orbit/pan for other tools (or measure tool with shift+drag or no active measurement)
        if (mouseState.isDragging && (tool !== 'measure' || !activeMeasurementRef.current)) {
          const dx = e.clientX - mouseState.lastX;
          const dy = e.clientY - mouseState.lastY;

          // Check if this counts as a drag (moved more than 5px from start)
          const totalDx = e.clientX - mouseState.startX;
          const totalDy = e.clientY - mouseState.startY;
          if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
            mouseState.didDrag = true;
          }

          // Always update camera state immediately (feels responsive)
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

          // PERFORMANCE: Adaptive throttle based on model size
          // Small models: 60fps, Large: 40fps, Huge: 30fps
          const meshCount = geometryRef.current?.length ?? 0;
          const throttleMs = meshCount > 50000 ? RENDER_THROTTLE_MS_HUGE
            : meshCount > 10000 ? RENDER_THROTTLE_MS_LARGE
              : RENDER_THROTTLE_MS_SMALL;

          const now = performance.now();
          if (now - lastRenderTimeRef.current >= throttleMs) {
            lastRenderTimeRef.current = now;
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
            // Update ViewCube rotation in real-time during drag
            updateCameraRotationRealtime(camera.getRotation());
            calculateScale();
          } else if (!renderPendingRef.current) {
            // Schedule a final render for when throttle expires
            // This ensures we always render the final position
            renderPendingRef.current = true;
            requestAnimationFrame(() => {
              renderPendingRef.current = false;
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
            });
          }
          // Clear hover while dragging
          clearHover();
        } else if (hoverTooltipsEnabledRef.current) {
          // Hover detection (throttled) - only if tooltips are enabled
          const now = Date.now();
          if (now - lastHoverCheckRef.current > hoverThrottleMs) {
            lastHoverCheckRef.current = now;
            // Uses visibility filtering so hidden elements don't show hover tooltips
            const pickResult = await renderer.pick(x, y, getPickOptions());
            if (pickResult) {
              setHoverState({ entityId: pickResult.expressId, screenX: e.clientX, screenY: e.clientY });
            } else {
              clearHover();
            }
          }
        }
      });

      canvas.addEventListener('mouseup', () => {
        const tool = activeToolRef.current;

        // Handle measure tool completion
        if (tool === 'measure' && activeMeasurementRef.current) {
          finalizeMeasurement();
          clearEdgeLock(); // Clear edge lock after measurement complete
          mouseState.isDragging = false;
          mouseState.didDrag = false;
          canvas.style.cursor = 'crosshair';
          return;
        }

        mouseState.isDragging = false;
        mouseState.isPanning = false;
        canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'orbit' ? 'grab' : (tool === 'measure' ? 'crosshair' : 'default'));
        // Clear orbit pivot after each orbit operation
        camera.setOrbitPivot(null);
      });

      canvas.addEventListener('mouseleave', () => {
        const tool = activeToolRef.current;
        mouseState.isDragging = false;
        mouseState.isPanning = false;
        camera.stopInertia();
        camera.setOrbitPivot(null);
        // Restore cursor based on active tool
        if (tool === 'measure') {
          canvas.style.cursor = 'crosshair';
        } else if (tool === 'pan' || tool === 'orbit') {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'default';
        }
        clearHover();
      });

      canvas.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Uses visibility filtering so hidden elements don't appear in context menu
        const pickResult = await renderer.pick(x, y, getPickOptions());
        openContextMenu(pickResult?.expressId ?? null, e.clientX, e.clientY);
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
            selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
        // Update measurement screen coordinates immediately during zoom (only in measure mode)
        if (activeToolRef.current === 'measure') {
          const state = useViewerStore.getState();
          if (state.measurements.length > 0 || state.activeMeasurement) {
            updateMeasurementScreenCoords((worldPos) => {
              return camera.projectToScreen(worldPos, canvas.width, canvas.height);
            });
            // Update camera state tracking to prevent duplicate update in animation loop
            const cameraPos = camera.getPosition();
            const cameraRot = camera.getRotation();
            const cameraDist = camera.getDistance();
            lastCameraStateRef.current = {
              position: cameraPos,
              rotation: cameraRot,
              distance: cameraDist,
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
            };
          }
        }
        calculateScale();
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

        // Measure tool now uses drag interaction (see mousedown/mousemove/mouseup)
        if (tool === 'measure') {
          return; // Skip click handling for measure tool
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
          const pickResult = await renderer.pick(x, y, getPickOptions());
          if (pickResult) {
            handlePickForSelection(pickResult);
          }
          lastClickTimeRef.current = 0;
          lastClickPosRef.current = null;
        } else {
          // Single click - uses visibility filtering so only visible elements can be selected
          const pickResult = await renderer.pick(x, y, getPickOptions());

          // Multi-selection with Ctrl/Cmd
          if (e.ctrlKey || e.metaKey) {
            if (pickResult) {
              toggleSelection(pickResult.expressId);
            }
          } else {
            handlePickForSelection(pickResult);
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
            selectedModelIndex: selectedModelIndexRef.current,
            clearColor: clearColorRef.current,
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
            sectionPlane: activeToolRef.current === 'section' ? {
              ...sectionPlaneRef.current,
              min: sectionRangeRef.current?.min,
              max: sectionRangeRef.current?.max,
            } : undefined,
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
            selectedModelIndex: selectedModelIndexRef.current,
            clearColor: clearColorRef.current,
            sectionPlane: activeToolRef.current === 'section' ? {
              ...sectionPlaneRef.current,
              min: sectionRangeRef.current?.min,
              max: sectionRangeRef.current?.max,
            } : undefined,
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
            selectedModelIndex: selectedModelIndexRef.current,
          clearColor: clearColorRef.current,
          sectionPlane: activeToolRef.current === 'section' ? {
            ...sectionPlaneRef.current,
            min: sectionRangeRef.current?.min,
            max: sectionRangeRef.current?.max,
          } : undefined,
        });
      });
      resizeObserver.observe(canvas);

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
      // Cancel pending raycast requests
      if (measureRaycastFrameRef.current !== null) {
        cancelAnimationFrame(measureRaycastFrameRef.current);
        measureRaycastFrameRef.current = null;
      }
      setIsInitialized(false);
      rendererRef.current = null;
    };
    // Note: selectedEntityId is intentionally NOT in dependencies
    // The click handler captures setSelectedEntityId via closure
    // Adding selectedEntityId would destroy/recreate the renderer on every selection change
  }, [setSelectedEntityId]);

  // Track processed meshes for incremental updates
  // Uses string keys to support compound keys (expressId:color) for submeshes
  const processedMeshIdsRef = useRef<Set<string>>(new Set());
  const lastGeometryLengthRef = useRef<number>(0);
  const lastGeometryRef = useRef<MeshData[] | null>(null);
  const cameraFittedRef = useRef<boolean>(false);
  const finalBoundsRefittedRef = useRef<boolean>(false); // Track if we've refitted after streaming

  // Render throttling during streaming
  const lastStreamRenderTimeRef = useRef<number>(0);
  const STREAM_RENDER_THROTTLE_MS = 200; // Render at most every 200ms during streaming
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
      // Geometry cleared (could be visibility change or file unload)
      // Clear scene but DON'T reset camera - user may just be hiding models
      scene.clear();
      processedMeshIdsRef.current.clear();
      // Keep cameraFittedRef to preserve camera position when models are shown again
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = null;
      // Note: Don't reset camera or bounds - preserve user's view
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
      // Length changed but not incremental - could be:
      // 1. Length decreased (model hidden) - DON'T reset camera
      // 2. Length increased but lastLength > 0 (new file loaded while another was open) - DO reset
      const isLengthDecrease = currentLength < lastLength;

      if (isLengthDecrease) {
        // Model visibility changed (hidden) - rebuild scene but keep camera
        scene.clear();
        processedMeshIdsRef.current.clear();
        // Don't reset cameraFittedRef - keep current camera position
        lastGeometryLengthRef.current = 0; // Reset so meshes get re-added
        lastGeometryRef.current = geometry;
        // Note: Don't reset camera or bounds - user wants to keep their view
      } else {
        // New file loaded while another was open - full reset
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
      }
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
    // NOTE: Multiple meshes can share the same expressId AND same color (e.g., door inner framing pieces),
    // so we use expressId + array index as a compound key to ensure all submeshes are processed.
    const newMeshes: MeshData[] = [];
    const startIndex = isStreaming ? lastGeometryLengthRef.current : 0;
    for (let i = 0; i < meshesToAdd.length; i++) {
      const meshData = meshesToAdd[i];
      // Use expressId + global array index as key to ensure each mesh is unique
      // (same expressId can have multiple submeshes with same color, e.g., door framing)
      const globalIndex = startIndex + i;
      const compoundKey = `${meshData.expressId}:${globalIndex}`;

      if (!processedMeshIdsRef.current.has(compoundKey)) {
        newMeshes.push(meshData);
        processedMeshIdsRef.current.add(compoundKey);
      }
    }

    if (newMeshes.length > 0) {
      // Batch meshes by color for efficient rendering (reduces draw calls from N to ~100-500)
      // This dramatically improves performance for large models (50K+ meshes)
      const pipeline = renderer.getPipeline();
      if (pipeline) {
        // Use batched rendering - groups meshes by color into single draw calls
        // Pass isStreaming flag to enable throttled batch rebuilding (reduces O(N²) cost)
        (scene as any).appendToBatches(newMeshes, device, pipeline, isStreaming);

        // Note: addMeshData is now called inside appendToBatches, no need to duplicate
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

      // Invalidate caches when new geometry is added
      renderer.clearCaches();
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

    // Render throttling: During streaming, only render every STREAM_RENDER_THROTTLE_MS
    // This prevents rendering 28K+ meshes from blocking WASM batch processing
    const now = Date.now();
    const timeSinceLastRender = now - lastStreamRenderTimeRef.current;
    const shouldRender = !isStreaming || timeSinceLastRender >= STREAM_RENDER_THROTTLE_MS;

    if (shouldRender) {
      renderer.render();
      lastStreamRenderTimeRef.current = now;
    }
  }, [geometry, coordinateInfo, isInitialized, isStreaming]);

  // Force render when streaming completes (progress goes from <100% to 100% or null)
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    // If streaming just completed (was streaming, now not), rebuild pending batches and render
    if (prevIsStreamingRef.current && !isStreaming) {
      const device = renderer.getGPUDevice();
      const pipeline = renderer.getPipeline();
      const scene = renderer.getScene();

      // Rebuild any pending batches that were deferred during streaming
      if (device && pipeline && (scene as any).hasPendingBatches?.()) {
        (scene as any).rebuildPendingBatches(device, pipeline);
      }

      renderer.render();
      lastStreamRenderTimeRef.current = Date.now();
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, isInitialized]);

  // Apply pending color updates to WebGPU scene
  // Note: Color updates may arrive before viewport is initialized, so we wait
  useEffect(() => {
    if (!pendingColorUpdates || pendingColorUpdates.size === 0) return;

    // Wait until viewport is initialized before applying color updates
    if (!isInitialized) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const device = renderer.getGPUDevice();
    const pipeline = renderer.getPipeline();
    const scene = renderer.getScene();

    if (device && pipeline && (scene as any).updateMeshColors) {
      (scene as any).updateMeshColors(pendingColorUpdates, device, pipeline);
      renderer.render();
      clearPendingColorUpdates();
    }
  }, [pendingColorUpdates, isInitialized, clearPendingColorUpdates]);

  // Re-render when visibility, selection, or section plane changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    renderer.render({
      hiddenIds: hiddenEntities,
      isolatedIds: isolatedEntities,
      selectedId: selectedEntityId,
      selectedIds: selectedEntityIds,
      selectedModelIndex,
      clearColor: clearColorRef.current,
      sectionPlane: activeTool === 'section' ? {
        ...sectionPlane,
        min: sectionRange?.min,
        max: sectionRange?.max,
      } : undefined,
    });
  }, [hiddenEntities, isolatedEntities, selectedEntityId, selectedEntityIds, selectedModelIndex, isInitialized, sectionPlane, activeTool, sectionRange]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}

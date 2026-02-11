/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D viewport component
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Renderer } from '@ifc-lite/renderer';
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
  getThemeClearColor,
  type ViewportStateRefs,
} from '../../utils/viewportUtils.js';
import { setGlobalCanvasRef, setGlobalRendererRef, clearGlobalRefs } from '../../hooks/useBCF.js';

import { useMouseControls, type MouseState } from './useMouseControls.js';
import { useTouchControls, type TouchState } from './useTouchControls.js';
import { useKeyboardControls } from './useKeyboardControls.js';
import { useAnimationLoop } from './useAnimationLoop.js';
import { useGeometryStreaming } from './useGeometryStreaming.js';
import { useRenderUpdates } from './useRenderUpdates.js';

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
  const handlePickForSelection = useCallback((pickResult: import('@ifc-lite/renderer').PickResult | null) => {
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
  }, [setSelectedEntityId, setSelectedEntity, resolveGlobalIdFromModels, modelIndexToId]);

  // Ref to always access latest handlePickForSelection from event handlers
  // (useMouseControls/useTouchControls capture this at effect setup time)
  const handlePickForSelectionRef = useRef(handlePickForSelection);
  useEffect(() => { handlePickForSelectionRef.current = handlePickForSelection; }, [handlePickForSelection]);

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
    measurementConstraintEdge,
    setMeasurementConstraintEdge,
    updateConstraintActiveAxis,
  } = useMeasurementState();

  // Color update state
  const { pendingColorUpdates, clearPendingColorUpdates } = useColorUpdateState();

  // IFC data state
  const { ifcDataStore } = useIfcDataState();

  // Calculate section plane range based on actual geometry bounds for current axis
  const sectionRange = useMemo(() => {
    if (!coordinateInfo?.shiftedBounds) return null;

    const bounds = coordinateInfo.shiftedBounds;

    // Map semantic axis to coordinate axis
    const axisKey = sectionPlane.axis === 'side' ? 'x' : sectionPlane.axis === 'down' ? 'y' : 'z';

    const min = bounds.min[axisKey];
    const max = bounds.max[axisKey];

    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  }, [coordinateInfo, sectionPlane.axis]);

  // Theme-aware clear color ref (updated when theme changes)
  // Tokyo Night storm: #1a1b26 = rgb(26, 27, 38)
  const clearColorRef = useRef<[number, number, number, number]>([0.102, 0.106, 0.149, 1]);

  // Animation frame ref
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Mouse state
  const mouseStateRef = useRef<MouseState>({
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
  const touchStateRef = useRef<TouchState>({
    touches: [] as Touch[],
    lastDistance: 0,
    lastCenter: { x: 0, y: 0 },
    // Tap detection for mobile selection
    tapStartTime: 0,
    tapStartPos: { x: 0, y: 0 },
    didMove: false,
    // Track if multi-touch occurred (prevents false tap-select after pinch/zoom)
    multiTouch: false,
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

  // Coordinate info ref for camera callbacks (to access latest buildingRotation)
  const coordinateInfoRef = useRef<CoordinateInfo | undefined>(coordinateInfo);

  // Visibility state refs for animation loop
  const hiddenEntitiesRef = useRef<Set<number>>(hiddenEntities);
  const isolatedEntitiesRef = useRef<Set<number> | null>(isolatedEntities);
  const selectedEntityIdRef = useRef<number | null>(selectedEntityId);
  const selectedEntityIdsRef = useRef<Set<number> | undefined>(selectedEntityIds);
  const selectedModelIndexRef = useRef<number | undefined>(selectedModelIndex);
  const activeToolRef = useRef<string>(activeTool);
  const pendingMeasurePointRef = useRef<MeasurePoint | null>(pendingMeasurePoint);
  const activeMeasurementRef = useRef(activeMeasurement);
  const snapEnabledRef = useRef(snapEnabled);
  const edgeLockStateRef = useRef(edgeLockState);
  const measurementConstraintEdgeRef = useRef(measurementConstraintEdge);
  const sectionPlaneRef = useRef(sectionPlane);
  const sectionRangeRef = useRef<{ min: number; max: number } | null>(null);
  const geometryRef = useRef<MeshData[] | null>(geometry);

  // Hover throttling
  const lastHoverCheckRef = useRef<number>(0);
  const hoverThrottleMs = 50; // Check hover every 50ms
  const hoverTooltipsEnabledRef = useRef(hoverTooltipsEnabled);

  // Measure tool throttling (adaptive based on raycast performance)
  const measureRaycastPendingRef = useRef(false);
  const measureRaycastFrameRef = useRef<number | null>(null);
  const lastMeasureRaycastDurationRef = useRef<number>(0);
  // Hover-only snap detection throttling (100ms = 10fps max for hover, 60fps for active measurement)
  const lastHoverSnapTimeRef = useRef<number>(0);
  const HOVER_SNAP_THROTTLE_MS = 100;
  // Skip visualization updates if raycast was slow (prevents UI freezes)
  const SLOW_RAYCAST_THRESHOLD_MS = 50;

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
  useEffect(() => { coordinateInfoRef.current = coordinateInfo; }, [coordinateInfo]);
  useEffect(() => { hiddenEntitiesRef.current = hiddenEntities; }, [hiddenEntities]);
  useEffect(() => { isolatedEntitiesRef.current = isolatedEntities; }, [isolatedEntities]);
  useEffect(() => { selectedEntityIdRef.current = selectedEntityId; }, [selectedEntityId]);
  useEffect(() => { selectedEntityIdsRef.current = selectedEntityIds; }, [selectedEntityIds]);
  useEffect(() => { selectedModelIndexRef.current = selectedModelIndex; }, [selectedModelIndex]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { pendingMeasurePointRef.current = pendingMeasurePoint; }, [pendingMeasurePoint]);
  useEffect(() => { activeMeasurementRef.current = activeMeasurement; }, [activeMeasurement]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);
  useEffect(() => { edgeLockStateRef.current = edgeLockState; }, [edgeLockState]);
  useEffect(() => { measurementConstraintEdgeRef.current = measurementConstraintEdge; }, [measurementConstraintEdge]);
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

  // Helper: calculate scale bar value (world-space size for 96px scale bar)
  const calculateScale = () => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const camera = renderer.getCamera();
    const viewportHeight = canvas.height;
    const scaleBarPixels = 96; // w-24 = 6rem = 96px

    let worldSize: number;
    if (camera.getProjectionMode() === 'orthographic') {
      // Orthographic: orthoSize is half-height in world units, so full height = orthoSize * 2
      worldSize = (scaleBarPixels / viewportHeight) * (camera.getOrthoSize() * 2);
    } else {
      const distance = camera.getDistance();
      const fov = camera.getFOV();
      // Calculate world-space size: (screen pixels / viewport height) * (distance * tan(FOV/2) * 2)
      worldSize = (scaleBarPixels / viewportHeight) * (distance * Math.tan(fov / 2) * 2);
    }
    updateScaleRealtime(worldSize);
  };

  // Helper: get pick options with visibility filtering
  const getPickOptions = () => {
    const currentProgress = useViewerStore.getState().progress;
    const currentIsStreaming = currentProgress !== null && currentProgress.percent < 100;
    return {
      isStreaming: currentIsStreaming,
      hiddenIds: hiddenEntitiesRef.current,
      isolatedIds: isolatedEntitiesRef.current,
    };
  };

  // Helper: check if there are pending measurements
  const hasPendingMeasurements = () => {
    const state = useViewerStore.getState();
    return state.measurements.length > 0 || state.activeMeasurement !== null;
  };

  // ===== Renderer initialization =====
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsInitialized(false);

    let aborted = false;
    let resizeObserver: ResizeObserver | null = null;

    // Helper to align canvas dimensions to WebGPU requirements
    // WebGPU texture row pitch must be aligned to 256 bytes
    // For RGBA (4 bytes/pixel), width should be multiple of 64 pixels
    const alignToWebGPU = (size: number): number => {
      return Math.max(64, Math.floor(size / 64) * 64);
    };

    const rect = canvas.getBoundingClientRect();
    const width = alignToWebGPU(Math.max(1, Math.floor(rect.width)));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;

    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    // Register refs for BCF hook access (snapshot capture, camera control)
    setGlobalCanvasRef(canvasRef);
    setGlobalRendererRef(rendererRef);

    renderer.init().then(() => {
      if (aborted) return;

      setIsInitialized(true);

      const camera = renderer.getCamera();

      // Register camera callbacks for ViewCube and other controls
      setCameraCallbacks({
        setPresetView: (view) => {
          // Pass actual geometry bounds to avoid distance drift
          const rotation = coordinateInfoRef.current?.buildingRotation;
          camera.setPresetView(view, geometryBoundsRef.current, rotation);
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
          const c = canvasRef.current;
          if (!c) return null;
          return camera.projectToScreen(worldPos, c.width, c.height);
        },
        setProjectionMode: (mode) => {
          camera.setProjectionMode(mode);
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
        toggleProjectionMode: () => {
          camera.toggleProjectionMode();
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
        getProjectionMode: () => camera.getProjectionMode(),
      });

      // ResizeObserver
      resizeObserver = new ResizeObserver(() => {
        if (aborted) return;
        const rect = canvas.getBoundingClientRect();
        // Use same WebGPU alignment as initialization
        const w = alignToWebGPU(Math.max(1, Math.floor(rect.width)));
        const h = Math.max(1, Math.floor(rect.height));
        renderer.resize(w, h);
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

      // Initial render
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
      setIsInitialized(false);
      rendererRef.current = null;
      // Clear BCF global refs to prevent memory leaks
      clearGlobalRefs();
    };
    // Note: selectedEntityId is intentionally NOT in dependencies
    // The click handler captures setSelectedEntityId via closure
    // Adding selectedEntityId would destroy/recreate the renderer on every selection change
  }, [setSelectedEntityId]);

  // ===== Drawing 2D state for render updates =====
  const drawing2D = useViewerStore((s) => s.drawing2D);
  const show3DOverlay = useViewerStore((s) => s.drawing2DDisplayOptions.show3DOverlay);

  // ===== Streaming progress =====
  const progress = useViewerStore((state) => state.progress);
  const isStreaming = progress !== null && progress.percent < 100;

  // Mouse isDragging proxy ref for animation loop
  // The animation loop reads this to decide whether to update rotation
  // We wrap mouseStateRef to provide a { current: boolean } interface
  const mouseIsDraggingRef = useRef(false);
  // Sync on every render since mouseState is mutated directly by event handlers
  mouseIsDraggingRef.current = mouseStateRef.current.isDragging;

  // ===== Extracted hooks =====
  useMouseControls({
    canvasRef,
    rendererRef,
    isInitialized,
    mouseStateRef,
    activeToolRef,
    activeMeasurementRef,
    snapEnabledRef,
    edgeLockStateRef,
    measurementConstraintEdgeRef,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    clearColorRef,
    sectionPlaneRef,
    sectionRangeRef,
    geometryRef,
    measureRaycastPendingRef,
    measureRaycastFrameRef,
    lastMeasureRaycastDurationRef,
    lastHoverSnapTimeRef,
    lastHoverCheckRef,
    hoverTooltipsEnabledRef,
    lastRenderTimeRef,
    renderPendingRef,
    lastClickTimeRef,
    lastClickPosRef,
    lastCameraStateRef,
    handlePickForSelection: (pickResult) => handlePickForSelectionRef.current(pickResult),
    setHoverState,
    clearHover,
    openContextMenu,
    startMeasurement,
    updateMeasurement,
    finalizeMeasurement,
    setSnapTarget,
    setSnapVisualization,
    setEdgeLock,
    updateEdgeLockPosition,
    clearEdgeLock,
    incrementEdgeLockStrength,
    setMeasurementConstraintEdge,
    updateConstraintActiveAxis,
    updateMeasurementScreenCoords,
    updateCameraRotationRealtime,
    toggleSelection,
    calculateScale,
    getPickOptions,
    hasPendingMeasurements,
    HOVER_SNAP_THROTTLE_MS,
    SLOW_RAYCAST_THRESHOLD_MS,
    hoverThrottleMs,
    RENDER_THROTTLE_MS_SMALL,
    RENDER_THROTTLE_MS_LARGE,
    RENDER_THROTTLE_MS_HUGE,
  });

  useTouchControls({
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
    handlePickForSelection: (pickResult) => handlePickForSelectionRef.current(pickResult),
    getPickOptions,
  });

  useKeyboardControls({
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
  });

  useAnimationLoop({
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
    sectionPlaneRef,
    sectionRangeRef,
    lastCameraStateRef,
    updateCameraRotationRealtime,
    calculateScale,
    updateMeasurementScreenCoords,
    hasPendingMeasurements,
  });

  useGeometryStreaming({
    rendererRef,
    isInitialized,
    geometry,
    coordinateInfo,
    isStreaming,
    geometryBoundsRef,
    pendingColorUpdates,
    clearPendingColorUpdates,
  });

  useRenderUpdates({
    rendererRef,
    isInitialized,
    theme,
    clearColorRef,
    hiddenEntities,
    isolatedEntities,
    selectedEntityId,
    selectedEntityIds,
    selectedModelIndex,
    activeTool,
    sectionPlane,
    sectionRange,
    coordinateInfo,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    selectedEntityIdsRef,
    sectionPlaneRef,
    sectionRangeRef,
    activeToolRef,
    drawing2D,
    show3DOverlay,
  });

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}

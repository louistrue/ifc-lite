/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D viewport component
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Renderer, type VisualEnhancementOptions } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { useViewerStore, resolveEntityRef, type MeasurePoint, type SnapVisualization } from '@/store';
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
import { useLatestRef } from '../../hooks/useLatestRef.js';
import {
  getEntityBounds,
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
  /** Monotonic counter that increments when geometry changes — used to trigger
   *  streaming effects even when the geometry array reference is stable. */
  geometryVersion?: number;
  coordinateInfo?: CoordinateInfo;
  computedIsolatedIds?: Set<number> | null;
  modelIdToIndex?: Map<string, number>;
  /** When true, the WebGPU canvas uses a transparent clear color so the
   *  CesiumJS globe behind it is visible. */
  cesiumActive?: boolean;
  releaseGeometryAfterStream?: boolean;
  onGeometryReleased?: () => void;
}

export function Viewport({
  geometry,
  geometryVersion,
  coordinateInfo,
  computedIsolatedIds,
  modelIdToIndex,
  cesiumActive,
  releaseGeometryAfterStream = false,
  onGeometryReleased,
}: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [mobileDebug, setMobileDebug] = useState<string>('');
  const mobileDebugRef = useRef<string[]>([]);

  const focusViewportForKeyboardShortcuts = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== canvas) {
      const isEditable =
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable;

      if (isEditable) {
        activeElement.blur();
      }
    }

    if (document.activeElement !== canvas) {
      canvas.focus({ preventScroll: true });
    }
  }, []);

  // Selection state
  const { selectedEntityId, selectedEntityIds, setSelectedEntityId, setSelectedEntity, toggleSelection, models } = useSelectionState();
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  const addEntityToSelection = useViewerStore((s) => s.addEntityToSelection);
  const toggleEntitySelection = useViewerStore((s) => s.toggleEntitySelection);

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
  const selectedModelIndex = models.size > 1 && selectedEntity && modelIdToIndex
    ? modelIdToIndex.get(selectedEntity.modelId) ?? undefined
    : undefined;

  // Helper to handle pick result and set selection properly
  // IMPORTANT: pickResult.expressId is now a globalId (transformed at load time)
  // resolveEntityRef is the single source of truth for globalId → EntityRef
  const handlePickForSelection = useCallback((pickResult: import('@ifc-lite/renderer').PickResult | null) => {
    // Normal click clears multi-select set (fresh single-selection)
    const currentState = useViewerStore.getState();
    if (currentState.selectedEntitiesSet.size > 0) {
      useViewerStore.setState({ selectedEntitiesSet: new Set(), selectedEntityIds: new Set() });
    }

    if (!pickResult) {
      setSelectedEntityId(null);
      return;
    }

    const globalId = pickResult.expressId;
    const resolvedRef = resolveEntityRef(globalId);

    // Set globalId for renderer (highlighting uses globalIds directly)
    setSelectedEntityId(globalId);

    // Resolve globalId → EntityRef for property panel (single source of truth, never null)
    setSelectedEntity(resolvedRef);
  }, [setSelectedEntityId, setSelectedEntity]);

  // Ref to always access latest handlePickForSelection from event handlers
  // (useMouseControls/useTouchControls capture this at effect setup time)
  const handlePickForSelectionRef = useRef(handlePickForSelection);
  useEffect(() => { handlePickForSelectionRef.current = handlePickForSelection; }, [handlePickForSelection]);

  // Orbit pivot is now set dynamically at the start of each orbit drag by
  // raycasting under the cursor (see useMouseControls/useTouchControls).
  // No need for selection-based orbit center — cursor-based is always better.

  // Multi-select handler: Ctrl+Click adds/removes from multi-selection
  // Properly populates both selectedEntitiesSet (multi-model) and selectedEntityIds (legacy)
  const handleMultiSelect = useCallback((globalId: number) => {
    // Resolve globalId → EntityRef (single source of truth, never null)
    const entityRef = resolveEntityRef(globalId);

    // If this is the first Ctrl+click and there's already a single-selected entity,
    // add it to the multi-select set first (so it's not lost)
    const state = useViewerStore.getState();
    if (state.selectedEntitiesSet.size === 0 && state.selectedEntity) {
      addEntityToSelection(state.selectedEntity);
      // Also seed legacy selectedEntityIds with previous entity's globalId
      // so the renderer highlights both the old and new entity
      if (state.selectedEntityId !== null) {
        toggleSelection(state.selectedEntityId);
      }
    }

    // Toggle the clicked entity in multi-select
    toggleEntitySelection(entityRef);

    // Also sync legacy selectedEntityIds and selectedEntityId
    toggleSelection(globalId);

    // Read post-toggle state to keep renderer highlighting in sync:
    // If the entity was toggled OFF, don't force-highlight it.
    const updated = useViewerStore.getState();
    if (updated.selectedEntityIds.has(globalId)) {
      // Entity was toggled ON — highlight it
      setSelectedEntityId(globalId);
    } else if (updated.selectedEntityIds.size > 0) {
      // Entity was toggled OFF but others remain — highlight the last remaining
      const remaining = Array.from(updated.selectedEntityIds);
      setSelectedEntityId(remaining[remaining.length - 1]);
    } else {
      // Nothing left selected
      setSelectedEntityId(null);
    }
  }, [addEntityToSelection, toggleEntitySelection, toggleSelection, setSelectedEntityId]);

  const handleMultiSelectRef = useRef(handleMultiSelect);
  useEffect(() => { handleMultiSelectRef.current = handleMultiSelect; }, [handleMultiSelect]);

  // Visibility state - use computedIsolatedIds from parent (includes storey selection)
  // Fall back to store isolation if computedIsolatedIds is not provided
  const { hiddenEntities, isolatedEntities: storeIsolatedEntities } = useVisibilityState();
  const isolatedEntities = computedIsolatedIds ?? storeIsolatedEntities ?? null;

  // Tool state
  const { activeTool, sectionPlane } = useToolState();

  // Camera state
  const { updateCameraRotationRealtime, updateScaleRealtime, setCameraCallbacks } = useCameraState();

  // Theme state
  const {
    theme,
    isMobile,
    visualEnhancementsEnabled,
    edgeContrastEnabled,
    edgeContrastIntensity,
    contactShadingQuality,
    contactShadingIntensity,
    contactShadingRadius,
    separationLinesEnabled,
    separationLinesQuality,
    separationLinesIntensity,
    separationLinesRadius,
  } = useThemeState();

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
  const {
    pendingColorUpdates,
    pendingMeshColorUpdates,
    clearPendingColorUpdates,
    clearPendingMeshColorUpdates,
  } = useColorUpdateState();

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
  const visualEnhancement = useMemo<VisualEnhancementOptions>(() => ({
    enabled: isMobile ? false : visualEnhancementsEnabled,
    edgeContrast: {
      enabled: isMobile ? false : edgeContrastEnabled,
      intensity: edgeContrastIntensity,
    },
    contactShading: {
      quality: isMobile ? 'off' : contactShadingQuality,
      intensity: contactShadingIntensity,
      radius: contactShadingRadius,
    },
    separationLines: {
      enabled: isMobile ? false : separationLinesEnabled,
      quality: isMobile ? 'low' : separationLinesQuality,
      intensity: isMobile ? Math.min(0.4, separationLinesIntensity) : separationLinesIntensity,
      radius: isMobile ? 1.0 : separationLinesRadius,
    },
  }), [
    visualEnhancementsEnabled,
    edgeContrastEnabled,
    edgeContrastIntensity,
    isMobile,
    contactShadingQuality,
    contactShadingIntensity,
    contactShadingRadius,
    separationLinesEnabled,
    separationLinesQuality,
    separationLinesIntensity,
    separationLinesRadius,
  ]);

  // Override clear color when Cesium overlay is active (transparent background)
  useEffect(() => {
    if (cesiumActive) {
      clearColorRef.current = [0, 0, 0, 0]; // fully transparent
    } else {
      clearColorRef.current = getThemeClearColor(theme as 'light' | 'dark');
    }
    rendererRef.current?.requestRender();
  }, [cesiumActive, theme]);

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

  // Refs that stay in sync with props/state automatically (no useEffect needed).
  // Event handlers and the animation loop read .current to get the latest value.
  const coordinateInfoRef = useLatestRef(coordinateInfo);
  const hiddenEntitiesRef = useLatestRef(hiddenEntities);
  const isolatedEntitiesRef = useLatestRef(isolatedEntities);
  const selectedEntityIdRef = useLatestRef(selectedEntityId);
  const selectedEntityIdsRef = useLatestRef(selectedEntityIds);
  const selectedModelIndexRef = useLatestRef(selectedModelIndex);
  const activeToolRef = useRef<string>(activeTool);
  const pendingMeasurePointRef = useLatestRef(pendingMeasurePoint);
  const activeMeasurementRef = useLatestRef(activeMeasurement);
  const snapEnabledRef = useLatestRef(snapEnabled);
  const edgeLockStateRef = useLatestRef(edgeLockState);
  const measurementConstraintEdgeRef = useLatestRef(measurementConstraintEdge);
  const sectionPlaneRef = useLatestRef(sectionPlane);
  const sectionRangeRef = useLatestRef(sectionRange);
  const visualEnhancementRef = useLatestRef(visualEnhancement);

  // Terrain clip Y from Cesium store (read as ref for animation loop)
  const cesiumTerrainClipY = useViewerStore((s) => s.cesiumTerrainClipY);
  const fastZoomRef = useLatestRef(!!cesiumActive);
  const terrainClipYRef = useLatestRef(cesiumActive ? cesiumTerrainClipY : null);
  const geometryRef = useLatestRef(geometry);

  // Hover throttling
  const lastHoverCheckRef = useRef<number>(0);
  const hoverThrottleMs = 50; // Check hover every 50ms
  const hoverTooltipsEnabledRef = useLatestRef(hoverTooltipsEnabled);

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

  // activeTool has a side effect (first-person mode), so keep as useEffect
  useEffect(() => {
    activeToolRef.current = activeTool;
    const renderer = rendererRef.current;
    if (renderer) {
      const isWalk = activeTool === 'walk';
      firstPersonModeRef.current = isWalk;
      renderer.getCamera().enableFirstPersonMode(isWalk);
    }
  }, [activeTool]);
  useEffect(() => {
    if (!hoverTooltipsEnabled) {
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
    const currentState = useViewerStore.getState();
    const currentProgress = currentState.progress;
    const currentIsStreaming = currentState.geometryStreamingActive
      || (currentProgress !== null && currentProgress.percent < 100);
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
    setInitError(null);

    let aborted = false;
    let resizeObserver: ResizeObserver | null = null;

    // Helper to align canvas dimensions to WebGPU requirements
    // WebGPU texture row pitch must be aligned to 256 bytes
    // For RGBA (4 bytes/pixel), width should be multiple of 64 pixels
    const alignToWebGPU = (size: number): number => {
      return Math.max(64, Math.floor(size / 64) * 64);
    };

    // Use CSS pixel dimensions for canvas. The Renderer.render() method manages
    // its own dimension alignment via getBoundingClientRect() — do NOT apply DPR
    // here as it creates a mismatch that causes constant context reconfiguration.
    const rect = canvas.getBoundingClientRect();
    const width = alignToWebGPU(Math.max(1, Math.floor(rect.width)));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;

    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    // Mobile diagnostic helper
    const isMobileDev = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const dbg = (msg: string) => {
      console.log(`[Viewport] ${msg}`);
      if (isMobileDev) {
        mobileDebugRef.current = [...mobileDebugRef.current.slice(-8), msg];
        setMobileDebug(mobileDebugRef.current.join('\n'));
      }
    };
    dbg(`canvas ${width}x${height} dpr=${window.devicePixelRatio}`);

    // Register refs for BCF hook access (snapshot capture, camera control)
    setGlobalCanvasRef(canvasRef);
    setGlobalRendererRef(rendererRef);

    renderer.init().then(() => {
      if (aborted) return;
      dbg(`init OK pipeline=${!!renderer.getPipeline()} scene=${!!renderer.getScene()}`);

      setIsInitialized(true);

      const camera = renderer.getCamera();
      const renderCurrent = () => {
        renderer.requestRender();
      };

      // Register camera callbacks for ViewCube and other controls
      setCameraCallbacks({
        setPresetView: (view) => {
          // Pass actual geometry bounds to avoid distance drift
          const rotation = coordinateInfoRef.current?.buildingRotation;
          camera.setPresetView(view, geometryBoundsRef.current, rotation);
          // Initial render - animation loop will continue rendering during animation
          renderCurrent();
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
          renderCurrent();
          calculateScale();
        },
        zoomOut: () => {
          camera.zoom(50, false);
          renderCurrent();
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
          renderCurrent();
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
          renderCurrent();
          calculateScale();
        },
        toggleProjectionMode: () => {
          camera.toggleProjectionMode();
          renderCurrent();
          calculateScale();
        },
        getProjectionMode: () => camera.getProjectionMode(),
        getViewpoint: () => ({
          position: camera.getPosition(),
          target: camera.getTarget(),
          up: camera.getUp(),
          fov: camera.getFOV(),
          projectionMode: camera.getProjectionMode(),
          orthoSize: camera.getProjectionMode() === 'orthographic' ? camera.getOrthoSize() : undefined,
        }),
        applyViewpoint: (viewpoint, animate = true, durationMs = 300) => {
          camera.setProjectionMode(viewpoint.projectionMode);
          useViewerStore.setState({ projectionMode: viewpoint.projectionMode });
          camera.setFOV(viewpoint.fov);
          if (
            viewpoint.projectionMode === 'orthographic' &&
            typeof viewpoint.orthoSize === 'number' &&
            Number.isFinite(viewpoint.orthoSize)
          ) {
            camera.setOrthoSize(viewpoint.orthoSize);
          }

          if (animate) {
            camera.animateToWithUp(viewpoint.position, viewpoint.target, viewpoint.up, durationMs);
          } else {
            camera.setPosition(viewpoint.position.x, viewpoint.position.y, viewpoint.position.z);
            camera.setTarget(viewpoint.target.x, viewpoint.target.y, viewpoint.target.z);
            camera.setUp(viewpoint.up.x, viewpoint.up.y, viewpoint.up.z);
          }

          renderCurrent();
          updateCameraRotationRealtime(camera.getRotation());
          calculateScale();
        },
      });

      // ResizeObserver — let renderer handle its own dimension alignment
      resizeObserver = new ResizeObserver(() => {
        if (aborted) return;
        const rect = canvas.getBoundingClientRect();
        const w = alignToWebGPU(Math.max(1, Math.floor(rect.width)));
        const h = Math.max(1, Math.floor(rect.height));
        renderer.resize(w, h);
        renderCurrent();
      });
      resizeObserver.observe(canvas);

      // Initial render
      renderCurrent();
    }).catch((err) => {
      if (aborted) return;
      const message = err instanceof Error ? err.message : 'Failed to initialize 3D renderer';
      console.error('[Viewport] Renderer init failed:', message);
      dbg(`INIT FAIL: ${message}`);
      setInitError(message);
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

  // ===== Mobile diagnostics: track geometry & scene state =====
  useEffect(() => {
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    const renderer = rendererRef.current;
    const meshCount = geometry?.length ?? 0;
    const batches = renderer?.getScene()?.getBatchedMeshes()?.length ?? -1;
    const queued = renderer?.getScene()?.hasQueuedMeshes() ?? false;
    const diag = renderer?.getDiagnostics?.();
    const msg = `geom=${meshCount} v=${geometryVersion ?? '?'} batches=${batches} q=${queued} init=${isInitialized}` +
      (diag ? `\nrender: ${diag.calls}ok ${diag.skips}skip ${diag.errors}err` : '') +
      (diag?.lastError ? `\nerr: ${diag.lastError.slice(0, 60)}` : '');
    mobileDebugRef.current = [...mobileDebugRef.current.slice(-6), msg];
    setMobileDebug(mobileDebugRef.current.join('\n'));
  }, [geometry, geometryVersion, isInitialized]);

  // Periodic render-stats refresh on mobile (every 2s)
  useEffect(() => {
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    const id = setInterval(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const diag = renderer.getDiagnostics?.();
      if (!diag) return;
      const lines = [
        `r=${diag.calls} s=${diag.skips} e=${diag.errors} b=${diag.batches} gpu_err=${diag.gpuErrors}`,
        `cam=${diag.camPos} tgt=${diag.camTgt}`,
        `bounds=${diag.bounds}`,
      ];
      if (diag.lastGpuError) lines.push(`GPU: ${diag.lastGpuError.slice(0, 50)}`);
      if (diag.lastError) lines.push(`ERR: ${diag.lastError.slice(0, 50)}`);
      mobileDebugRef.current = lines;
      setMobileDebug(lines.join('\n'));
    }, 2000);
    return () => clearInterval(id);
  }, [isInitialized]);

  // ===== Drawing 2D state for render updates =====
  const drawing2D = useViewerStore((s) => s.drawing2D);
  const show3DOverlay = useViewerStore((s) => s.drawing2DDisplayOptions.show3DOverlay);
  const showHiddenLines = useViewerStore((s) => s.drawing2DDisplayOptions.showHiddenLines);

  // ===== Streaming progress =====
  const isStreaming = useViewerStore((state) => state.geometryStreamingActive);

  // Mouse isDragging proxy ref for animation loop
  // The animation loop reads this to decide whether to update rotation
  // We wrap mouseStateRef to provide a { current: boolean } interface
  const mouseIsDraggingRef = useRef(false);
  // Sync on every render since mouseState is mutated directly by event handlers
  mouseIsDraggingRef.current = mouseStateRef.current.isDragging;

  // isInteracting: set by mouse/touch controls during drag, cleared on mouseup/touchend.
  // The animation loop reads this to skip post-processing during rapid camera movement.
  const isInteractingRef = useRef(false);

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
    isInteractingRef,
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
    toggleSelection: (entityId: number) => handleMultiSelectRef.current(entityId),
    calculateScale,
    getPickOptions,
    hasPendingMeasurements,
    HOVER_SNAP_THROTTLE_MS,
    SLOW_RAYCAST_THRESHOLD_MS,
    hoverThrottleMs,
    RENDER_THROTTLE_MS_SMALL,
    RENDER_THROTTLE_MS_LARGE,
    RENDER_THROTTLE_MS_HUGE,
    fastZoomRef,
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
    isInteractingRef,
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
    terrainClipYRef,
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    clearColorRef,
    sectionPlaneRef,
    sectionRangeRef,
    visualEnhancementRef,
    selectedEntityIdsRef,
    coordinateInfoRef,
    isInteractingRef,
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
    geometryVersion,
    coordinateInfo,
    isStreaming,
    geometryBoundsRef,
    pendingColorUpdates,
    pendingMeshColorUpdates,
    clearPendingColorUpdates,
    clearPendingMeshColorUpdates,
    clearColorRef,
    releaseGeometryAfterFinalize: releaseGeometryAfterStream,
    onGeometryReleased,
  });

  useRenderUpdates({
    rendererRef,
    isInitialized,
    theme,
    clearColorRef,
    visualEnhancementRef,
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
    showHiddenLines,
  });

  // Hide WebGPU canvas immediately when Cesium is active.
  // The model will be rendered by Cesium (as GLB) for correct positioning.
  // Canvas stays in the DOM for picking/interaction.

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        data-viewport="main"
        tabIndex={-1}
        className={`w-full h-full block ${cesiumActive ? 'relative z-[1]' : ''}`}
        style={{
          touchAction: 'none',        /* Prevent browser touch gestures on 3D viewport */
          ...(cesiumActive ? { opacity: 0 } : undefined),
        }}
        onPointerDown={focusViewportForKeyboardShortcuts}
      />
      {initError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 z-50 p-4">
          <div className="text-center max-w-sm space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <p className="font-semibold text-sm">3D Rendering Failed</p>
            <p className="text-xs text-muted-foreground">{initError}</p>
            <p className="text-xs text-muted-foreground">
              Try using Chrome 113+, Edge 113+, or Safari 18+ with WebGPU support.
            </p>
          </div>
        </div>
      )}
      {/* Mobile debug overlay — temporary diagnostic */}
      {mobileDebug && (
        <div className="absolute top-1 left-1 z-[100] bg-black/80 text-[9px] text-green-400 font-mono p-1.5 rounded max-w-[60vw] pointer-events-none whitespace-pre leading-tight">
          {mobileDebug}
        </div>
      )}
    </div>
  );
}

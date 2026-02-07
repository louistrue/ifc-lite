/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mouse controls hook for the 3D viewport
 * Handles mouse event handlers (orbit, pan, select, measure, context menu)
 */

import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { Renderer, PickResult, SnapTarget } from '@ifc-lite/renderer';
import type { MeshData } from '@ifc-lite/geometry';
import type {
  MeasurePoint,
  SnapVisualization,
  ActiveMeasurement,
  EdgeLockState,
  SectionPlane,
} from '@/store';
import type { MeasurementConstraintEdge, OrthogonalAxis } from '@/store/types.js';
import { getEntityCenter } from '../../utils/viewportUtils.js';

export interface MouseState {
  isDragging: boolean;
  isPanning: boolean;
  lastX: number;
  lastY: number;
  button: number;
  startX: number;
  startY: number;
  didDrag: boolean;
}

export interface UseMouseControlsParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;

  // Mouse state
  mouseStateRef: MutableRefObject<MouseState>;

  // Tool/state refs
  activeToolRef: MutableRefObject<string>;
  activeMeasurementRef: MutableRefObject<ActiveMeasurement | null>;
  snapEnabledRef: MutableRefObject<boolean>;
  edgeLockStateRef: MutableRefObject<EdgeLockState>;
  measurementConstraintEdgeRef: MutableRefObject<MeasurementConstraintEdge | null>;

  // Visibility/selection refs
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  clearColorRef: MutableRefObject<[number, number, number, number]>;

  // Section/geometry refs
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  geometryRef: MutableRefObject<MeshData[] | null>;

  // Measure raycast refs
  measureRaycastPendingRef: MutableRefObject<boolean>;
  measureRaycastFrameRef: MutableRefObject<number | null>;
  lastMeasureRaycastDurationRef: MutableRefObject<number>;
  lastHoverSnapTimeRef: MutableRefObject<number>;

  // Hover refs
  lastHoverCheckRef: MutableRefObject<number>;
  hoverTooltipsEnabledRef: MutableRefObject<boolean>;

  // Render throttle refs
  lastRenderTimeRef: MutableRefObject<number>;
  renderPendingRef: MutableRefObject<boolean>;

  // Click detection refs
  lastClickTimeRef: MutableRefObject<number>;
  lastClickPosRef: MutableRefObject<{ x: number; y: number } | null>;

  // Camera tracking
  lastCameraStateRef: MutableRefObject<{
    position: { x: number; y: number; z: number };
    rotation: { azimuth: number; elevation: number };
    distance: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null>;

  // Callbacks
  handlePickForSelection: (pickResult: PickResult | null) => void;
  setHoverState: (state: { entityId: number; screenX: number; screenY: number }) => void;
  clearHover: () => void;
  openContextMenu: (entityId: number | null, screenX: number, screenY: number) => void;
  startMeasurement: (point: MeasurePoint) => void;
  updateMeasurement: (point: MeasurePoint) => void;
  finalizeMeasurement: () => void;
  setSnapTarget: (target: SnapTarget | null) => void;
  setSnapVisualization: (viz: Partial<SnapVisualization> | null) => void;
  setEdgeLock: (edge: { v0: { x: number; y: number; z: number }; v1: { x: number; y: number; z: number } }, meshExpressId: number, edgeT: number) => void;
  updateEdgeLockPosition: (edgeT: number, isCorner: boolean, cornerValence: number) => void;
  clearEdgeLock: () => void;
  incrementEdgeLockStrength: () => void;
  setMeasurementConstraintEdge: (edge: MeasurementConstraintEdge) => void;
  updateConstraintActiveAxis: (axis: OrthogonalAxis | null) => void;
  updateMeasurementScreenCoords: (projector: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null) => void;
  updateCameraRotationRealtime: (rotation: { azimuth: number; elevation: number }) => void;
  toggleSelection: (entityId: number) => void;
  calculateScale: () => void;
  getPickOptions: () => { isStreaming: boolean; hiddenIds: Set<number>; isolatedIds: Set<number> | null };
  hasPendingMeasurements: () => boolean;

  // Constants
  HOVER_SNAP_THROTTLE_MS: number;
  SLOW_RAYCAST_THRESHOLD_MS: number;
  hoverThrottleMs: number;
  RENDER_THROTTLE_MS_SMALL: number;
  RENDER_THROTTLE_MS_LARGE: number;
  RENDER_THROTTLE_MS_HUGE: number;
}

export function useMouseControls(params: UseMouseControlsParams): void {
  const {
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
    handlePickForSelection,
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
  } = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !isInitialized) return;

    const camera = renderer.getCamera();
    const mouseState = mouseStateRef.current;

    // Helper function to compute snap visualization (edge highlights, sliding dot, corner rings, plane indicators)
    // Stores 3D coordinates so edge highlights stay positioned correctly during camera rotation
    function updateSnapViz(snapTarget: SnapTarget | null, edgeLockInfo?: { edgeT: number; isCorner: boolean; cornerValence: number }) {
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

    // Helper function to get approximate world position (for measurement tool)
    function _getApproximateWorldPosition(
      geom: MeshData[] | null,
      entityId: number,
      _screenX: number,
      _screenY: number,
      _canvasWidth: number,
      _canvasHeight: number
    ): { x: number; y: number; z: number } {
      return getEntityCenter(geom, entityId) || { x: 0, y: 0, z: 0 };
    }

    // Mouse controls - respect active tool
    const handleMouseDown = async (e: MouseEvent) => {
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
          // Shift pressed: allow orbit (not pan) when no measurement is active
          mouseState.isDragging = true;
          mouseState.isPanning = false;
          canvas.style.cursor = 'grabbing';
          // Fall through to allow orbit handling in mousemove
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
                clearEdgeLock();
                updateSnapViz(result.snapTarget || null);
              } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId!, result.edgeLock.edgeT);
                updateSnapViz(result.snapTarget, {
                  edgeT: result.edgeLock.edgeT,
                  isCorner: result.edgeLock.isCorner,
                  cornerValence: result.edgeLock.cornerValence,
                });
              } else {
                updateSnapViz(result.snapTarget);
              }

              // Set up orthogonal constraint for shift+drag - always use world axes
              setMeasurementConstraintEdge({
                axes: {
                  axis1: { x: 1, y: 0, z: 0 },  // World X
                  axis2: { x: 0, y: 1, z: 0 },  // World Y (vertical)
                  axis3: { x: 0, y: 0, z: 1 },  // World Z
                },
                colors: {
                  axis1: '#F44336',  // Red - X axis
                  axis2: '#8BC34A',  // Lime - Y axis (vertical)
                  axis3: '#2196F3',  // Blue - Z axis
                },
                activeAxis: null,
              });
            }
          }
          return; // Early return for measure tool (non-shift)
        }
      } else {
        // Default behavior
        mouseState.isPanning = e.shiftKey;
        canvas.style.cursor = e.shiftKey ? 'move' : 'grabbing';
      }
    };

    const handleMouseMove = async (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const tool = activeToolRef.current;

      // Handle measure tool live preview while dragging
      // IMPORTANT: Check tool first, not activeMeasurement, to prevent orbit conflict
      if (tool === 'measure' && mouseState.isDragging && activeMeasurementRef.current) {
        // Only process measurement dragging if we have an active measurement
        // If shift is held without active measurement, fall through to orbit handling

        // Check if shift is held for orthogonal constraint
        const useOrthogonalConstraint = e.shiftKey && measurementConstraintEdgeRef.current;

        // Throttle raycasting to 60fps max using requestAnimationFrame
        if (!measureRaycastPendingRef.current) {
          measureRaycastPendingRef.current = true;

          measureRaycastFrameRef.current = requestAnimationFrame(() => {
            measureRaycastPendingRef.current = false;
            measureRaycastFrameRef.current = null;

            const raycastStart = performance.now();

            // When using orthogonal constraint (shift held), use simpler raycasting
            // since the final position will be projected onto an axis anyway
            const snapOn = snapEnabledRef.current && !useOrthogonalConstraint;

            // If last raycast was slow, reduce complexity to prevent UI freezes
            const wasSlowLastTime = lastMeasureRaycastDurationRef.current > SLOW_RAYCAST_THRESHOLD_MS;
            const reduceComplexity = wasSlowLastTime && !useOrthogonalConstraint;

            // Use magnetic snap for edge sliding behavior (only when not in orthogonal mode)
            const currentLock = useOrthogonalConstraint
              ? { edge: null, meshExpressId: null, lockStrength: 0 }
              : edgeLockStateRef.current;

            const result = renderer.raycastSceneMagnetic(x, y, {
              edge: currentLock.edge,
              meshExpressId: currentLock.meshExpressId,
              lockStrength: currentLock.lockStrength,
            }, {
              hiddenIds: hiddenEntitiesRef.current,
              isolatedIds: isolatedEntitiesRef.current,
              // Reduce snap complexity when using orthogonal constraint or when slow
              snapOptions: snapOn ? {
                snapToVertices: !reduceComplexity, // Skip vertex snapping when slow
                snapToEdges: true,
                snapToFaces: true,
                screenSnapRadius: reduceComplexity ? 40 : 60, // Smaller radius when slow
              } : useOrthogonalConstraint ? {
                // In orthogonal mode, snap to edges and vertices only (no faces)
                snapToVertices: true,
                snapToEdges: true,
                snapToFaces: false,
                screenSnapRadius: 40,
              } : {
                snapToVertices: false,
                snapToEdges: false,
                snapToFaces: false,
                screenSnapRadius: 0,
              },
            });

            // Track raycast duration for adaptive throttling
            lastMeasureRaycastDurationRef.current = performance.now() - raycastStart;

            if (result.intersection || result.snapTarget) {
              const snapPoint = result.snapTarget || result.intersection;
              let pos = snapPoint ? ('position' in snapPoint ? snapPoint.position : snapPoint.point) : null;

              if (pos) {
                // Apply orthogonal constraint if shift is held and we have a constraint
                if (useOrthogonalConstraint && activeMeasurementRef.current) {
                  const constraint = measurementConstraintEdgeRef.current!;
                  const start = activeMeasurementRef.current.start;

                  // Vector from start to cursor position
                  const dx = pos.x - start.x;
                  const dy = pos.y - start.y;
                  const dz = pos.z - start.z;

                  // Calculate dot product with each orthogonal axis
                  const { axis1, axis2, axis3 } = constraint.axes;
                  const dot1 = dx * axis1.x + dy * axis1.y + dz * axis1.z;
                  const dot2 = dx * axis2.x + dy * axis2.y + dz * axis2.z;
                  const dot3 = dx * axis3.x + dy * axis3.y + dz * axis3.z;

                  // Find the axis with the largest absolute dot product (closest to cursor direction)
                  const absDot1 = Math.abs(dot1);
                  const absDot2 = Math.abs(dot2);
                  const absDot3 = Math.abs(dot3);

                  let activeAxis: OrthogonalAxis;
                  let chosenDot: number;
                  let chosenDir: { x: number; y: number; z: number };

                  if (absDot1 >= absDot2 && absDot1 >= absDot3) {
                    activeAxis = 'axis1';
                    chosenDot = dot1;
                    chosenDir = axis1;
                  } else if (absDot2 >= absDot3) {
                    activeAxis = 'axis2';
                    chosenDot = dot2;
                    chosenDir = axis2;
                  } else {
                    activeAxis = 'axis3';
                    chosenDot = dot3;
                    chosenDir = axis3;
                  }

                  // Project cursor position onto the chosen axis
                  pos = {
                    x: start.x + chosenDot * chosenDir.x,
                    y: start.y + chosenDot * chosenDir.y,
                    z: start.z + chosenDot * chosenDir.z,
                  };

                  // Update active axis for visualization
                  updateConstraintActiveAxis(activeAxis);
                } else if (!useOrthogonalConstraint && measurementConstraintEdgeRef.current?.activeAxis) {
                  // Clear active axis when shift is released
                  updateConstraintActiveAxis(null);
                }

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

                // Update edge lock state and snap visualization (even in orthogonal mode)
                if (result.edgeLock.shouldRelease) {
                  clearEdgeLock();
                  updateSnapViz(result.snapTarget || null);
                } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                  // Check if we're on the same edge to preserve lock strength (hysteresis)
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
                    updateEdgeLockPosition(result.edgeLock.edgeT, result.edgeLock.isCorner, result.edgeLock.cornerValence);
                    incrementEdgeLockStrength();
                  } else {
                    setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId!, result.edgeLock.edgeT);
                    updateEdgeLockPosition(result.edgeLock.edgeT, result.edgeLock.isCorner, result.edgeLock.cornerValence);
                  }
                  updateSnapViz(result.snapTarget, {
                    edgeT: result.edgeLock.edgeT,
                    isCorner: result.edgeLock.isCorner,
                    cornerValence: result.edgeLock.cornerValence,
                  });
                } else {
                  updateSnapViz(result.snapTarget || null);
                }
              }
            }
          });
        }

        // Mark as dragged (any movement counts for measure tool)
        mouseState.didDrag = true;
        return;
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
                updateSnapViz(result.snapTarget);
              } else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
                setEdgeLock(result.edgeLock.edge, result.edgeLock.meshExpressId!, result.edgeLock.edgeT);
                updateSnapViz(result.snapTarget, {
                  edgeT: result.edgeLock.edgeT,
                  isCorner: result.edgeLock.isCorner,
                  cornerValence: result.edgeLock.cornerValence,
                });
              } else {
                updateSnapViz(result.snapTarget);
              }
            } else {
              setSnapTarget(null);
              clearEdgeLock();
              updateSnapViz(null);
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
          // Negate dy: mouse Y increases downward, but we want upward drag to pan up
          camera.pan(dx, -dy, false);
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
    };

    const handleMouseUp = (e: MouseEvent) => {
      const tool = activeToolRef.current;

      // Handle measure tool completion
      if (tool === 'measure' && activeMeasurementRef.current) {
        // Cancel any pending raycast to avoid stale updates
        if (measureRaycastFrameRef.current) {
          cancelAnimationFrame(measureRaycastFrameRef.current);
          measureRaycastFrameRef.current = null;
          measureRaycastPendingRef.current = false;
        }

        // Do a final synchronous raycast at the mouseup position to ensure accurate end point
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const useOrthogonalConstraint = e.shiftKey && measurementConstraintEdgeRef.current;
        const currentLock = edgeLockStateRef.current;

        // Use simpler snap options in orthogonal mode (no magnetic locking needed)
        const finalLock = useOrthogonalConstraint
          ? { edge: null, meshExpressId: null, lockStrength: 0 }
          : currentLock;

        const result = renderer.raycastSceneMagnetic(mx, my, {
          edge: finalLock.edge,
          meshExpressId: finalLock.meshExpressId,
          lockStrength: finalLock.lockStrength,
        }, {
          hiddenIds: hiddenEntitiesRef.current,
          isolatedIds: isolatedEntitiesRef.current,
          snapOptions: snapEnabledRef.current && !useOrthogonalConstraint ? {
            snapToVertices: true,
            snapToEdges: true,
            snapToFaces: true,
            screenSnapRadius: 60,
          } : useOrthogonalConstraint ? {
            // In orthogonal mode, snap to edges and vertices only (no faces)
            snapToVertices: true,
            snapToEdges: true,
            snapToFaces: false,
            screenSnapRadius: 40,
          } : {
            snapToVertices: false,
            snapToEdges: false,
            snapToFaces: false,
            screenSnapRadius: 0,
          },
        });

        // Update measurement with final position before finalizing
        if (result.intersection || result.snapTarget) {
          const snapPoint = result.snapTarget || result.intersection;
          let pos = snapPoint ? ('position' in snapPoint ? snapPoint.position : snapPoint.point) : null;

          if (pos) {
            // Apply orthogonal constraint if shift is held
            if (useOrthogonalConstraint && activeMeasurementRef.current) {
              const constraint = measurementConstraintEdgeRef.current!;
              const start = activeMeasurementRef.current.start;

              const dx = pos.x - start.x;
              const dy = pos.y - start.y;
              const dz = pos.z - start.z;

              const { axis1, axis2, axis3 } = constraint.axes;
              const dot1 = dx * axis1.x + dy * axis1.y + dz * axis1.z;
              const dot2 = dx * axis2.x + dy * axis2.y + dz * axis2.z;
              const dot3 = dx * axis3.x + dy * axis3.y + dz * axis3.z;

              const absDot1 = Math.abs(dot1);
              const absDot2 = Math.abs(dot2);
              const absDot3 = Math.abs(dot3);

              let chosenDot: number;
              let chosenDir: { x: number; y: number; z: number };

              if (absDot1 >= absDot2 && absDot1 >= absDot3) {
                chosenDot = dot1;
                chosenDir = axis1;
              } else if (absDot2 >= absDot3) {
                chosenDot = dot2;
                chosenDir = axis2;
              } else {
                chosenDot = dot3;
                chosenDir = axis3;
              }

              pos = {
                x: start.x + chosenDot * chosenDir.x,
                y: start.y + chosenDot * chosenDir.y,
                z: start.z + chosenDot * chosenDir.z,
              };
            }

            const screenPos = camera.projectToScreen(pos, canvas.width, canvas.height);
            const measurePoint: MeasurePoint = {
              x: pos.x,
              y: pos.y,
              z: pos.z,
              screenX: screenPos?.x ?? mx,
              screenY: screenPos?.y ?? my,
            };
            updateMeasurement(measurePoint);
          }
        }

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
    };

    const handleMouseLeave = () => {
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
    };

    const handleContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Uses visibility filtering so hidden elements don't appear in context menu
      const pickResult = await renderer.pick(x, y, getPickOptions());
      openContextMenu(pickResult?.expressId ?? null, e.clientX, e.clientY);
    };

    const handleWheel = (e: WheelEvent) => {
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
        if (hasPendingMeasurements()) {
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
    };

    // Click handling
    const handleClick = async (e: MouseEvent) => {
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
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('click', handleClick);

      // Cancel pending raycast requests
      if (measureRaycastFrameRef.current !== null) {
        cancelAnimationFrame(measureRaycastFrameRef.current);
        measureRaycastFrameRef.current = null;
      }
    };
  }, [isInitialized]);
}

export default useMouseControls;

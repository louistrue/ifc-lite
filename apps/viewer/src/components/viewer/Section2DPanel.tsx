/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section2DPanel - 2D architectural drawing viewer panel
 *
 * Displays generated 2D drawings (floor plans, sections) with:
 * - Canvas-based rendering with pan/zoom
 * - Toggle controls for hidden lines
 * - Export to SVG functionality
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { X, Download, Eye, EyeOff, Maximize2, ZoomIn, ZoomOut, Loader2, Printer, GripVertical, MoreHorizontal, RefreshCw, Pin, PinOff, Palette, Ruler, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import {
  Drawing2DGenerator,
  createSectionConfig,
  GraphicOverrideEngine,
  type Drawing2D,
  type SectionConfig,
  type ElementData,
} from '@ifc-lite/drawing-2d';
import { DrawingSettingsPanel } from './DrawingSettingsPanel';

// Axis conversion from semantic (down/front/side) to geometric (x/y/z)
const AXIS_MAP: Record<'down' | 'front' | 'side', 'x' | 'y' | 'z'> = {
  down: 'y',
  front: 'z',
  side: 'x',
};

// Fill colors for IFC types (architectural convention)
const IFC_TYPE_FILL_COLORS: Record<string, string> = {
  // Structural elements - solid gray
  IfcWall: '#b0b0b0',
  IfcWallStandardCase: '#b0b0b0',
  IfcColumn: '#909090',
  IfcBeam: '#909090',
  IfcSlab: '#c8c8c8',
  IfcRoof: '#d0d0d0',
  IfcFooting: '#808080',
  IfcPile: '#707070',

  // Windows/Doors - lighter
  IfcWindow: '#e8f4fc',
  IfcDoor: '#f5e6d3',

  // Stairs/Railings
  IfcStair: '#d8d8d8',
  IfcStairFlight: '#d8d8d8',
  IfcRailing: '#c0c0c0',

  // MEP - distinct colors
  IfcPipeSegment: '#a0d0ff',
  IfcDuctSegment: '#c0ffc0',

  // Furniture
  IfcFurnishingElement: '#ffe0c0',

  // Spaces (usually not shown in section)
  IfcSpace: '#f0f0f0',

  // Default
  default: '#d0d0d0',
};

function getFillColorForType(ifcType: string): string {
  return IFC_TYPE_FILL_COLORS[ifcType] || IFC_TYPE_FILL_COLORS.default;
}

export function Section2DPanel() {
  const panelVisible = useViewerStore((s) => s.drawing2DPanelVisible);
  const setDrawingPanelVisible = useViewerStore((s) => s.setDrawing2DPanelVisible);
  const drawing = useViewerStore((s) => s.drawing2D);
  const setDrawing = useViewerStore((s) => s.setDrawing2D);
  const status = useViewerStore((s) => s.drawing2DStatus);
  const setDrawingStatus = useViewerStore((s) => s.setDrawing2DStatus);
  const progress = useViewerStore((s) => s.drawing2DProgress);
  const progressPhase = useViewerStore((s) => s.drawing2DPhase);
  const setDrawingProgress = useViewerStore((s) => s.setDrawing2DProgress);
  const drawingError = useViewerStore((s) => s.drawing2DError);
  const setDrawingError = useViewerStore((s) => s.setDrawing2DError);
  const displayOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const updateDisplayOptions = useViewerStore((s) => s.updateDrawing2DDisplayOptions);
  // Graphic overrides
  const graphicOverridePresets = useViewerStore((s) => s.graphicOverridePresets);
  const activePresetId = useViewerStore((s) => s.activePresetId);
  const setActivePreset = useViewerStore((s) => s.setActivePreset);
  const overridesEnabled = useViewerStore((s) => s.overridesEnabled);
  const toggleOverridesEnabled = useViewerStore((s) => s.toggleOverridesEnabled);
  const getActiveOverrideRules = useViewerStore((s) => s.getActiveOverrideRules);
  const customOverrideRules = useViewerStore((s) => s.customOverrideRules);

  // Settings panel visibility
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

  // 2D Measure tool state
  const measure2DMode = useViewerStore((s) => s.measure2DMode);
  const toggleMeasure2DMode = useViewerStore((s) => s.toggleMeasure2DMode);
  const measure2DStart = useViewerStore((s) => s.measure2DStart);
  const measure2DCurrent = useViewerStore((s) => s.measure2DCurrent);
  const setMeasure2DStart = useViewerStore((s) => s.setMeasure2DStart);
  const setMeasure2DCurrent = useViewerStore((s) => s.setMeasure2DCurrent);
  const setMeasure2DShiftLocked = useViewerStore((s) => s.setMeasure2DShiftLocked);
  const measure2DShiftLocked = useViewerStore((s) => s.measure2DShiftLocked);
  const measure2DLockedAxis = useViewerStore((s) => s.measure2DLockedAxis);
  const measure2DResults = useViewerStore((s) => s.measure2DResults);
  const completeMeasure2D = useViewerStore((s) => s.completeMeasure2D);
  const cancelMeasure2D = useViewerStore((s) => s.cancelMeasure2D);
  const clearMeasure2DResults = useViewerStore((s) => s.clearMeasure2DResults);
  const measure2DSnapPoint = useViewerStore((s) => s.measure2DSnapPoint);
  const setMeasure2DSnapPoint = useViewerStore((s) => s.setMeasure2DSnapPoint);

  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const activeTool = useViewerStore((s) => s.activeTool);
  const { geometryResult } = useIfc();

  // Auto-show panel when section tool is active
  const prevActiveToolRef = useRef(activeTool);
  useEffect(() => {
    // Section tool was just activated
    if (activeTool === 'section' && prevActiveToolRef.current !== 'section' && geometryResult?.meshes) {
      setDrawingPanelVisible(true);
    }
    prevActiveToolRef.current = activeTool;
  }, [activeTool, geometryResult, setDrawingPanelVisible]);

  // Local state for pan/zoom and expanded mode
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 400, height: 300 });
  const [isNarrow, setIsNarrow] = useState(false);  // Track if panel is too narrow for all buttons
  const [isPinned, setIsPinned] = useState(true);  // Default ON: keep position on regenerate
  const [needsFit, setNeedsFit] = useState(true);  // Force fit on first open and axis change
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 });
  const isResizing = useRef<'right' | 'top' | 'corner' | null>(null);
  const resizeStartPos = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const prevAxisRef = useRef(sectionPlane.axis);  // Track axis changes
  // Track resize event handlers for cleanup
  const resizeHandlersRef = useRef<{ move: ((e: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null });

  // Track panel width for responsive header
  useEffect(() => {
    setIsNarrow(panelSize.width < 480);
  }, [panelSize.width]);

  // Create graphic override engine with active rules
  const overrideEngine = useMemo(() => {
    const rules = getActiveOverrideRules();
    return new GraphicOverrideEngine(rules);
  }, [getActiveOverrideRules, activePresetId, customOverrideRules, overridesEnabled]);

  // Build entity color map from mesh material colors (for "Use IFC Materials" mode)
  const entityColorMap = useMemo(() => {
    const map = new Map<number, [number, number, number, number]>();
    if (geometryResult?.meshes) {
      for (const mesh of geometryResult.meshes) {
        if (mesh.expressId && mesh.color) {
          map.set(mesh.expressId, mesh.color);
        }
      }
    }
    return map;
  }, [geometryResult]);

  // Track if this is a regeneration (vs initial generation)
  const isRegeneratingRef = useRef(false);

  // Generate drawing when panel opens
  const generateDrawing = useCallback(async (isRegenerate = false) => {
    if (!geometryResult?.meshes || geometryResult.meshes.length === 0) {
      setDrawingError('No geometry loaded');
      return;
    }

    // Only show full loading overlay for initial generation, not regeneration
    if (!isRegenerate) {
      setDrawingStatus('generating');
      setDrawingProgress(0, 'Initializing...');
    }
    isRegeneratingRef.current = isRegenerate;

    let generator: Drawing2DGenerator | null = null;
    try {
      generator = new Drawing2DGenerator();
      await generator.initialize();

      // Convert semantic axis to geometric
      const axis = AXIS_MAP[sectionPlane.axis];

      // Calculate section position from percentage using coordinateInfo bounds
      const bounds = geometryResult.coordinateInfo.shiftedBounds;

      const axisMin = bounds.min[axis];
      const axisMax = bounds.max[axis];
      const position = axisMin + (sectionPlane.position / 100) * (axisMax - axisMin);

      // Calculate max depth as half the model extent
      const maxDepth = (axisMax - axisMin) * 0.5;

      const progressCallback = (stage: string, prog: number) => {
        setDrawingProgress(prog * 100, stage);
      };

      // Create section config
      const config: SectionConfig = createSectionConfig(axis, position, {
        projectionDepth: maxDepth,
        includeHiddenLines: displayOptions.showHiddenLines,
        scale: displayOptions.scale,
      });

      // Override the flipped setting
      config.plane.flipped = sectionPlane.flipped;

      const result = await generator.generate(geometryResult.meshes, config, {
        includeHiddenLines: false,  // Disable - causes internal mesh edges
        includeProjection: false,   // Disable - causes triangulation lines
        includeEdges: false,        // Disable - causes triangulation lines
        mergeLines: true,
        onProgress: progressCallback,
      });

      setDrawing(result);

      // Always set status to ready (whether initial generation or regeneration)
      setDrawingStatus('ready');
      isRegeneratingRef.current = false;
    } catch (error) {
      console.error('Drawing generation failed:', error);
      setDrawingError(error instanceof Error ? error.message : 'Generation failed');
    } finally {
      // Always cleanup generator to prevent resource leaks
      generator?.dispose();
    }
  }, [
    geometryResult,
    sectionPlane,
    displayOptions,
    setDrawing,
    setDrawingStatus,
    setDrawingProgress,
    setDrawingError,
  ]);

  // Auto-generate when panel opens and no drawing exists
  useEffect(() => {
    if (panelVisible && !drawing && status === 'idle' && geometryResult?.meshes) {
      generateDrawing();
    }
  }, [panelVisible, drawing, status, geometryResult, generateDrawing]);

  // Auto-regenerate when section plane changes
  // Strategy: Debounce but keep existing drawing visible (no flicker)
  const sectionRef = useRef({ axis: sectionPlane.axis, position: sectionPlane.position, flipped: sectionPlane.flipped });
  const regenerateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    // Check if section plane actually changed
    const prev = sectionRef.current;
    if (
      prev.axis === sectionPlane.axis &&
      prev.position === sectionPlane.position &&
      prev.flipped === sectionPlane.flipped
    ) {
      return;
    }

    // Update ref
    sectionRef.current = { axis: sectionPlane.axis, position: sectionPlane.position, flipped: sectionPlane.flipped };

    // If panel is visible and we have geometry, regenerate with debounce
    // Note: status check removed - we regenerate in background even if status is 'generating'
    if (panelVisible && geometryResult?.meshes) {
      // Clear any pending regeneration
      if (regenerateTimeoutRef.current) {
        clearTimeout(regenerateTimeoutRef.current);
      }

      // Show subtle regenerating indicator immediately
      setIsRegenerating(true);

      // Short debounce - just enough to batch rapid slider movements
      regenerateTimeoutRef.current = setTimeout(() => {
        // Pass true to indicate this is a regeneration (keeps existing drawing visible)
        generateDrawing(true).finally(() => {
          setIsRegenerating(false);
        });
      }, 150); // 150ms debounce - responsive but avoids excessive calls
    }

    return () => {
      if (regenerateTimeoutRef.current) {
        clearTimeout(regenerateTimeoutRef.current);
      }
    };
  }, [panelVisible, sectionPlane.axis, sectionPlane.position, sectionPlane.flipped, geometryResult, generateDrawing]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2D MEASURE TOOL HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // Convert screen coordinates to drawing coordinates
  const screenToDrawing = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    // Screen coord → drawing coord
    // Y is flipped: ctx.scale(transform.scale, -transform.scale)
    const x = (screenX - viewTransform.x) / viewTransform.scale;
    const y = -(screenY - viewTransform.y) / viewTransform.scale;
    return { x, y };
  }, [viewTransform]);

  // Find nearest point on a line segment
  const nearestPointOnSegment = useCallback((
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): { point: { x: number; y: number }; dist: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 0.0001) {
      // Degenerate segment
      const d = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
      return { point: a, dist: d };
    }

    // Parameter t along segment [0,1]
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);

    return { point: nearest, dist };
  }, []);

  // Find snap point near cursor (check polygon vertices, edges, and line endpoints)
  const findSnapPoint = useCallback((drawingCoord: { x: number; y: number }): { x: number; y: number } | null => {
    if (!drawing) return null;

    const snapThreshold = 10 / viewTransform.scale; // 10 screen pixels
    let bestSnap: { x: number; y: number } | null = null;
    let bestDist = snapThreshold;

    // Priority 1: Check polygon vertices (endpoints are highest priority)
    for (const polygon of drawing.cutPolygons) {
      for (const pt of polygon.polygon.outer) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) { // Vertices get priority (70% threshold)
          return { x: pt.x, y: pt.y }; // Return immediately for vertex snaps
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (const pt of hole) {
          const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
          if (dist < bestDist * 0.7) {
            return { x: pt.x, y: pt.y };
          }
        }
      }
    }

    // Priority 2: Check line endpoints
    for (const line of drawing.lines) {
      const { start, end } = line.line;
      for (const pt of [start, end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) {
          return { x: pt.x, y: pt.y };
        }
      }
    }

    // Priority 3: Check polygon edges
    for (const polygon of drawing.cutPolygons) {
      const outer = polygon.polygon.outer;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
        if (dist < bestDist) {
          bestDist = dist;
          bestSnap = point;
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % hole.length];
          const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
          if (dist < bestDist) {
            bestDist = dist;
            bestSnap = point;
          }
        }
      }
    }

    // Priority 4: Check drawing lines
    for (const line of drawing.lines) {
      const { start, end } = line.line;
      const { point, dist } = nearestPointOnSegment(drawingCoord, start, end);
      if (dist < bestDist) {
        bestDist = dist;
        bestSnap = point;
      }
    }

    return bestSnap;
  }, [drawing, viewTransform.scale, nearestPointOnSegment]);

  // Apply orthogonal constraint if shift is held
  const applyOrthogonalConstraint = useCallback((start: { x: number; y: number }, current: { x: number; y: number }, lockedAxis: 'x' | 'y' | null): { x: number; y: number } => {
    if (!lockedAxis) return current;

    if (lockedAxis === 'x') {
      return { x: current.x, y: start.y };
    } else {
      return { x: start.x, y: current.y };
    }
  }, []);

  // Keyboard handlers for shift key (orthogonal constraint)
  useEffect(() => {
    if (!measure2DMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && measure2DStart && measure2DCurrent && !measure2DShiftLocked) {
        // Determine axis based on dominant direction
        const dx = Math.abs(measure2DCurrent.x - measure2DStart.x);
        const dy = Math.abs(measure2DCurrent.y - measure2DStart.y);
        const axis = dx > dy ? 'x' : 'y';
        setMeasure2DShiftLocked(true, axis);
      }
      if (e.key === 'Escape') {
        cancelMeasure2D();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setMeasure2DShiftLocked(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [measure2DMode, measure2DStart, measure2DCurrent, measure2DShiftLocked, setMeasure2DShiftLocked, cancelMeasure2D]);

  // Pan/Measure handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (measure2DMode) {
      // Measure mode: set start point
      const drawingCoord = screenToDrawing(screenX, screenY);
      const snapPoint = findSnapPoint(drawingCoord);
      const startPoint = snapPoint || drawingCoord;
      setMeasure2DStart(startPoint);
      setMeasure2DCurrent(startPoint);
    } else {
      // Pan mode
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
    }
  }, [measure2DMode, screenToDrawing, findSnapPoint, setMeasure2DStart, setMeasure2DCurrent]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (measure2DMode) {
      const drawingCoord = screenToDrawing(screenX, screenY);

      // Find snap point and update
      const snapPoint = findSnapPoint(drawingCoord);
      setMeasure2DSnapPoint(snapPoint);

      if (measure2DStart) {
        // If measuring, update current point
        let currentPoint = snapPoint || drawingCoord;

        // Apply orthogonal constraint if shift is held
        if (measure2DShiftLocked && measure2DLockedAxis) {
          currentPoint = applyOrthogonalConstraint(measure2DStart, currentPoint, measure2DLockedAxis);
        }

        setMeasure2DCurrent(currentPoint);
      }
    } else if (isPanning.current) {
      // Pan mode
      const dx = e.clientX - lastPanPoint.current.x;
      const dy = e.clientY - lastPanPoint.current.y;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      setViewTransform((prev) => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy,
      }));
    }
  }, [measure2DMode, measure2DStart, measure2DShiftLocked, measure2DLockedAxis, screenToDrawing, findSnapPoint, setMeasure2DSnapPoint, setMeasure2DCurrent, applyOrthogonalConstraint]);

  const handleMouseUp = useCallback(() => {
    if (measure2DMode && measure2DStart && measure2DCurrent) {
      // Complete the measurement
      completeMeasure2D();
    }
    isPanning.current = false;
  }, [measure2DMode, measure2DStart, measure2DCurrent, completeMeasure2D]);

  // Zoom handler - unlimited zoom, min 0.01 (1%)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();  // Prevent bubbling to 3D viewport
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setViewTransform((prev) => {
      const newScale = Math.max(0.01, prev.scale * delta);  // No upper limit
      const scaleRatio = newScale / prev.scale;
      return {
        scale: newScale,
        x: x - (x - prev.x) * scaleRatio,
        y: y - (y - prev.y) * scaleRatio,
      };
    });
  }, []);

  // Zoom controls - unlimited zoom
  const zoomIn = useCallback(() => {
    setViewTransform((prev) => ({ ...prev, scale: prev.scale * 1.2 }));  // No upper limit
  }, []);

  const zoomOut = useCallback(() => {
    setViewTransform((prev) => ({ ...prev, scale: Math.max(0.01, prev.scale / 1.2) }));
  }, []);

  const fitToView = useCallback(() => {
    if (!drawing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { bounds } = drawing;
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;

    if (width < 0.001 || height < 0.001) return;

    // Calculate scale to fit with padding (15% margin on each side)
    const padding = 0.15;
    const availableWidth = rect.width * (1 - 2 * padding);
    const availableHeight = rect.height * (1 - 2 * padding);
    const scaleX = availableWidth / width;
    const scaleY = availableHeight / height;
    // No artificial cap - let it zoom to fit the content
    const scale = Math.min(scaleX, scaleY);

    // Center the drawing in the view
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;

    setViewTransform({
      scale,
      x: rect.width / 2 - centerX * scale,
      y: rect.height / 2 + centerY * scale, // Flip Y
    });
  }, [drawing]);

  // Track axis changes for forced fit-to-view
  const lastFitAxisRef = useRef(sectionPlane.axis);

  // Set needsFit when axis changes
  useEffect(() => {
    if (sectionPlane.axis !== prevAxisRef.current) {
      prevAxisRef.current = sectionPlane.axis;
      setNeedsFit(true);  // Force fit when axis changes
    }
  }, [sectionPlane.axis]);

  // Auto-fit when: (1) needsFit is true (first open or axis change), or (2) not pinned after regenerate
  // ALWAYS fit when axis changed, regardless of pin state
  useEffect(() => {
    if (status === 'ready' && drawing && containerRef.current) {
      const axisChanged = lastFitAxisRef.current !== sectionPlane.axis;

      // Fit if needsFit (first open/axis change) OR if not pinned OR if axis just changed
      if (needsFit || !isPinned || axisChanged) {
        // Small delay to ensure canvas is rendered
        const timeout = setTimeout(() => {
          fitToView();
          lastFitAxisRef.current = sectionPlane.axis;
          if (needsFit) {
            setNeedsFit(false);  // Clear the flag after fitting
          }
        }, 50);
        return () => clearTimeout(timeout);
      }
    }
  }, [status, drawing, fitToView, isPinned, needsFit, sectionPlane.axis]);

  // Format distance for display (same logic as canvas)
  const formatDistance = useCallback((distance: number): string => {
    if (distance < 0.01) {
      return `${(distance * 1000).toFixed(1)} mm`;
    } else if (distance < 1) {
      return `${(distance * 100).toFixed(1)} cm`;
    } else {
      return `${distance.toFixed(3)} m`;
    }
  }, []);

  // Generate SVG that matches the canvas rendering exactly
  const generateExportSVG = useCallback((): string | null => {
    if (!drawing) return null;

    const { bounds } = drawing;
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;

    // Add padding around the drawing
    const padding = Math.max(width, height) * 0.1;
    const viewMinX = bounds.min.x - padding;
    const viewMinY = bounds.min.y - padding;
    const viewWidth = width + padding * 2;
    const viewHeight = height + padding * 2;

    // SVG dimensions in mm (assuming model is in meters, scale 1:100)
    const scale = displayOptions.scale || 100;
    const svgWidthMm = (viewWidth * 1000) / scale;
    const svgHeightMm = (viewHeight * 1000) / scale;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Helper to get polygon path
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      let path = '';
      if (polygon.outer.length > 0) {
        path += `M ${polygon.outer[0].x.toFixed(4)} ${(-polygon.outer[0].y).toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          path += ` L ${polygon.outer[i].x.toFixed(4)} ${(-polygon.outer[i].y).toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          path += ` M ${hole[0].x.toFixed(4)} ${(-hole[0].y).toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            path += ` L ${hole[i].x.toFixed(4)} ${(-hole[i].y).toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // Start building SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidthMm.toFixed(2)}mm"
     height="${svgHeightMm.toFixed(2)}mm"
     viewBox="${viewMinX.toFixed(4)} ${(-viewMinY - viewHeight).toFixed(4)} ${viewWidth.toFixed(4)} ${viewHeight.toFixed(4)}">
  <rect x="${viewMinX.toFixed(4)}" y="${(-viewMinY - viewHeight).toFixed(4)}" width="${viewWidth.toFixed(4)}" height="${viewHeight.toFixed(4)}" fill="#FFFFFF"/>
`;

    // 1. FILL CUT POLYGONS (with color from IFC materials or override engine)
    svg += '  <g id="polygon-fills">\n';
    for (const polygon of drawing.cutPolygons) {
      let fillColor = getFillColorForType(polygon.ifcType);
      let opacity = 1;

      // Use actual IFC material colors from the mesh data
      if (activePresetId === 'preset-3d-colors') {
        const materialColor = entityColorMap.get(polygon.entityId);
        if (materialColor) {
          const r = Math.round(materialColor[0] * 255);
          const g = Math.round(materialColor[1] * 255);
          const b = Math.round(materialColor[2] * 255);
          fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          opacity = materialColor[3];
        }
      } else if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        fillColor = result.style.fillColor;
        opacity = result.style.opacity;
      }

      const pathData = polygonToPath(polygon.polygon);
      svg += `    <path d="${pathData}" fill="${fillColor}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
    }
    svg += '  </g>\n';

    // 2. STROKE CUT POLYGON OUTLINES (with color from override engine)
    svg += '  <g id="polygon-outlines">\n';
    for (const polygon of drawing.cutPolygons) {
      let strokeColor = '#000000';
      let lineWeight = 0.5;

      if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        strokeColor = result.style.strokeColor;
        lineWeight = result.style.lineWeight;
      }

      const pathData = polygonToPath(polygon.polygon);
      // Line weight in model units (meters), convert to reasonable SVG units
      const svgLineWeight = lineWeight / 1000; // mm to meters for model space
      svg += `    <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
    }
    svg += '  </g>\n';

    // 3. DRAW PROJECTION/SILHOUETTE LINES
    // Pre-compute bounds for line validation
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '  <g id="drawing-lines">\n';
    for (const line of drawing.lines) {
      // Skip 'cut' lines - they're triangulation edges, already handled by polygons
      if (line.category === 'cut') continue;

      // Skip hidden lines if not showing
      if (!displayOptions.showHiddenLines && line.visibility === 'hidden') continue;

      // Skip lines with invalid coordinates
      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
        continue;
      }
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
          end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
        continue;
      }

      // Set line style based on category
      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'projection':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'hidden':
          lineWidth = 0.18;
          strokeColor = '#666666';
          dashArray = '2 1';
          break;
        case 'silhouette':
          lineWidth = 0.35;
          strokeColor = '#000000';
          break;
        case 'crease':
          lineWidth = 0.18;
          strokeColor = '#000000';
          break;
        case 'boundary':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'annotation':
          lineWidth = 0.13;
          strokeColor = '#000000';
          break;
      }

      // Hidden visibility overrides
      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '2 1';
        lineWidth *= 0.7;
      }

      // Convert line width from mm to model units (meters)
      const svgLineWidth = lineWidth / 1000;
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray.split(' ').map(d => (parseFloat(d) / 1000).toFixed(4)).join(' ')}"` : '';

      svg += `    <line x1="${start.x.toFixed(4)}" y1="${(-start.y).toFixed(4)}" x2="${end.x.toFixed(4)}" y2="${(-end.y).toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '  </g>\n';

    // 4. DRAW COMPLETED MEASUREMENTS
    if (measure2DResults.length > 0) {
      svg += '  <g id="measurements">\n';
      for (const result of measure2DResults) {
        const { start, end, distance } = result;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const labelText = formatDistance(distance);

        // Measurement line color
        const measureColor = '#2196F3';
        const measureLineWidth = 1.5 / 1000; // 1.5px converted to model units
        const endpointRadius = 4 / 1000; // 4px converted to model units

        // Draw line
        svg += `    <line x1="${start.x.toFixed(4)}" y1="${(-start.y).toFixed(4)}" x2="${end.x.toFixed(4)}" y2="${(-end.y).toFixed(4)}" stroke="${measureColor}" stroke-width="${measureLineWidth.toFixed(4)}"/>\n`;

        // Draw endpoints
        svg += `    <circle cx="${start.x.toFixed(4)}" cy="${(-start.y).toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;
        svg += `    <circle cx="${end.x.toFixed(4)}" cy="${(-end.y).toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;

        // Draw label background and text
        const fontSize = 12 / 1000 / (scale / 100); // Adjust font size for scale
        const labelPadding = 4 / 1000;
        const labelWidth = labelText.length * fontSize * 0.6; // Approximate text width
        const labelHeight = fontSize * 1.5;

        svg += `    <rect x="${(midX - labelWidth / 2).toFixed(4)}" y="${(-midY - labelHeight / 2).toFixed(4)}" width="${labelWidth.toFixed(4)}" height="${labelHeight.toFixed(4)}" fill="rgba(255,255,255,0.9)" stroke="${measureColor}" stroke-width="${(0.5 / 1000).toFixed(4)}"/>\n`;
        svg += `    <text x="${midX.toFixed(4)}" y="${(-midY).toFixed(4)}" font-family="system-ui, sans-serif" font-size="${fontSize.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle">${escapeXml(labelText)}</text>\n`;
      }
      svg += '  </g>\n';
    }

    svg += '</svg>';
    return svg;
  }, [drawing, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, measure2DResults, formatDistance]);

  // Export SVG
  const handleExportSVG = useCallback(() => {
    const svg = generateExportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `section-${sectionPlane.axis}-${sectionPlane.position}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generateExportSVG, sectionPlane]);

  // Close panel
  const handleClose = useCallback(() => {
    setDrawingPanelVisible(false);
  }, [setDrawingPanelVisible]);

  // Toggle options
  const toggle3DOverlay = useCallback(() => {
    updateDisplayOptions({ show3DOverlay: !displayOptions.show3DOverlay });
  }, [displayOptions.show3DOverlay, updateDisplayOptions]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const togglePinned = useCallback(() => {
    setIsPinned((prev) => !prev);
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback((edge: 'right' | 'top' | 'corner') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = edge;
    resizeStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    };

    // Remove any existing listeners first
    if (resizeHandlersRef.current.move) {
      window.removeEventListener('mousemove', resizeHandlersRef.current.move);
    }
    if (resizeHandlersRef.current.up) {
      window.removeEventListener('mouseup', resizeHandlersRef.current.up);
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;

      const dx = e.clientX - resizeStartPos.current.x;
      const dy = e.clientY - resizeStartPos.current.y;

      setPanelSize((prev) => {
        let newWidth = prev.width;
        let newHeight = prev.height;

        if (isResizing.current === 'right' || isResizing.current === 'corner') {
          newWidth = Math.max(300, Math.min(1200, resizeStartPos.current.width + dx));
        }
        // Top resize: dragging up (negative dy) increases height
        if (isResizing.current === 'top' || isResizing.current === 'corner') {
          newHeight = Math.max(200, Math.min(800, resizeStartPos.current.height - dy));
        }

        return { width: newWidth, height: newHeight };
      });
    };

    const handleMouseUp = () => {
      isResizing.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeHandlersRef.current = { move: null, up: null };
    };

    // Store refs for cleanup
    resizeHandlersRef.current = { move: handleMouseMove, up: handleMouseUp };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [panelSize]);

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (resizeHandlersRef.current.move) {
        window.removeEventListener('mousemove', resizeHandlersRef.current.move);
      }
      if (resizeHandlersRef.current.up) {
        window.removeEventListener('mouseup', resizeHandlersRef.current.up);
      }
    };
  }, []);

  // Print handler
  const handlePrint = useCallback(() => {
    const svg = generateExportSVG();
    if (!svg) return;

    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Please allow popups to print');
      return;
    }

    // Write print-friendly HTML with the SVG
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Section Drawing - ${sectionPlane.axis} at ${sectionPlane.position}%</title>
          <style>
            @media print {
              @page { margin: 1cm; }
              body { margin: 0; }
            }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            svg {
              max-width: 100%;
              max-height: 100vh;
              width: auto;
              height: auto;
            }
          </style>
        </head>
        <body>
          ${svg}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }, [generateExportSVG, sectionPlane]);

  // Memoize panel style to avoid creating new object on every render
  const panelStyle = useMemo(() => {
    return isExpanded
      ? {}  // Expanded uses CSS classes for full sizing
      : { width: panelSize.width, height: panelSize.height };
  }, [isExpanded, panelSize.width, panelSize.height]);

  // Memoize progress bar style
  const progressBarStyle = useMemo(() => ({ width: `${progress}%` }), [progress]);

  if (!panelVisible) return null;

  const panelClasses = isExpanded
    ? 'absolute inset-4 z-40'
    : 'absolute bottom-4 left-4 z-40';

  return (
    <div
      ref={panelRef}
      className={`${panelClasses} bg-background rounded-lg border shadow-xl flex flex-col overflow-hidden`}
      style={panelStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50 rounded-t-lg min-w-0">
        <h2 className="font-semibold text-xs shrink-0">2D Section</h2>

        <div className="flex items-center gap-1 min-w-0">
          {/* When panel is wide enough, show all buttons */}
          {!isNarrow && (
            <>
              {/* Display toggles */}
              <Button
                variant={displayOptions.show3DOverlay ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={toggle3DOverlay}
                title="Toggle 3D overlay"
              >
                {displayOptions.show3DOverlay ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>

              {/* 2D Measure Tool */}
              <Button
                variant={measure2DMode ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={toggleMeasure2DMode}
                title={measure2DMode ? 'Exit measure mode' : 'Measure distance'}
              >
                <Ruler className="h-4 w-4" />
              </Button>
              {measure2DResults.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={clearMeasure2DResults}
                  title="Clear measurements"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}

              {/* Graphic Override Settings */}
              <Button
                variant={settingsPanelOpen || activePresetId ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={() => setSettingsPanelOpen((prev) => !prev)}
                title="Drawing settings"
                className="relative"
              >
                <Palette className="h-4 w-4" />
                {activePresetId && !settingsPanelOpen && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                )}
              </Button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Zoom controls */}
              <Button variant="ghost" size="icon-sm" onClick={zoomOut} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs font-mono w-10 text-center">
                {Math.round(viewTransform.scale * 100)}%
              </span>
              <Button variant="ghost" size="icon-sm" onClick={zoomIn} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={fitToView} title="Fit to view">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant={isPinned ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={togglePinned}
                title={isPinned ? 'Unpin view (auto-fit on regenerate)' : 'Pin view (keep position on regenerate)'}
              >
                {isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
              </Button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Export/Print */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleExportSVG}
                disabled={!drawing}
                title="Download SVG"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handlePrint}
                disabled={!drawing}
                title="Print"
              >
                <Printer className="h-4 w-4" />
              </Button>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Regenerate */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => generateDrawing(false)}
                disabled={status === 'generating'}
                title="Regenerate"
              >
                {status === 'generating' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </>
          )}

          {/* When narrow, show minimal controls + dropdown menu */}
          {isNarrow && (
            <>
              {/* Essential zoom controls */}
              <Button variant="ghost" size="icon-sm" onClick={fitToView} title="Fit to view">
                <Maximize2 className="h-4 w-4" />
              </Button>

              {/* Overflow menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" title="More options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={toggle3DOverlay}>
                    {displayOptions.show3DOverlay ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                    3D Overlay {displayOptions.show3DOverlay ? 'On' : 'Off'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleMeasure2DMode}>
                    <Ruler className="h-4 w-4 mr-2" />
                    Measure {measure2DMode ? 'On' : 'Off'}
                  </DropdownMenuItem>
                  {measure2DResults.length > 0 && (
                    <DropdownMenuItem onClick={clearMeasure2DResults}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear Measurements
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSettingsPanelOpen(true)}>
                    <Palette className="h-4 w-4 mr-2" />
                    Drawing Settings...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={zoomIn}>
                    <ZoomIn className="h-4 w-4 mr-2" />
                    Zoom In
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={zoomOut}>
                    <ZoomOut className="h-4 w-4 mr-2" />
                    Zoom Out
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={togglePinned}>
                    {isPinned ? <Pin className="h-4 w-4 mr-2" /> : <PinOff className="h-4 w-4 mr-2" />}
                    Pin View {isPinned ? 'On' : 'Off'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportSVG} disabled={!drawing}>
                    <Download className="h-4 w-4 mr-2" />
                    Download SVG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handlePrint} disabled={!drawing}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => generateDrawing(false)} disabled={status === 'generating'}>
                    {status === 'generating' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Regenerate
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {/* Close button always visible */}
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Drawing Canvas */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden bg-white dark:bg-zinc-950 rounded-b-lg ${
          measure2DMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {status === 'generating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
            <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
            <div className="text-sm font-medium">{progressPhase}</div>
            <div className="w-48 h-2 bg-muted rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={progressBarStyle}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">{Math.round(progress)}%</div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-destructive text-center">
              <p className="font-medium">Generation failed</p>
              <p className="text-sm text-muted-foreground">
                {drawingError}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => generateDrawing(false)}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {status === 'ready' && drawing && drawing.cutPolygons.length > 0 && (
          <>
            <Drawing2DCanvas
              drawing={drawing}
              transform={viewTransform}
              showHiddenLines={displayOptions.showHiddenLines}
              overrideEngine={overrideEngine}
              overridesEnabled={overridesEnabled}
              entityColorMap={entityColorMap}
              useIfcMaterials={activePresetId === 'preset-3d-colors'}
              measureMode={measure2DMode}
              measureStart={measure2DStart}
              measureCurrent={measure2DCurrent}
              measureResults={measure2DResults}
              measureSnapPoint={measure2DSnapPoint}
            />
            {/* Subtle updating indicator - shows while regenerating without hiding the drawing */}
            {isRegenerating && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Updating...</span>
              </div>
            )}
          </>
        )}

        {status === 'ready' && drawing && drawing.cutPolygons.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="font-medium">No geometry at this level</p>
              <p className="text-sm mt-1">Move the section plane to cut through geometry</p>
            </div>
          </div>
        )}

        {status === 'idle' && !drawing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p>No drawing generated yet</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => generateDrawing(false)}>
                Generate Drawing
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Resize handles - only show when not expanded */}
      {!isExpanded && (
        <>
          {/* Right edge */}
          <div
            className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-primary/20 transition-colors"
            onMouseDown={handleResizeStart('right')}
          />
          {/* Top edge */}
          <div
            className="absolute top-0 left-0 w-full h-2 cursor-ns-resize hover:bg-primary/20 transition-colors"
            onMouseDown={handleResizeStart('top')}
          />
          {/* Top-right corner */}
          <div
            className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize flex items-center justify-center hover:bg-primary/20 transition-colors"
            onMouseDown={handleResizeStart('corner')}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground rotate-[45deg]" />
          </div>
        </>
      )}

      {/* Settings Panel - slides in from right */}
      {settingsPanelOpen && (
        <div className="absolute top-0 right-0 bottom-0 w-72 z-50 shadow-xl">
          <DrawingSettingsPanel onClose={() => setSettingsPanelOpen(false)} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS RENDERER
// ═══════════════════════════════════════════════════════════════════════════

// Static style constant to avoid creating new object on every render
const CANVAS_STYLE = { imageRendering: 'crisp-edges' as const };

interface Measure2DResultData {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  distance: number;
}

interface Drawing2DCanvasProps {
  drawing: Drawing2D;
  transform: { x: number; y: number; scale: number };
  showHiddenLines: boolean;
  overrideEngine: GraphicOverrideEngine;
  overridesEnabled: boolean;
  entityColorMap: Map<number, [number, number, number, number]>;
  useIfcMaterials: boolean;
  // Measure tool props
  measureMode?: boolean;
  measureStart?: { x: number; y: number } | null;
  measureCurrent?: { x: number; y: number } | null;
  measureResults?: Measure2DResultData[];
  measureSnapPoint?: { x: number; y: number } | null;
}

function Drawing2DCanvas({
  drawing,
  transform,
  showHiddenLines,
  overrideEngine,
  overridesEnabled,
  entityColorMap,
  useIfcMaterials,
  measureMode = false,
  measureStart = null,
  measureCurrent = null,
  measureResults = [],
  measureSnapPoint = null,
}: Drawing2DCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // ResizeObserver to track canvas size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize((prev) => {
          // Only update if size actually changed to avoid render loops
          if (prev.width !== width || prev.height !== height) {
            return { width, height };
          }
          return prev;
        });
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size using tracked dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Apply transform
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, -transform.scale); // Flip Y for CAD coordinates

    // ═══════════════════════════════════════════════════════════════════════
    // 1. FILL CUT POLYGONS (with color from IFC materials, override engine, or type fallback)
    // ═══════════════════════════════════════════════════════════════════════
    for (const polygon of drawing.cutPolygons) {
      // Get fill color - priority: IFC materials > override engine > IFC type fallback
      let fillColor = getFillColorForType(polygon.ifcType);
      let strokeColor = '#000000';
      let opacity = 1;

      // Use actual IFC material colors from the mesh data
      if (useIfcMaterials) {
        const materialColor = entityColorMap.get(polygon.entityId);
        if (materialColor) {
          // Convert RGBA [0-1] to hex color
          const r = Math.round(materialColor[0] * 255);
          const g = Math.round(materialColor[1] * 255);
          const b = Math.round(materialColor[2] * 255);
          fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          opacity = materialColor[3];
        }
      } else if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        fillColor = result.style.fillColor;
        strokeColor = result.style.strokeColor;
        opacity = result.style.opacity;
      }

      ctx.globalAlpha = opacity;
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      if (polygon.polygon.outer.length > 0) {
        ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
        for (let i = 1; i < polygon.polygon.outer.length; i++) {
          ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
        }
        ctx.closePath();

        // Draw holes (inner boundaries)
        for (const hole of polygon.polygon.holes) {
          if (hole.length > 0) {
            ctx.moveTo(hole[0].x, hole[0].y);
            for (let i = 1; i < hole.length; i++) {
              ctx.lineTo(hole[i].x, hole[i].y);
            }
            ctx.closePath();
          }
        }
      }
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. STROKE CUT POLYGON OUTLINES (with color from override engine)
    // ═══════════════════════════════════════════════════════════════════════
    for (const polygon of drawing.cutPolygons) {
      let strokeColor = '#000000';
      let lineWeight = 0.5;

      if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        strokeColor = result.style.strokeColor;
        lineWeight = result.style.lineWeight;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWeight / transform.scale;
      ctx.beginPath();
      if (polygon.polygon.outer.length > 0) {
        ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
        for (let i = 1; i < polygon.polygon.outer.length; i++) {
          ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
        }
        ctx.closePath();

        // Stroke holes too
        for (const hole of polygon.polygon.holes) {
          if (hole.length > 0) {
            ctx.moveTo(hole[0].x, hole[0].y);
            for (let i = 1; i < hole.length; i++) {
              ctx.lineTo(hole[i].x, hole[i].y);
            }
            ctx.closePath();
          }
        }
      }
      ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. DRAW PROJECTION/SILHOUETTE LINES (skip 'cut' - already in polygons)
    // ═══════════════════════════════════════════════════════════════════════
    // Pre-compute bounds for line validation
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    for (const line of drawing.lines) {
      // Skip 'cut' lines - they're triangulation edges, already handled by polygons
      if (line.category === 'cut') continue;

      // Skip hidden lines if not showing
      if (!showHiddenLines && line.visibility === 'hidden') continue;

      // Skip lines with invalid coordinates (NaN, Infinity, or far outside bounds)
      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
        continue;
      }
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
          end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
        continue;
      }

      // Set line style based on category
      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashPattern: number[] = [];

      switch (line.category) {
        case 'projection':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'hidden':
          lineWidth = 0.18;
          strokeColor = '#666666';
          dashPattern = [2, 1];
          break;
        case 'silhouette':
          lineWidth = 0.35;
          strokeColor = '#000000';
          break;
        case 'crease':
          lineWidth = 0.18;
          strokeColor = '#000000';
          break;
        case 'boundary':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'annotation':
          lineWidth = 0.13;
          strokeColor = '#000000';
          break;
      }

      // Hidden visibility overrides
      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashPattern = [2, 1];
        lineWidth *= 0.7;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth / transform.scale;
      ctx.setLineDash(dashPattern.map((d) => d / transform.scale));

      ctx.beginPath();
      ctx.moveTo(line.line.start.x, line.line.start.y);
      ctx.lineTo(line.line.end.x, line.line.end.y);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    ctx.restore();

    // ═══════════════════════════════════════════════════════════════════════
    // 4. RENDER MEASUREMENTS (in screen space)
    // ═══════════════════════════════════════════════════════════════════════
    const drawMeasureLine = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      distance: number,
      color: string = '#2196F3',
      isActive: boolean = false
    ) => {
      // Convert drawing coords to screen coords
      const screenStart = {
        x: start.x * transform.scale + transform.x,
        y: -start.y * transform.scale + transform.y,
      };
      const screenEnd = {
        x: end.x * transform.scale + transform.x,
        y: -end.y * transform.scale + transform.y,
      };

      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash(isActive ? [6, 3] : []);
      ctx.beginPath();
      ctx.moveTo(screenStart.x, screenStart.y);
      ctx.lineTo(screenEnd.x, screenEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw endpoints
      ctx.fillStyle = color;
      const endpointRadius = isActive ? 5 : 4;
      ctx.beginPath();
      ctx.arc(screenStart.x, screenStart.y, endpointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(screenEnd.x, screenEnd.y, endpointRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw distance label
      const midX = (screenStart.x + screenEnd.x) / 2;
      const midY = (screenStart.y + screenEnd.y) / 2;

      // Format distance (assuming meters, convert to readable units)
      let labelText: string;
      if (distance < 0.01) {
        labelText = `${(distance * 1000).toFixed(1)} mm`;
      } else if (distance < 1) {
        labelText = `${(distance * 100).toFixed(1)} cm`;
      } else {
        labelText = `${distance.toFixed(3)} m`;
      }

      // Background for label
      ctx.font = '12px system-ui, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const padding = 4;
      const bgWidth = textMetrics.width + padding * 2;
      const bgHeight = 18;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(midX - bgWidth / 2, midY - bgHeight / 2, bgWidth, bgHeight);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(midX - bgWidth / 2, midY - bgHeight / 2, bgWidth, bgHeight);

      // Text
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, midX, midY);
    };

    // Draw completed measurements
    for (const result of measureResults) {
      drawMeasureLine(result.start, result.end, result.distance, '#2196F3', false);
    }

    // Draw active measurement
    if (measureStart && measureCurrent) {
      const dx = measureCurrent.x - measureStart.x;
      const dy = measureCurrent.y - measureStart.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      drawMeasureLine(measureStart, measureCurrent, distance, '#FF5722', true);
    }

    // Draw snap indicator
    if (measureMode && measureSnapPoint) {
      const screenSnap = {
        x: measureSnapPoint.x * transform.scale + transform.x,
        y: -measureSnapPoint.y * transform.scale + transform.y,
      };

      // Draw snap crosshair
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 1.5;
      const snapSize = 12;

      ctx.beginPath();
      ctx.moveTo(screenSnap.x - snapSize, screenSnap.y);
      ctx.lineTo(screenSnap.x + snapSize, screenSnap.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(screenSnap.x, screenSnap.y - snapSize);
      ctx.lineTo(screenSnap.x, screenSnap.y + snapSize);
      ctx.stroke();

      // Draw snap circle
      ctx.beginPath();
      ctx.arc(screenSnap.x, screenSnap.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [drawing, transform, showHiddenLines, canvasSize, overrideEngine, overridesEnabled, entityColorMap, useIfcMaterials, measureMode, measureStart, measureCurrent, measureResults, measureSnapPoint]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={CANVAS_STYLE}
    />
  );
}

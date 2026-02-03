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
import { X, Download, Eye, EyeOff, Maximize2, ZoomIn, ZoomOut, Loader2, Printer, GripVertical, MoreHorizontal, RefreshCw, Pin, PinOff, Palette, Ruler, Trash2, FileText, Shapes, Box } from 'lucide-react';
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
  renderFrame,
  renderTitleBlock,
  calculateDrawingTransform,
  type Drawing2D,
  type DrawingLine,
  type SectionConfig,
  type ElementData,
  type TitleBlockExtras,
} from '@ifc-lite/drawing-2d';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { DrawingSettingsPanel } from './DrawingSettingsPanel';
import { SheetSetupPanel } from './SheetSetupPanel';
import { TitleBlockEditor } from './TitleBlockEditor';

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

export function Section2DPanel(): React.ReactElement | null {
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

  // Sheet state
  const activeSheet = useViewerStore((s) => s.activeSheet);
  const sheetEnabled = useViewerStore((s) => s.sheetEnabled);
  const sheetPanelVisible = useViewerStore((s) => s.sheetPanelVisible);
  const setSheetPanelVisible = useViewerStore((s) => s.setSheetPanelVisible);
  const titleBlockEditorVisible = useViewerStore((s) => s.titleBlockEditorVisible);
  const setTitleBlockEditorVisible = useViewerStore((s) => s.setTitleBlockEditorVisible);

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
  const { geometryResult, ifcDataStore } = useIfc();

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
  // Cache sheet drawing transform when pinned (to keep model fixed in place)
  const cachedSheetTransformRef = useRef<{ translateX: number; translateY: number; scaleFactor: number } | null>(null);

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

    // Parse symbolic representations if enabled (for hybrid mode)
    let symbolicLines: DrawingLine[] = [];
    let entitiesWithSymbols = new Set<number>();

    if (displayOptions.useSymbolicRepresentations && ifcDataStore?.source) {
      try {
        setDrawingProgress(5, 'Parsing symbolic representations...');

        // Initialize geometry processor for WASM access
        const processor = new GeometryProcessor();
        await processor.init();

        // Parse symbolic representations (Plan, Annotation, FootPrint)
        const symbolicCollection = processor.parseSymbolicRepresentations(ifcDataStore.source);

        if (symbolicCollection && !symbolicCollection.isEmpty) {
          setDrawingProgress(15, `Found ${symbolicCollection.totalCount} symbolic items...`);

          // Process polylines
          for (let i = 0; i < symbolicCollection.polylineCount; i++) {
            const poly = symbolicCollection.getPolyline(i);
            if (!poly) continue;

            entitiesWithSymbols.add(poly.expressId);
            const points = poly.points;
            const pointCount = poly.pointCount;

            // Convert points to DrawingLine segments
            for (let j = 0; j < pointCount - 1; j++) {
              const x1 = points[j * 2];
              const y1 = points[j * 2 + 1];
              const x2 = points[(j + 1) * 2];
              const y2 = points[(j + 1) * 2 + 1];
              symbolicLines.push({
                line: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
                category: 'silhouette',
                visibility: 'visible',
                entityId: poly.expressId,
                ifcType: poly.ifcType,
                modelIndex: 0,
                depth: 0,
              });
            }

            // Close the polyline if needed
            if (poly.isClosed && pointCount > 2) {
              const x1 = points[(pointCount - 1) * 2];
              const y1 = points[(pointCount - 1) * 2 + 1];
              const x2 = points[0];
              const y2 = points[1];
              symbolicLines.push({
                line: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
                category: 'silhouette',
                visibility: 'visible',
                entityId: poly.expressId,
                ifcType: poly.ifcType,
                modelIndex: 0,
                depth: 0,
              });
            }
          }

          // Process circles/arcs (tessellate to line segments)
          for (let i = 0; i < symbolicCollection.circleCount; i++) {
            const circle = symbolicCollection.getCircle(i);
            if (!circle) continue;

            entitiesWithSymbols.add(circle.expressId);
            const numSegments = circle.isFullCircle ? 32 : 16;
            const startAngle = circle.startAngle;
            const endAngle = circle.endAngle;

            for (let j = 0; j < numSegments; j++) {
              const t1 = j / numSegments;
              const t2 = (j + 1) / numSegments;
              const a1 = startAngle + t1 * (endAngle - startAngle);
              const a2 = startAngle + t2 * (endAngle - startAngle);

              symbolicLines.push({
                line: {
                  start: {
                    x: circle.centerX + circle.radius * Math.cos(a1),
                    y: circle.centerY + circle.radius * Math.sin(a1),
                  },
                  end: {
                    x: circle.centerX + circle.radius * Math.cos(a2),
                    y: circle.centerY + circle.radius * Math.sin(a2),
                  },
                },
                category: 'silhouette',
                visibility: 'visible',
                entityId: circle.expressId,
                ifcType: circle.ifcType,
                modelIndex: 0,
                depth: 0,
              });
            }
          }

          console.log(`[Section2DPanel] Parsed ${entitiesWithSymbols.size} entities with symbolic representations, ${symbolicLines.length} lines`);
        } else {
          console.log('[Section2DPanel] No symbolic representations found, using section cuts only');
        }

        processor.dispose();
      } catch (error) {
        console.warn('Symbolic representation parsing failed, falling back to section cuts only:', error);
        symbolicLines = [];
        entitiesWithSymbols = new Set<number>();
      }
    }

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

      // Adjust progress to account for symbolic parsing phase (0-20%)
      const progressOffset = symbolicLines.length > 0 ? 20 : 0;
      const progressScale = symbolicLines.length > 0 ? 0.8 : 1;
      const progressCallback = (stage: string, prog: number) => {
        setDrawingProgress(progressOffset + prog * 100 * progressScale, stage);
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

      // If we have symbolic representations, create a hybrid drawing
      if (symbolicLines.length > 0 && entitiesWithSymbols.size > 0) {
        // Filter out section cut lines for entities that have symbolic representations
        const filteredLines = result.lines.filter((line: DrawingLine) =>
          line.entityId === undefined || !entitiesWithSymbols.has(line.entityId)
        );

        // Also filter cut polygons for entities with symbols
        const filteredCutPolygons = result.cutPolygons?.filter((poly: { entityId?: number }) =>
          poly.entityId === undefined || !entitiesWithSymbols.has(poly.entityId)
        ) ?? [];

        // Combine filtered section cuts with symbolic lines
        const combinedLines = [...filteredLines, ...symbolicLines];

        // Recalculate bounds with combined lines
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const line of combinedLines) {
          minX = Math.min(minX, line.line.start.x, line.line.end.x);
          minY = Math.min(minY, line.line.start.y, line.line.end.y);
          maxX = Math.max(maxX, line.line.start.x, line.line.end.x);
          maxY = Math.max(maxY, line.line.start.y, line.line.end.y);
        }

        // Create hybrid drawing
        const hybridDrawing: Drawing2D = {
          ...result,
          lines: combinedLines,
          cutPolygons: filteredCutPolygons,
          bounds: {
            min: { x: isFinite(minX) ? minX : result.bounds.min.x, y: isFinite(minY) ? minY : result.bounds.min.y },
            max: { x: isFinite(maxX) ? maxX : result.bounds.max.x, y: isFinite(maxY) ? maxY : result.bounds.max.y },
          },
          stats: {
            ...result.stats,
            cutLineCount: combinedLines.length,
          },
        };

        console.log(`[Section2DPanel] Hybrid drawing: ${filteredLines.length} section cut lines (filtered from ${result.lines.length}), ${symbolicLines.length} symbolic lines, ${entitiesWithSymbols.size} entities with symbols`);
        setDrawing(hybridDrawing);
      } else {
        setDrawing(result);
      }

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
    ifcDataStore,
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
    // Apply axis-specific inverse transforms (matching canvas rendering)
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down'; // Only flip Y for front/side views
    const flipX = currentAxis === 'side'; // Flip X for side view

    // Inverse of: screenX = drawingX * scaleX + transform.x
    // where scaleX = flipX ? -scale : scale
    const scaleX = flipX ? -viewTransform.scale : viewTransform.scale;
    const scaleY = flipY ? -viewTransform.scale : viewTransform.scale;

    const x = (screenX - viewTransform.x) / scaleX;
    const y = (screenY - viewTransform.y) / scaleY;
    return { x, y };
  }, [viewTransform, sectionPlane.axis]);

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

    // Sheet mode: fit the entire paper into view
    if (sheetEnabled && activeSheet) {
      const paperWidth = activeSheet.paper.widthMm;
      const paperHeight = activeSheet.paper.heightMm;

      // Calculate scale to fit paper with padding (10% margin on each side)
      const padding = 0.1;
      const availableWidth = rect.width * (1 - 2 * padding);
      const availableHeight = rect.height * (1 - 2 * padding);
      const scaleX = availableWidth / paperWidth;
      const scaleY = availableHeight / paperHeight;
      const scale = Math.min(scaleX, scaleY);

      // Center the paper in the view
      setViewTransform({
        scale,
        x: (rect.width - paperWidth * scale) / 2,
        y: (rect.height - paperHeight * scale) / 2,
      });
      return;
    }

    // Non-sheet mode: fit the drawing bounds
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

    // Center the drawing in the view with axis-specific transforms
    // Must match the canvas rendering transforms:
    // - 'down' (plan view): no Y flip
    // - 'front'/'side': Y flip
    // - 'side': X flip
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down';
    const flipX = currentAxis === 'side';

    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;

    // Apply transforms matching canvas rendering
    const adjustedCenterX = flipX ? -centerX : centerX;
    const adjustedCenterY = flipY ? -centerY : centerY;

    setViewTransform({
      scale,
      x: rect.width / 2 - adjustedCenterX * scale,
      y: rect.height / 2 - adjustedCenterY * scale,
    });
  }, [drawing, sheetEnabled, activeSheet, sectionPlane.axis]);

  // Track axis changes for forced fit-to-view
  const lastFitAxisRef = useRef(sectionPlane.axis);

  // Set needsFit when axis changes
  useEffect(() => {
    if (sectionPlane.axis !== prevAxisRef.current) {
      prevAxisRef.current = sectionPlane.axis;
      setNeedsFit(true);  // Force fit when axis changes
      cachedSheetTransformRef.current = null;  // Clear cached transform for new axis
    }
  }, [sectionPlane.axis]);

  // Track previous sheet mode to detect toggle
  const prevSheetEnabledRef = useRef(sheetEnabled);
  useEffect(() => {
    if (sheetEnabled !== prevSheetEnabledRef.current) {
      prevSheetEnabledRef.current = sheetEnabled;
      cachedSheetTransformRef.current = null;  // Clear cached transform
      // Auto-fit when sheet mode is toggled
      if (status === 'ready' && drawing && containerRef.current) {
        const timeout = setTimeout(() => {
          fitToView();
        }, 50);
        return () => clearTimeout(timeout);
      }
    }
  }, [sheetEnabled, status, drawing, fitToView]);

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

    // Convert mm on paper to model units (meters)
    // At 1:100 scale, 1mm on paper = 0.1m in model space
    // Formula: modelUnits = paperMm * scale / 1000
    const mmToModel = (mm: number) => mm * scale / 1000;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Axis-specific flipping (matching canvas rendering)
    // - 'down' (plan view): DON'T flip Y so north (Z+) is up
    // - 'front' and 'side': flip Y so height (Y+) is up
    // - 'side': also flip X to look from conventional direction
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down';
    const flipX = currentAxis === 'side';

    // Helper to get polygon path with axis-specific coordinate transformation
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      const transformPt = (x: number, y: number) => ({
        x: flipX ? -x : x,
        y: flipY ? -y : y,
      });

      let path = '';
      if (polygon.outer.length > 0) {
        const first = transformPt(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = transformPt(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = transformPt(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = transformPt(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // Calculate viewBox with axis-specific flipping
    const viewBoxMinX = flipX ? -viewMinX - viewWidth : viewMinX;
    const viewBoxMinY = flipY ? -viewMinY - viewHeight : viewMinY;

    // Start building SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidthMm.toFixed(2)}mm"
     height="${svgHeightMm.toFixed(2)}mm"
     viewBox="${viewBoxMinX.toFixed(4)} ${viewBoxMinY.toFixed(4)} ${viewWidth.toFixed(4)} ${viewHeight.toFixed(4)}">
  <rect x="${viewBoxMinX.toFixed(4)}" y="${viewBoxMinY.toFixed(4)}" width="${viewWidth.toFixed(4)}" height="${viewHeight.toFixed(4)}" fill="#FFFFFF"/>
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
      // Convert line weight (mm on paper) to model units
      const svgLineWeight = mmToModel(lineWeight);
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

      // Convert line width from mm on paper to model units
      const svgLineWidth = mmToModel(lineWidth);
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray.split(' ').map(d => mmToModel(parseFloat(d)).toFixed(4)).join(' ')}"` : '';

      // Transform line endpoints with axis-specific flipping
      const startT = { x: flipX ? -start.x : start.x, y: flipY ? -start.y : start.y };
      const endT = { x: flipX ? -end.x : end.x, y: flipY ? -end.y : end.y };
      svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '  </g>\n';

    // 4. DRAW COMPLETED MEASUREMENTS
    if (measure2DResults.length > 0) {
      svg += '  <g id="measurements">\n';
      for (const result of measure2DResults) {
        const { start, end, distance } = result;
        // Transform measurement points with axis-specific flipping
        const startT = { x: flipX ? -start.x : start.x, y: flipY ? -start.y : start.y };
        const endT = { x: flipX ? -end.x : end.x, y: flipY ? -end.y : end.y };
        const midX = (startT.x + endT.x) / 2;
        const midY = (startT.y + endT.y) / 2;
        const labelText = formatDistance(distance);

        // Measurement styling (all in mm on paper, converted to model units)
        const measureColor = '#2196F3';
        const measureLineWidth = mmToModel(0.4);  // 0.4mm line on paper
        const endpointRadius = mmToModel(1.5);    // 1.5mm radius on paper

        // Draw line
        svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${measureColor}" stroke-width="${measureLineWidth.toFixed(4)}"/>\n`;

        // Draw endpoints
        svg += `    <circle cx="${startT.x.toFixed(4)}" cy="${startT.y.toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;
        svg += `    <circle cx="${endT.x.toFixed(4)}" cy="${endT.y.toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;

        // Draw label background and text
        // Use 3mm text height on paper for readable labels
        const fontSize = mmToModel(3);
        const labelWidth = labelText.length * fontSize * 0.6;  // Approximate text width
        const labelHeight = fontSize * 1.4;
        const labelStroke = mmToModel(0.2);

        svg += `    <rect x="${(midX - labelWidth / 2).toFixed(4)}" y="${(midY - labelHeight / 2).toFixed(4)}" width="${labelWidth.toFixed(4)}" height="${labelHeight.toFixed(4)}" fill="rgba(255,255,255,0.95)" stroke="${measureColor}" stroke-width="${labelStroke.toFixed(4)}"/>\n`;
        svg += `    <text x="${midX.toFixed(4)}" y="${midY.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle" font-weight="500">${escapeXml(labelText)}</text>\n`;
      }
      svg += '  </g>\n';
    }

    svg += '</svg>';
    return svg;
  }, [drawing, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, measure2DResults, formatDistance, sectionPlane.axis]);

  // Generate SVG with drawing sheet (frame, title block, scale bar)
  // This generates coordinates directly in paper mm space (like the canvas rendering)
  const generateSheetSVG = useCallback((): string | null => {
    if (!drawing || !activeSheet) return null;

    const { bounds } = drawing;

    // Sheet dimensions in mm
    const paperWidth = activeSheet.paper.widthMm;
    const paperHeight = activeSheet.paper.heightMm;
    const viewport = activeSheet.viewportBounds;

    // Calculate transform to fit drawing into viewport
    const drawingTransform = calculateDrawingTransform(
      { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y },
      viewport,
      activeSheet.scale
    );

    const { translateX, translateY, scaleFactor } = drawingTransform;

    // Axis-specific flipping (matching canvas rendering)
    // - 'down' (plan view): DON'T flip Y so north (Z+) is up
    // - 'front' and 'side': flip Y so height (Y+) is up
    // - 'side': also flip X to look from conventional direction
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down';
    const flipX = currentAxis === 'side';

    // Helper: convert model coordinates to paper mm (matching canvas rendering exactly)
    const modelToPaper = (x: number, y: number): { x: number; y: number } => {
      const adjustedX = flipX ? -x : x;
      const adjustedY = flipY ? -y : y;
      return {
        x: adjustedX * scaleFactor + translateX,
        y: adjustedY * scaleFactor + translateY,
      };
    };

    // Start building SVG (paper coordinates in mm)
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperWidth}mm"
     height="${paperHeight}mm"
     viewBox="0 0 ${paperWidth} ${paperHeight}">
  <!-- Background -->
  <rect x="0" y="0" width="${paperWidth}" height="${paperHeight}" fill="#FFFFFF"/>

`;

    // Create clipping path for viewport FIRST (so it can be used by drawing content)
    svg += `  <defs>
    <clipPath id="viewport-clip">
      <rect x="${viewport.x.toFixed(2)}" y="${viewport.y.toFixed(2)}" width="${viewport.width.toFixed(2)}" height="${viewport.height.toFixed(2)}"/>
    </clipPath>
  </defs>

`;

    // Drawing content FIRST (so frame/title block render on top)
    svg += `  <g id="drawing-content" clip-path="url(#viewport-clip)">
`;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Helper to get polygon path in paper coordinates
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      let path = '';
      if (polygon.outer.length > 0) {
        const first = modelToPaper(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = modelToPaper(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = modelToPaper(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = modelToPaper(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // Render polygon fills
    svg += '    <g id="polygon-fills">\n';
    for (const polygon of drawing.cutPolygons) {
      let fillColor = getFillColorForType(polygon.ifcType);
      let opacity = 1;

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
      if (pathData) {
        svg += `      <path d="${pathData}" fill="${fillColor}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
      }
    }
    svg += '    </g>\n';

    // Render polygon outlines
    svg += '    <g id="polygon-outlines">\n';
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
      if (pathData) {
        // lineWeight is in mm on paper
        const svgLineWeight = lineWeight * 0.3; // Scale down for better appearance
        svg += `      <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
      }
    }
    svg += '    </g>\n';

    // Render drawing lines
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '    <g id="drawing-lines">\n';
    for (const line of drawing.lines) {
      if (line.category === 'cut') continue;
      if (!displayOptions.showHiddenLines && line.visibility === 'hidden') continue;

      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
          end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'projection': lineWidth = 0.25; break;
        case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashArray = '1 0.5'; break;
        case 'silhouette': lineWidth = 0.35; break;
        case 'crease': lineWidth = 0.18; break;
        case 'boundary': lineWidth = 0.25; break;
        case 'annotation': lineWidth = 0.13; break;
      }

      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '1 0.5';
        lineWidth *= 0.7;
      }

      const paperStart = modelToPaper(start.x, start.y);
      const paperEnd = modelToPaper(end.x, end.y);

      // lineWidth is in mm on paper
      const svgLineWidth = lineWidth * 0.3;
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : '';
      svg += `      <line x1="${paperStart.x.toFixed(4)}" y1="${paperStart.y.toFixed(4)}" x2="${paperEnd.x.toFixed(4)}" y2="${paperEnd.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '    </g>\n';

    svg += '  </g>\n\n';

    // Render frame (on top of drawing content)
    const frameResult = renderFrame(activeSheet.paper, activeSheet.frame);
    svg += frameResult.svgElements;
    svg += '\n';

    // Render title block with scale bar and north arrow inside
    // Pass effectiveScaleFactor from the actual transform (not just configured scale)
    // This ensures scale bar shows correct values when dynamically scaled
    const titleBlockExtras: TitleBlockExtras = {
      scaleBar: activeSheet.scaleBar,
      northArrow: activeSheet.northArrow,
      scale: activeSheet.scale,
      effectiveScaleFactor: scaleFactor,
    };
    const titleBlockResult = renderTitleBlock(
      activeSheet.titleBlock,
      frameResult.innerBounds,
      activeSheet.revisions,
      titleBlockExtras
    );
    svg += titleBlockResult.svgElements;
    svg += '\n';

    svg += '</svg>';
    return svg;
  }, [drawing, activeSheet, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine]);

  // Export SVG
  const handleExportSVG = useCallback(() => {
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = (sheetEnabled && activeSheet)
      ? `${activeSheet.name.replace(/\s+/g, '-')}-${sectionPlane.axis}-${sectionPlane.position}.svg`
      : `section-${sectionPlane.axis}-${sectionPlane.position}.svg`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane]);

  // Close panel
  const handleClose = useCallback(() => {
    setDrawingPanelVisible(false);
  }, [setDrawingPanelVisible]);

  // Toggle options
  const toggle3DOverlay = useCallback(() => {
    updateDisplayOptions({ show3DOverlay: !displayOptions.show3DOverlay });
  }, [displayOptions.show3DOverlay, updateDisplayOptions]);

  const toggleSymbolicRepresentations = useCallback(() => {
    updateDisplayOptions({ useSymbolicRepresentations: !displayOptions.useSymbolicRepresentations });
    // Clear current drawing to trigger regeneration with new mode
    setDrawing(null);
    setDrawingStatus('idle');
  }, [displayOptions.useSymbolicRepresentations, updateDisplayOptions, setDrawing, setDrawingStatus]);

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
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG();
    if (!svg) return;

    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Please allow popups to print');
      return;
    }

    const title = (sheetEnabled && activeSheet)
      ? `${activeSheet.name} - ${sectionPlane.axis} at ${sectionPlane.position}%`
      : `Section Drawing - ${sectionPlane.axis} at ${sectionPlane.position}%`;

    // Write print-friendly HTML with the SVG
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            @media print {
              @page { margin: ${(sheetEnabled && activeSheet) ? '0' : '1cm'}; }
              body { margin: 0; }
            }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: ${(sheetEnabled && activeSheet) ? '0' : '20px'};
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
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane]);

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

              {/* Symbolic vs Section Cut toggle */}
              <Button
                variant={displayOptions.useSymbolicRepresentations ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={toggleSymbolicRepresentations}
                title={displayOptions.useSymbolicRepresentations ? 'Symbolic representations (Plan)' : 'Section cut (Body)'}
              >
                {displayOptions.useSymbolicRepresentations ? <Shapes className="h-4 w-4" /> : <Box className="h-4 w-4" />}
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

              {/* Drawing Sheet Setup */}
              <Button
                variant={sheetPanelVisible || sheetEnabled ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={() => setSheetPanelVisible(!sheetPanelVisible)}
                title="Drawing sheet setup"
                className="relative"
              >
                <FileText className="h-4 w-4" />
                {sheetEnabled && !sheetPanelVisible && (
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
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={toggle3DOverlay}>
                    {displayOptions.show3DOverlay ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                    3D Overlay {displayOptions.show3DOverlay ? 'On' : 'Off'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleSymbolicRepresentations}>
                    {displayOptions.useSymbolicRepresentations ? <Shapes className="h-4 w-4 mr-2" /> : <Box className="h-4 w-4 mr-2" />}
                    {displayOptions.useSymbolicRepresentations ? 'Symbolic (Plan)' : 'Section Cut (Body)'}
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
                  <DropdownMenuItem onClick={() => setSheetPanelVisible(true)}>
                    <FileText className="h-4 w-4 mr-2" />
                    Sheet Setup {sheetEnabled ? '(On)' : ''}
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

        {status === 'ready' && drawing && (drawing.cutPolygons.length > 0 || drawing.lines?.length > 0) && (
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
              sheetEnabled={sheetEnabled}
              activeSheet={activeSheet}
              sectionAxis={sectionPlane.axis}
              isPinned={isPinned}
              cachedSheetTransformRef={cachedSheetTransformRef}
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

        {status === 'ready' && drawing && drawing.cutPolygons.length === 0 && (!drawing.lines || drawing.lines.length === 0) && (
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

      {/* Sheet Setup Panel - slides in from right */}
      {sheetPanelVisible && (
        <div className="absolute top-0 right-0 bottom-0 w-72 z-50 shadow-xl">
          <SheetSetupPanel
            onClose={() => setSheetPanelVisible(false)}
            onOpenTitleBlockEditor={() => setTitleBlockEditorVisible(true)}
          />
        </div>
      )}

      {/* Title Block Editor Modal */}
      <TitleBlockEditor
        open={titleBlockEditorVisible}
        onOpenChange={setTitleBlockEditorVisible}
      />
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
  // Sheet mode props
  sheetEnabled?: boolean;
  activeSheet?: import('@ifc-lite/drawing-2d').DrawingSheet | null;
  // Section plane info for axis-specific rendering
  sectionAxis: 'down' | 'front' | 'side';
  // Pinned mode - keep model fixed in place on sheet
  isPinned?: boolean;
  cachedSheetTransformRef?: React.MutableRefObject<{ translateX: number; translateY: number; scaleFactor: number } | null>;
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
  sheetEnabled = false,
  activeSheet = null,
  sectionAxis,
  isPinned = false,
  cachedSheetTransformRef,
}: Drawing2DCanvasProps): React.ReactElement {
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

    // Clear with light gray background (shows paper edge when in sheet mode)
    ctx.fillStyle = sheetEnabled && activeSheet ? '#e5e5e5' : '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET MODE: Render paper, frame, title block, then drawing in viewport
    // ═══════════════════════════════════════════════════════════════════════
    if (sheetEnabled && activeSheet) {
      const paper = activeSheet.paper;
      const frame = activeSheet.frame;
      const titleBlock = activeSheet.titleBlock;
      const viewport = activeSheet.viewportBounds;
      const scaleBar = activeSheet.scaleBar;
      const northArrow = activeSheet.northArrow;

      // Helper: convert sheet mm to screen pixels
      const mmToScreen = (mm: number) => mm * transform.scale;
      const mmToScreenX = (x: number) => x * transform.scale + transform.x;
      const mmToScreenY = (y: number) => y * transform.scale + transform.y;

      // ─────────────────────────────────────────────────────────────────────
      // 1. Draw paper background (white with shadow)
      // ─────────────────────────────────────────────────────────────────────
      ctx.save();
      // Paper shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 10 * (transform.scale > 0.5 ? 1 : transform.scale * 2);
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );
      ctx.restore();

      // Paper border
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );

      // ─────────────────────────────────────────────────────────────────────
      // 2. Draw frame borders
      // ─────────────────────────────────────────────────────────────────────
      const frameLeft = frame.margins.left + frame.margins.bindingMargin;
      const frameTop = frame.margins.top;
      const frameRight = paper.widthMm - frame.margins.right;
      const frameBottom = paper.heightMm - frame.margins.bottom;
      const frameWidth = frameRight - frameLeft;
      const frameHeight = frameBottom - frameTop;

      // Outer border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(frame.border.outerLineWeight));
      ctx.strokeRect(
        mmToScreenX(frameLeft),
        mmToScreenY(frameTop),
        mmToScreen(frameWidth),
        mmToScreen(frameHeight)
      );

      // Inner border (if gap > 0)
      if (frame.border.borderGap > 0) {
        const innerLeft = frameLeft + frame.border.borderGap;
        const innerTop = frameTop + frame.border.borderGap;
        const innerWidth = frameWidth - 2 * frame.border.borderGap;
        const innerHeight = frameHeight - 2 * frame.border.borderGap;

        ctx.lineWidth = Math.max(0.5, mmToScreen(frame.border.innerLineWeight));
        ctx.strokeRect(
          mmToScreenX(innerLeft),
          mmToScreenY(innerTop),
          mmToScreen(innerWidth),
          mmToScreen(innerHeight)
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // 3. Draw title block
      // ─────────────────────────────────────────────────────────────────────
      const innerLeft = frameLeft + frame.border.borderGap;
      const innerTop = frameTop + frame.border.borderGap;
      const innerWidth = frameWidth - 2 * frame.border.borderGap;
      const innerHeight = frameHeight - 2 * frame.border.borderGap;

      let tbX: number, tbY: number, tbW: number, tbH: number;
      switch (titleBlock.position) {
        case 'bottom-right':
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'bottom-full':
          tbW = innerWidth;
          tbH = titleBlock.heightMm;
          tbX = innerLeft;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'right-strip':
          tbW = titleBlock.widthMm;
          tbH = innerHeight;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop;
          break;
        default:
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
      }

      // Title block border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(titleBlock.borderWeight));
      ctx.strokeRect(
        mmToScreenX(tbX),
        mmToScreenY(tbY),
        mmToScreen(tbW),
        mmToScreen(tbH)
      );

      // Title block fields - calculate row heights based on font sizes
      const logoSpace = titleBlock.logo ? 50 : 0;
      const revisionSpace = titleBlock.showRevisionHistory ? 20 : 0;
      const availableWidth = tbW - logoSpace - 5;
      const availableHeight = tbH - revisionSpace - 4;
      const numCols = 2;

      // Group fields by row
      const fieldsByRow = new Map<number, typeof titleBlock.fields>();
      for (const field of titleBlock.fields) {
        const row = field.row ?? 0;
        if (!fieldsByRow.has(row)) fieldsByRow.set(row, []);
        fieldsByRow.get(row)!.push(field);
      }

      // Calculate minimum height needed for each row based on its largest font
      const rowCount = Math.max(...Array.from(fieldsByRow.keys()), 0) + 1;
      const rowHeights: number[] = [];
      let totalMinHeight = 0;

      for (let r = 0; r < rowCount; r++) {
        const fields = fieldsByRow.get(r) || [];
        const maxFontSize = fields.length > 0 ? Math.max(...fields.map(f => f.fontSize)) : 3;
        const labelSize = Math.min(maxFontSize * 0.5, 2.2);
        const minRowHeight = labelSize + 1 + maxFontSize + 2;
        rowHeights.push(minRowHeight);
        totalMinHeight += minRowHeight;
      }

      // Scale row heights if they exceed available space
      const rowScaleFactor = totalMinHeight > availableHeight ? availableHeight / totalMinHeight : 1;
      const scaledRowHeights = rowHeights.map(h => h * rowScaleFactor);

      const colWidth = availableWidth / numCols;
      const gridStartX = tbX + logoSpace + 2;
      const gridStartY = tbY + 2;

      // Calculate row Y positions
      const rowYPositions: number[] = [gridStartY];
      for (let i = 0; i < scaledRowHeights.length - 1; i++) {
        rowYPositions.push(rowYPositions[i] + scaledRowHeights[i]);
      }

      // Draw grid lines
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(0.5, mmToScreen(titleBlock.gridWeight));

      // Horizontal lines
      for (let i = 1; i < rowCount; i++) {
        const lineY = rowYPositions[i];
        ctx.beginPath();
        ctx.moveTo(mmToScreenX(gridStartX), mmToScreenY(lineY));
        ctx.lineTo(mmToScreenX(gridStartX + availableWidth - 4), mmToScreenY(lineY));
        ctx.stroke();
      }

      // Vertical dividers (for rows with multiple columns)
      for (const [row, fields] of fieldsByRow) {
        const hasMultipleCols = fields.some(f => (f.colSpan ?? 1) < 2);
        if (hasMultipleCols) {
          const centerX = gridStartX + colWidth;
          const lineY1 = rowYPositions[row];
          const lineY2 = rowYPositions[row] + scaledRowHeights[row];
          ctx.beginPath();
          ctx.moveTo(mmToScreenX(centerX), mmToScreenY(lineY1));
          ctx.lineTo(mmToScreenX(centerX), mmToScreenY(lineY2));
          ctx.stroke();
        }
      }

      // Render field text - scale proportionally with zoom
      for (const [row, fields] of fieldsByRow) {
        const rowY = rowYPositions[row];
        if (rowY === undefined) continue;

        const rowH = scaledRowHeights[row] ?? 5;
        const screenRowH = mmToScreen(rowH);

        // Skip if row is too small to be readable
        if (screenRowH < 4) continue;

        for (const field of fields) {
          const col = field.col ?? 0;
          const fieldX = gridStartX + col * colWidth + 1.5;

          // Calculate font sizes in mm (accounting for compressed rows)
          const effectiveScale = rowScaleFactor < 1 ? rowScaleFactor : 1;
          const labelFontMm = Math.min(field.fontSize * 0.45, 2.2) * Math.max(effectiveScale, 0.7);
          const valueFontMm = field.fontSize * Math.max(effectiveScale, 0.7);

          // Convert to screen pixels - scales naturally with zoom
          const screenLabelFont = mmToScreen(labelFontMm);
          const screenValueFont = mmToScreen(valueFontMm);

          // Skip if too small to read
          if (screenLabelFont < 3) continue;

          const screenRowY = mmToScreenY(rowY);
          const screenFieldX = mmToScreenX(fieldX);

          // Label
          ctx.font = `${screenLabelFont}px Arial, sans-serif`;
          ctx.fillStyle = '#666666';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(field.label, screenFieldX, screenRowY + mmToScreen(0.3));

          // Value below label (spacing in mm, converted to screen)
          const valueY = screenRowY + mmToScreen(labelFontMm + 0.5);
          ctx.font = `${field.fontWeight === 'bold' ? 'bold ' : ''}${screenValueFont}px Arial, sans-serif`;
          ctx.fillStyle = '#000000';
          ctx.fillText(field.value, screenFieldX, valueY);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 4. Clip to viewport and draw model content
      // ─────────────────────────────────────────────────────────────────────
      ctx.save();

      // Create clip region for viewport
      ctx.beginPath();
      ctx.rect(
        mmToScreenX(viewport.x),
        mmToScreenY(viewport.y),
        mmToScreen(viewport.width),
        mmToScreen(viewport.height)
      );
      ctx.clip();

      // Calculate drawing transform to fit in viewport
      const drawingBounds = {
        minX: drawing.bounds.min.x,
        minY: drawing.bounds.min.y,
        maxX: drawing.bounds.max.x,
        maxY: drawing.bounds.max.y,
      };

      // Axis-specific flipping
      const flipY = sectionAxis !== 'down';
      const flipX = sectionAxis === 'side';

      // Use cached transform when pinned, otherwise calculate new one
      let drawingTransform: { translateX: number; translateY: number; scaleFactor: number };

      if (isPinned && cachedSheetTransformRef?.current) {
        // Use cached transform to keep model fixed in place
        drawingTransform = cachedSheetTransformRef.current;
      } else {
        // Calculate new transform
        const baseTransform = calculateDrawingTransform(drawingBounds, viewport, activeSheet.scale);

        // Adjust for axis-specific flipping
        // calculateDrawingTransform assumes Y-flip (uses maxY), but for 'down' view we don't flip Y
        drawingTransform = {
          ...baseTransform,
          translateY: flipY
            ? baseTransform.translateY
            : baseTransform.translateY - (drawingBounds.maxY + drawingBounds.minY) * baseTransform.scaleFactor,
        };

        // Cache the transform for pinned mode
        if (cachedSheetTransformRef) {
          cachedSheetTransformRef.current = drawingTransform;
        }
      }

      // Apply combined transform: sheet mm -> screen, then drawing coords -> sheet mm
      // Drawing coord (meters) * scaleFactor = sheet mm, + translateX/Y
      // Then sheet mm -> screen via mmToScreenX/Y
      const drawModelContent = () => {
        // Determine flip behavior based on section axis
        // - 'down' (plan view): DON'T flip Y so north (Z+) is up
        // - 'front' and 'side': flip Y so height (Y+) is up
        // - 'side': also flip X to look from conventional direction

        // For each polygon/line, transform from model coords to screen coords
        const modelToScreen = (x: number, y: number) => {
          // Apply axis-specific flipping
          const adjustedX = flipX ? -x : x;
          const adjustedY = flipY ? -y : y;
          // Model to sheet mm
          const sheetX = adjustedX * drawingTransform.scaleFactor + drawingTransform.translateX;
          const sheetY = adjustedY * drawingTransform.scaleFactor + drawingTransform.translateY;
          // Sheet mm to screen
          return { x: mmToScreenX(sheetX), y: mmToScreenY(sheetY) };
        };

        // Line width in screen pixels (convert mm to screen)
        const mmLineToScreen = (mmWeight: number) => Math.max(0.5, mmToScreen(mmWeight / drawingTransform.scaleFactor * 0.001));

        // Fill cut polygons
        for (const polygon of drawing.cutPolygons) {
          let fillColor = getFillColorForType(polygon.ifcType);
          let opacity = 1;

          if (useIfcMaterials) {
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

          ctx.globalAlpha = opacity;
          ctx.fillStyle = fillColor;
          ctx.beginPath();

          if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.fill('evenodd');
          ctx.globalAlpha = 1;
        }

        // Stroke polygon outlines
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
          ctx.lineWidth = Math.max(0.5, mmToScreen(lineWeight) * 0.3);
          ctx.beginPath();

          if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.stroke();
        }

        // Draw lines (projection, silhouette, etc.)
        const lineBounds = drawing.bounds;
        const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
        const lineMinX = lineBounds.min.x - lineMargin;
        const lineMaxX = lineBounds.max.x + lineMargin;
        const lineMinY = lineBounds.min.y - lineMargin;
        const lineMaxY = lineBounds.max.y + lineMargin;

        for (const line of drawing.lines) {
          if (line.category === 'cut') continue;
          if (!showHiddenLines && line.visibility === 'hidden') continue;

          const { start, end } = line.line;
          if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
          if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
              end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

          let strokeColor = '#000000';
          let lineWidth = 0.25;
          let dashPattern: number[] = [];

          switch (line.category) {
            case 'projection': lineWidth = 0.25; break;
            case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashPattern = [4, 2]; break;
            case 'silhouette': lineWidth = 0.35; break;
            case 'crease': lineWidth = 0.18; break;
            case 'boundary': lineWidth = 0.25; break;
            case 'annotation': lineWidth = 0.13; break;
          }

          if (line.visibility === 'hidden') {
            strokeColor = '#888888';
            dashPattern = [4, 2];
            lineWidth *= 0.7;
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(0.5, mmToScreen(lineWidth) * 0.3);
          ctx.setLineDash(dashPattern);

          const screenStart = modelToScreen(start.x, start.y);
          const screenEnd = modelToScreen(end.x, end.y);

          ctx.beginPath();
          ctx.moveTo(screenStart.x, screenStart.y);
          ctx.lineTo(screenEnd.x, screenEnd.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      };

      drawModelContent();
      ctx.restore();

      // ─────────────────────────────────────────────────────────────────────
      // 6. Draw scale bar at BOTTOM LEFT of title block
      // Uses actual drawingTransform.scaleFactor which accounts for dynamic scaling
      // ─────────────────────────────────────────────────────────────────────
      if (scaleBar.visible && tbH > 10) {
        // Position: bottom left with small margin
        const sbX = tbX + 3;
        const sbY = tbY + tbH - 8; // 8mm from bottom (leaves room for label)

        // Calculate effective scale from the actual drawing transform
        // scaleFactor = mm per meter, so effective scale ratio = 1000 / scaleFactor
        const effectiveScaleFactor = drawingTransform.scaleFactor;

        // Scale bar length: we want to show a nice round number of meters
        // Calculate how many mm on paper for the desired real-world length
        const maxBarWidth = Math.min(tbW * 0.3, 50); // Max 30% of width or 50mm

        // Find a nice round length that fits
        // Start with the configured length and adjust if needed
        let targetLengthM = scaleBar.totalLengthM;
        let sbLengthMm = targetLengthM * effectiveScaleFactor;

        // If bar would be too long, reduce the target length
        while (sbLengthMm > maxBarWidth && targetLengthM > 0.5) {
          targetLengthM = targetLengthM / 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // If bar would be too short, increase the target length
        while (sbLengthMm < maxBarWidth * 0.3 && targetLengthM < 100) {
          targetLengthM = targetLengthM * 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // Clamp to max width
        sbLengthMm = Math.min(sbLengthMm, maxBarWidth);

        // Actual length represented by the bar
        const actualTotalLength = sbLengthMm / effectiveScaleFactor;

        const sbHeight = Math.min(scaleBar.heightMm, 3);

        // Scale bar divisions
        const divisions = scaleBar.primaryDivisions;
        const divWidth = sbLengthMm / divisions;
        for (let i = 0; i < divisions; i++) {
          ctx.fillStyle = i % 2 === 0 ? scaleBar.fillColor : '#ffffff';
          ctx.fillRect(
            mmToScreenX(sbX + i * divWidth),
            mmToScreenY(sbY),
            mmToScreen(divWidth),
            mmToScreen(sbHeight)
          );
        }

        // Scale bar border
        ctx.strokeStyle = scaleBar.strokeColor;
        ctx.lineWidth = Math.max(1, mmToScreen(scaleBar.lineWeight));
        ctx.strokeRect(
          mmToScreenX(sbX),
          mmToScreenY(sbY),
          mmToScreen(sbLengthMm),
          mmToScreen(sbHeight)
        );

        // Distance labels - only at 0 and end
        const labelFontSize = Math.max(7, mmToScreen(1.8));
        ctx.font = `${labelFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'top';
        const labelScreenY = mmToScreenY(sbY + sbHeight) + 1;

        ctx.textAlign = 'left';
        ctx.fillText('0', mmToScreenX(sbX), labelScreenY);

        ctx.textAlign = 'right';
        const endLabel = actualTotalLength < 1
          ? `${(actualTotalLength * 100).toFixed(0)}cm`
          : `${actualTotalLength.toFixed(0)}m`;
        ctx.fillText(endLabel, mmToScreenX(sbX + sbLengthMm), labelScreenY);
      }

      // ─────────────────────────────────────────────────────────────────────
      // 7. Draw north arrow at BOTTOM RIGHT of title block
      // ─────────────────────────────────────────────────────────────────────
      if (northArrow.style !== 'none' && tbH > 10) {
        // Position: bottom right with margin
        const naSize = Math.min(northArrow.sizeMm, 8, tbH * 0.6);
        const naX = tbX + tbW - naSize - 5; // Right side with margin
        const naY = tbY + tbH - naSize / 2 - 3; // Bottom with margin

        ctx.save();
        ctx.translate(mmToScreenX(naX), mmToScreenY(naY));
        ctx.rotate((northArrow.rotation * Math.PI) / 180);

        // Draw arrow
        const arrowLen = mmToScreen(naSize);
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(0, -arrowLen / 2);
        ctx.lineTo(-arrowLen / 6, arrowLen / 2);
        ctx.lineTo(0, arrowLen / 3);
        ctx.lineTo(arrowLen / 6, arrowLen / 2);
        ctx.closePath();
        ctx.fill();

        // Draw "N" label
        const nFontSize = Math.max(8, mmToScreen(2.5));
        ctx.font = `bold ${nFontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('N', 0, -arrowLen / 2 - 1);

        ctx.restore();
      }

    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // NON-SHEET MODE: Original rendering (drawing coords -> screen)
      // ═══════════════════════════════════════════════════════════════════════

      // Apply transform with axis-specific flipping
      // - 'down' (plan view): DON'T flip Y so north (Z+) is up
      // - 'front' and 'side': flip Y so height (Y+) is up
      // - 'side': also flip X to look from conventional direction
      const scaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const scaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(scaleX, scaleY);

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
    }

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
      // Convert drawing coords to screen coords with axis-specific transforms
      const measureScaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const measureScaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      const screenStart = {
        x: start.x * measureScaleX + transform.x,
        y: start.y * measureScaleY + transform.y,
      };
      const screenEnd = {
        x: end.x * measureScaleX + transform.x,
        y: end.y * measureScaleY + transform.y,
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
      // Use axis-specific transforms (matching canvas rendering)
      const snapScaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const snapScaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      const screenSnap = {
        x: measureSnapPoint.x * snapScaleX + transform.x,
        y: measureSnapPoint.y * snapScaleY + transform.y,
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
  }, [drawing, transform, showHiddenLines, canvasSize, overrideEngine, overridesEnabled, entityColorMap, useIfcMaterials, measureMode, measureStart, measureCurrent, measureResults, measureSnapPoint, sheetEnabled, activeSheet, sectionAxis, isPinned]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={CANVAS_STYLE}
    />
  );
}

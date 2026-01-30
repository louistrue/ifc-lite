/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section2DPanel - 2D architectural drawing viewer panel
 *
 * Displays generated 2D drawings (floor plans, sections) with:
 * - Canvas-based rendering with pan/zoom
 * - Toggle controls for hidden lines, hatching
 * - Export to SVG functionality
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { X, Download, Eye, EyeOff, Grid3x3, Maximize2, Minimize2, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import {
  Drawing2DGenerator,
  exportToSVG,
  createSectionConfig,
  type Drawing2D,
  type SectionConfig,
  type DrawingLine,
} from '@ifc-lite/drawing-2d';

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
  const setDrawingError = useViewerStore((s) => s.setDrawing2DError);
  const displayOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const updateDisplayOptions = useViewerStore((s) => s.updateDrawing2DDisplayOptions);
  const svgContent = useViewerStore((s) => s.drawing2DSvgContent);
  const setSvgContent = useViewerStore((s) => s.setDrawing2DSvgContent);

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
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 });

  // Store hatching lines separately
  const [hatchingLines, setHatchingLines] = useState<DrawingLine[]>([]);

  // Generate drawing when panel opens
  const generateDrawing = useCallback(async () => {
    if (!geometryResult?.meshes || geometryResult.meshes.length === 0) {
      setDrawingError('No geometry loaded');
      return;
    }

    setDrawingStatus('generating');
    setDrawingProgress(0, 'Initializing...');

    try {
      const generator = new Drawing2DGenerator();
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

      // Generate hatching if enabled
      if (displayOptions.showHatching) {
        const hatches = generator.generateHatching(result);
        setHatchingLines(hatches);
      } else {
        setHatchingLines([]);
      }

      // Generate SVG content
      const svg = exportToSVG(result, {
        showHiddenLines: displayOptions.showHiddenLines,
        showHatching: displayOptions.showHatching,
        // scale is derived from the drawing config
      });
      setSvgContent(svg);

      setDrawingStatus('ready');

      // Cleanup
      generator.dispose();
    } catch (error) {
      console.error('Drawing generation failed:', error);
      setDrawingError(error instanceof Error ? error.message : 'Generation failed');
    }
  }, [
    geometryResult,
    sectionPlane,
    displayOptions,
    setDrawing,
    setDrawingStatus,
    setDrawingProgress,
    setDrawingError,
    setSvgContent,
  ]);

  // Auto-generate when panel opens and no drawing exists
  useEffect(() => {
    if (panelVisible && !drawing && status === 'idle' && geometryResult?.meshes) {
      generateDrawing();
    }
  }, [panelVisible, drawing, status, geometryResult, generateDrawing]);

  // Auto-regenerate when section plane changes (debounced)
  const sectionRef = useRef({ axis: sectionPlane.axis, position: sectionPlane.position, flipped: sectionPlane.flipped });
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

    // If panel is visible and we have geometry, regenerate
    if (panelVisible && geometryResult?.meshes && status !== 'generating') {
      // Clear existing drawing to force regeneration
      setDrawing(null);
    }
  }, [panelVisible, sectionPlane.axis, sectionPlane.position, sectionPlane.flipped, geometryResult, status, setDrawing]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPanPoint.current.x;
    const dy = e.clientY - lastPanPoint.current.y;
    lastPanPoint.current = { x: e.clientX, y: e.clientY };
    setViewTransform((prev) => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setViewTransform((prev) => {
      const newScale = Math.max(0.1, Math.min(10, prev.scale * delta));
      const scaleRatio = newScale / prev.scale;
      return {
        scale: newScale,
        x: x - (x - prev.x) * scaleRatio,
        y: y - (y - prev.y) * scaleRatio,
      };
    });
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setViewTransform((prev) => ({ ...prev, scale: Math.min(10, prev.scale * 1.2) }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewTransform((prev) => ({ ...prev, scale: Math.max(0.1, prev.scale / 1.2) }));
  }, []);

  const fitToView = useCallback(() => {
    if (!drawing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { bounds } = drawing;
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;

    if (width < 0.001 || height < 0.001) return;

    const scaleX = (rect.width - 40) / width;
    const scaleY = (rect.height - 40) / height;
    const scale = Math.min(scaleX, scaleY, 2);

    setViewTransform({
      scale,
      x: rect.width / 2 - (bounds.min.x + width / 2) * scale,
      y: rect.height / 2 + (bounds.min.y + height / 2) * scale, // Flip Y
    });
  }, [drawing]);

  // Export SVG
  const handleExportSVG = useCallback(() => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `section-${sectionPlane.axis}-${sectionPlane.position}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [svgContent, sectionPlane]);

  // Close panel
  const handleClose = useCallback(() => {
    setDrawingPanelVisible(false);
  }, [setDrawingPanelVisible]);

  // Toggle options
  const toggleHiddenLines = useCallback(() => {
    updateDisplayOptions({ showHiddenLines: !displayOptions.showHiddenLines });
  }, [displayOptions.showHiddenLines, updateDisplayOptions]);

  const toggleHatching = useCallback(() => {
    updateDisplayOptions({ showHatching: !displayOptions.showHatching });
  }, [displayOptions.showHatching, updateDisplayOptions]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!panelVisible) return null;

  // Panel sizing: small corner overlay or expanded fullscreen
  const panelClasses = isExpanded
    ? 'absolute inset-4 z-40'
    : 'absolute bottom-4 left-4 w-80 h-64 z-40';

  return (
    <div className={`${panelClasses} bg-background rounded-lg border shadow-xl flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-xs">2D Section</h2>
          {drawing && isExpanded && (
            <span className="text-xs text-muted-foreground">
              {drawing.cutPolygons.length} polygons
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Display toggles */}
          <Button
            variant={displayOptions.showHiddenLines ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={toggleHiddenLines}
            title="Toggle hidden lines"
          >
            {displayOptions.showHiddenLines ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button
            variant={displayOptions.showHatching ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={toggleHatching}
            title="Toggle hatching"
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Zoom controls */}
          <Button variant="ghost" size="icon-sm" onClick={zoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono w-12 text-center">
            {Math.round(viewTransform.scale * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" onClick={zoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={fitToView} title="Fit to view">
            <Maximize2 className="h-4 w-4" />
          </Button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Export */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleExportSVG}
            disabled={!svgContent}
            title="Export SVG"
          >
            <Download className="h-4 w-4" />
          </Button>

          {/* Regenerate */}
          <Button
            variant="ghost"
            size="sm"
            onClick={generateDrawing}
            disabled={status === 'generating'}
          >
            {status === 'generating' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            Regenerate
          </Button>

          {/* Close */}
          <Button variant="ghost" size="icon-sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Drawing Canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-white dark:bg-zinc-950 cursor-grab active:cursor-grabbing rounded-b-lg"
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
                style={{ width: `${progress}%` }}
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
                {useViewerStore.getState().drawing2DError}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={generateDrawing}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {status === 'ready' && drawing && (
          <Drawing2DCanvas
            drawing={drawing}
            hatchingLines={hatchingLines}
            transform={viewTransform}
            showHiddenLines={displayOptions.showHiddenLines}
            showHatching={displayOptions.showHatching}
          />
        )}

        {status === 'idle' && !drawing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p>No drawing generated yet</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={generateDrawing}>
                Generate Drawing
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS RENDERER
// ═══════════════════════════════════════════════════════════════════════════

interface Drawing2DCanvasProps {
  drawing: Drawing2D;
  hatchingLines: DrawingLine[];
  transform: { x: number; y: number; scale: number };
  showHiddenLines: boolean;
  showHatching: boolean;
}

function Drawing2DCanvas({ drawing, hatchingLines, transform, showHiddenLines, showHatching }: Drawing2DCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Apply transform
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, -transform.scale); // Flip Y for CAD coordinates

    // ═══════════════════════════════════════════════════════════════════════
    // 1. FILL CUT POLYGONS (with solid color based on IFC type)
    // ═══════════════════════════════════════════════════════════════════════
    for (const polygon of drawing.cutPolygons) {
      // Get fill color based on IFC type
      const fillColor = getFillColorForType(polygon.ifcType);

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
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. DRAW HATCHING ON TOP OF FILLS
    // ═══════════════════════════════════════════════════════════════════════
    if (showHatching && hatchingLines.length > 0) {
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 0.1 / transform.scale;
      for (const line of hatchingLines) {
        ctx.beginPath();
        ctx.moveTo(line.line.start.x, line.line.start.y);
        ctx.lineTo(line.line.end.x, line.line.end.y);
        ctx.stroke();
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. STROKE CUT POLYGON OUTLINES (thick black lines)
    // ═══════════════════════════════════════════════════════════════════════
    for (const polygon of drawing.cutPolygons) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.5 / transform.scale;
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
    // 4. DRAW PROJECTION/SILHOUETTE LINES (skip 'cut' - already in polygons)
    // ═══════════════════════════════════════════════════════════════════════
    for (const line of drawing.lines) {
      // Skip 'cut' lines - they're triangulation edges, already handled by polygons
      if (line.category === 'cut') continue;

      // Skip hidden lines if not showing
      if (!showHiddenLines && line.visibility === 'hidden') continue;

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
  }, [drawing, hatchingLines, transform, showHiddenLines, showHatching]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}

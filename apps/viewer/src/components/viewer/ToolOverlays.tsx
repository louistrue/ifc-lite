/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tool-specific overlays for measure and section tools
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { X, Trash2, Ruler, Slice, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore, type Measurement } from '@/store';
import { SnapType } from '@ifc-lite/renderer';

export function ToolOverlays() {
  const activeTool = useViewerStore((s) => s.activeTool);

  if (activeTool === 'measure') {
    return <MeasureOverlay />;
  }

  if (activeTool === 'section') {
    return <SectionOverlay />;
  }

  return null;
}

function MeasureOverlay() {
  const measurements = useViewerStore((s) => s.measurements);
  const pendingMeasurePoint = useViewerStore((s) => s.pendingMeasurePoint);
  const activeMeasurement = useViewerStore((s) => s.activeMeasurement);
  const snapTarget = useViewerStore((s) => s.snapTarget);
  const snapVisualization = useViewerStore((s) => s.snapVisualization);
  const snapEnabled = useViewerStore((s) => s.snapEnabled);
  const toggleSnap = useViewerStore((s) => s.toggleSnap);
  const deleteMeasurement = useViewerStore((s) => s.deleteMeasurement);
  const clearMeasurements = useViewerStore((s) => s.clearMeasurements);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  // Track cursor position in ref (no re-renders on mouse move)
  const cursorPosRef = React.useRef<{ x: number; y: number } | null>(null);
  // Only update snap indicator position when snap target changes (not on every cursor move)
  const [snapIndicatorPos, setSnapIndicatorPos] = useState<{ x: number; y: number } | null>(null);
  // Panel collapsed by default for minimal UI
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
  // Ref to the overlay container for coordinate conversion
  const overlayRef = React.useRef<HTMLDivElement>(null);

  // Update cursor position in ref (no re-renders)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Convert page coords to overlay-relative coords for consistent SVG positioning
      const container = overlayRef.current?.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        cursorPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        cursorPosRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Update snap indicator position when snap target changes
  // Cursor position is stored in ref (no re-renders on mouse move)
  // Snap target changes already trigger re-renders, so indicator will update frequently enough
  useEffect(() => {
    if (snapTarget && cursorPosRef.current) {
      setSnapIndicatorPos(cursorPosRef.current);
    } else {
      setSnapIndicatorPos(null);
    }
  }, [snapTarget]);

  const handleClear = useCallback(() => {
    clearMeasurements();
  }, [clearMeasurements]);

  const handleDeleteMeasurement = useCallback((id: string) => {
    deleteMeasurement(id);
  }, [deleteMeasurement]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  // Calculate total distance
  const totalDistance = measurements.reduce((sum, m) => sum + m.distance, 0);

  return (
    <>
      {/* Hidden ref element for coordinate calculation */}
      <div ref={overlayRef} className="absolute top-0 left-0 w-0 h-0" />
      
      {/* Compact Measure Tool Panel */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
        {/* Header - always visible */}
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            onClick={togglePanel}
            className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 transition-colors"
          >
            <Ruler className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Measure</span>
            {measurements.length > 0 && !isPanelCollapsed && (
              <span className="text-xs text-muted-foreground">({measurements.length})</span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            {measurements.length > 0 && (
              <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear all">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Expandable content */}
        {!isPanelCollapsed && (
          <div className="border-t px-2 pb-2 min-w-56">
            {measurements.length > 0 ? (
              <div className="space-y-1 mt-2">
                {measurements.map((m, i) => (
                  <MeasurementItem
                    key={m.id}
                    measurement={m}
                    index={i}
                    onDelete={handleDeleteMeasurement}
                  />
                ))}
                {measurements.length > 1 && (
                  <div className="flex items-center justify-between border-t pt-1 mt-1 text-xs font-medium">
                    <span>Total</span>
                    <span className="font-mono">{formatDistance(totalDistance)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-2 text-muted-foreground text-xs">
                No measurements
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instruction hint - brutalist style with snap-colored shadow */}
      <div 
        className="pointer-events-auto absolute bottom-16 left-1/2 -translate-x-1/2 z-30 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-100 transition-shadow duration-150"
        style={{
          boxShadow: snapTarget 
            ? `4px 4px 0px 0px ${
                snapTarget.type === 'vertex' ? '#FFEB3B' :
                snapTarget.type === 'edge' ? '#FF9800' :
                snapTarget.type === 'edge_midpoint' ? '#FFC107' :
                snapTarget.type === 'face' ? '#03A9F4' : '#00BCD4'
              }`
            : '3px 3px 0px 0px rgba(0,0,0,0.3)'
        }}
      >
        <span className="font-mono text-xs uppercase tracking-wide">
          {activeMeasurement ? 'Release to complete' : 'Drag to measure'}
        </span>
      </div>

      {/* Snap toggle - brutalist style */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          onClick={toggleSnap}
          className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider border-2 transition-colors ${
            snapEnabled 
              ? 'bg-primary text-primary-foreground border-primary' 
              : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-300 dark:border-zinc-700'
          }`}
          title="Toggle snap (S key)"
        >
          Snap {snapEnabled ? 'On' : 'Off'}
        </button>
      </div>

      {/* Render measurement lines, labels, and snap indicators */}
      <MeasurementOverlays
        measurements={measurements}
        pending={pendingMeasurePoint}
        activeMeasurement={activeMeasurement}
        snapTarget={snapTarget}
        snapVisualization={snapVisualization}
        hoverPosition={snapIndicatorPos}
      />
    </>
  );
}

interface MeasurementItemProps {
  measurement: Measurement;
  index: number;
  onDelete: (id: string) => void;
}

function MeasurementItem({ measurement, index, onDelete }: MeasurementItemProps) {
  return (
    <div className="flex items-center justify-between bg-muted/50 rounded px-2 py-0.5 text-xs">
      <span className="text-muted-foreground text-xs">#{index + 1}</span>
      <span className="font-mono font-medium">{formatDistance(measurement.distance)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-4 w-4 hover:bg-destructive/20"
        onClick={() => onDelete(measurement.id)}
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

interface MeasurementOverlaysProps {
  measurements: Measurement[];
  pending: { screenX: number; screenY: number } | null;
  activeMeasurement: { start: { screenX: number; screenY: number }; current: { screenX: number; screenY: number }; distance: number } | null;
  snapTarget: { position: { x: number; y: number; z: number }; type: SnapType; metadata?: any } | null;
  snapVisualization: { edgeLine?: { start: { x: number; y: number }; end: { x: number; y: number } }; planeIndicator?: { x: number; y: number; normal: { x: number; y: number; z: number } } } | null;
  hoverPosition?: { x: number; y: number } | null;
}

const MeasurementOverlays = React.memo(function MeasurementOverlays({ measurements, pending, activeMeasurement, snapTarget, snapVisualization, hoverPosition }: MeasurementOverlaysProps) {
  // Determine snap indicator position
  // Priority: activeMeasurement.current > hoverPosition
  const snapIndicatorPos = useMemo(() => {
    return activeMeasurement
      ? { x: activeMeasurement.current.screenX, y: activeMeasurement.current.screenY }
      : hoverPosition;
  }, [
    activeMeasurement?.current?.screenX,
    activeMeasurement?.current?.screenY,
    hoverPosition?.x,
    hoverPosition?.y,
  ]);

  // Stable values for effect dependencies
  const measurementsCount = measurements.length;
  const hasActiveMeasurement = !!activeMeasurement;
  const hasSnapTarget = !!snapTarget;
  const hasSnapVisualization = !!snapVisualization;


  return (
    <>
      {/* SVG filter definitions for glow effect */}
      <svg className="absolute w-0 h-0 pointer-events-none" style={{ pointerEvents: 'none' }}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="snap-glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Completed measurements */}
      {measurements.map((m) => (
        <div key={m.id} className="pointer-events-none">
          {/* Line connecting start and end */}
          <svg
            className="absolute inset-0 pointer-events-none z-20"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            <line
              x1={m.start.screenX}
              y1={m.start.screenY}
              x2={m.end.screenX}
              y2={m.end.screenY}
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeDasharray="6,3"
              filter="url(#glow)"
            />
            {/* Start point */}
            <circle
              cx={m.start.screenX}
              cy={m.start.screenY}
              r="5"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
            />
            {/* End point */}
            <circle
              cx={m.end.screenX}
              cy={m.end.screenY}
              r="5"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
            />
          </svg>

          {/* Distance label at midpoint - brutalist style */}
          <div
            className="absolute pointer-events-none z-20 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-2 py-1 font-mono text-xs font-bold -translate-x-1/2 -translate-y-1/2 border-2 border-zinc-900 dark:border-zinc-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]"
            style={{
              left: (m.start.screenX + m.end.screenX) / 2,
              top: (m.start.screenY + m.end.screenY) / 2,
            }}
          >
            {formatDistance(m.distance)}
          </div>
        </div>
      ))}

      {/* Active measurement (live preview while dragging) */}
      {activeMeasurement && (
        <div className="pointer-events-none">
          <svg
            className="absolute inset-0 pointer-events-none z-20"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            {/* Animated dashed line (marching ants effect) */}
            <line
              x1={activeMeasurement.start.screenX}
              y1={activeMeasurement.start.screenY}
              x2={activeMeasurement.current.screenX}
              y2={activeMeasurement.current.screenY}
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeDasharray="6,3"
              strokeOpacity="0.7"
              filter="url(#glow)"
            />
            {/* Start point */}
            <circle
              cx={activeMeasurement.start.screenX}
              cy={activeMeasurement.start.screenY}
              r="6"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              filter="url(#glow)"
            />
            {/* Current point (slightly larger, pulsing) */}
            <circle
              cx={activeMeasurement.current.screenX}
              cy={activeMeasurement.current.screenY}
              r="7"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              filter="url(#glow)"
              className="animate-pulse"
            />
          </svg>

          {/* Live distance label - brutalist style */}
          <div
            className="absolute pointer-events-none z-20 bg-primary text-primary-foreground px-2.5 py-1 font-mono text-sm font-bold -translate-x-1/2 -translate-y-1/2 border-2 border-primary shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]"
            style={{
              left: (activeMeasurement.start.screenX + activeMeasurement.current.screenX) / 2,
              top: (activeMeasurement.start.screenY + activeMeasurement.current.screenY) / 2,
            }}
          >
            {formatDistance(activeMeasurement.distance)}
          </div>
        </div>
      )}

      {/* Edge highlight - draw full edge in 3D-projected screen space */}
      {snapVisualization?.edgeLine && (
        <svg
          className="absolute inset-0 pointer-events-none z-25"
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <line
            x1={snapVisualization.edgeLine.start.x}
            y1={snapVisualization.edgeLine.start.y}
            x2={snapVisualization.edgeLine.end.x}
            y2={snapVisualization.edgeLine.end.y}
            stroke="hsl(var(--primary))"
            strokeWidth="4"
            strokeOpacity="0.8"
            filter="url(#snap-glow)"
            className="animate-pulse"
          />
        </svg>
      )}

      {/* Plane indicator - subtle grid/cross for face snaps */}
      {snapVisualization?.planeIndicator && (
        <svg
          className="absolute inset-0 pointer-events-none z-25"
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          {/* Cross indicator */}
          <line
            x1={snapVisualization.planeIndicator.x - 20}
            y1={snapVisualization.planeIndicator.y}
            x2={snapVisualization.planeIndicator.x + 20}
            y2={snapVisualization.planeIndicator.y}
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.4"
          />
          <line
            x1={snapVisualization.planeIndicator.x}
            y1={snapVisualization.planeIndicator.y - 20}
            x2={snapVisualization.planeIndicator.x}
            y2={snapVisualization.planeIndicator.y + 20}
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.4"
          />
          {/* Small circle at center */}
          <circle
            cx={snapVisualization.planeIndicator.x}
            cy={snapVisualization.planeIndicator.y}
            r="4"
            fill="hsl(var(--primary))"
            fillOpacity="0.6"
          />
        </svg>
      )}

      {/* Snap indicator */}
      {snapTarget && snapIndicatorPos && (
        <SnapIndicator
          screenX={snapIndicatorPos.x}
          screenY={snapIndicatorPos.y}
          snapType={snapTarget.type}
        />
      )}

      {/* Pending point (legacy - keep for backward compatibility) */}
      {pending && !activeMeasurement && (
        <svg
          className="absolute inset-0 pointer-events-none z-20"
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <circle
            cx={pending.screenX}
            cy={pending.screenY}
            r="5"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
          />
          <circle
            cx={pending.screenX}
            cy={pending.screenY}
            r="2.5"
            fill="hsl(var(--primary))"
          />
        </svg>
      )}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Return true if props are equal (skip re-render), false if different (re-render)
  
  // Compare measurements - check both IDs AND screen coordinates
  if (prevProps.measurements.length !== nextProps.measurements.length) return false;
  for (let i = 0; i < prevProps.measurements.length; i++) {
    const prev = prevProps.measurements[i];
    const next = nextProps.measurements[i];
    if (!next || prev.id !== next.id) return false;
    // Check screen coordinates for zoom/camera changes
    if (prev.start.screenX !== next.start.screenX || prev.start.screenY !== next.start.screenY) return false;
    if (prev.end.screenX !== next.end.screenX || prev.end.screenY !== next.end.screenY) return false;
  }
  
  // Compare activeMeasurement - check if it exists and if position changed
  if (!!prevProps.activeMeasurement !== !!nextProps.activeMeasurement) return false;
  if (prevProps.activeMeasurement && nextProps.activeMeasurement) {
    if (
      prevProps.activeMeasurement.current.screenX !== nextProps.activeMeasurement.current.screenX ||
      prevProps.activeMeasurement.current.screenY !== nextProps.activeMeasurement.current.screenY ||
      prevProps.activeMeasurement.start.screenX !== nextProps.activeMeasurement.start.screenX ||
      prevProps.activeMeasurement.start.screenY !== nextProps.activeMeasurement.start.screenY
    ) return false;
  }
  
  // Compare snapTarget - check type and position
  if (!!prevProps.snapTarget !== !!nextProps.snapTarget) return false;
  if (prevProps.snapTarget && nextProps.snapTarget) {
    if (
      prevProps.snapTarget.type !== nextProps.snapTarget.type ||
      prevProps.snapTarget.position.x !== nextProps.snapTarget.position.x ||
      prevProps.snapTarget.position.y !== nextProps.snapTarget.position.y ||
      prevProps.snapTarget.position.z !== nextProps.snapTarget.position.z
    ) return false;
  }
  
  // Compare snapVisualization
  if (!!prevProps.snapVisualization !== !!nextProps.snapVisualization) return false;
  if (prevProps.snapVisualization && nextProps.snapVisualization) {
    const prevEdge = prevProps.snapVisualization.edgeLine;
    const nextEdge = nextProps.snapVisualization.edgeLine;
    if (!!prevEdge !== !!nextEdge) return false;
    if (prevEdge && nextEdge) {
      if (
        prevEdge.start.x !== nextEdge.start.x ||
        prevEdge.start.y !== nextEdge.start.y ||
        prevEdge.end.x !== nextEdge.end.x ||
        prevEdge.end.y !== nextEdge.end.y
      ) return false;
    }
    const prevPlane = prevProps.snapVisualization.planeIndicator;
    const nextPlane = nextProps.snapVisualization.planeIndicator;
    if (!!prevPlane !== !!nextPlane) return false;
    if (prevPlane && nextPlane) {
      if (
        prevPlane.x !== nextPlane.x ||
        prevPlane.y !== nextPlane.y
      ) return false;
    }
  }
  
  // Compare hoverPosition
  if (prevProps.hoverPosition?.x !== nextProps.hoverPosition?.x ||
      prevProps.hoverPosition?.y !== nextProps.hoverPosition?.y) return false;
  
  // Compare pending
  if (prevProps.pending?.screenX !== nextProps.pending?.screenX ||
      prevProps.pending?.screenY !== nextProps.pending?.screenY) return false;
  
  return true; // All props are equal, skip re-render
});

interface SnapIndicatorProps {
  screenX: number;
  screenY: number;
  snapType: SnapType;
}

function SnapIndicator({ screenX, screenY, snapType }: SnapIndicatorProps) {
  // Distinct colors for each snap type - no labels needed, shapes are self-explanatory
  const snapColors = {
    [SnapType.VERTEX]: '#FFEB3B', // Yellow - circle = point
    [SnapType.EDGE]: '#FF9800', // Orange - line = edge
    [SnapType.EDGE_MIDPOINT]: '#FFC107', // Amber - line with diamond = midpoint
    [SnapType.FACE]: '#03A9F4', // Light Blue - square = face
    [SnapType.FACE_CENTER]: '#00BCD4', // Cyan - square with dot = center
  };

  const color = snapColors[snapType];

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-25"
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      {/* Outer glow ring - subtle pulsing indicator */}
      <circle
        cx={screenX}
        cy={screenY}
        r="10"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeOpacity="0.4"
        filter="url(#snap-glow)"
      />
      
      {/* Vertex: filled circle (point) */}
      {snapType === SnapType.VERTEX && (
        <>
          <circle cx={screenX} cy={screenY} r="5" fill={color} opacity="0.3" />
          <circle cx={screenX} cy={screenY} r="2.5" fill={color} />
        </>
      )}
      
      {/* Edge: horizontal line with center dot */}
      {snapType === SnapType.EDGE && (
        <>
          <line
            x1={screenX - 8}
            y1={screenY}
            x2={screenX + 8}
            y2={screenY}
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={screenX} cy={screenY} r="2" fill={color} />
        </>
      )}
      
      {/* Edge Midpoint: line with diamond marker */}
      {snapType === SnapType.EDGE_MIDPOINT && (
        <>
          <line
            x1={screenX - 8}
            y1={screenY}
            x2={screenX + 8}
            y2={screenY}
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polygon
            points={`${screenX},${screenY - 3} ${screenX + 3},${screenY} ${screenX},${screenY + 3} ${screenX - 3},${screenY}`}
            fill={color}
          />
        </>
      )}
      
      {/* Face: square outline */}
      {snapType === SnapType.FACE && (
        <>
          <rect
            x={screenX - 5}
            y={screenY - 5}
            width="10"
            height="10"
            fill={color}
            fillOpacity="0.2"
            stroke={color}
            strokeWidth="1.5"
          />
        </>
      )}
      
      {/* Face Center: square with center dot */}
      {snapType === SnapType.FACE_CENTER && (
        <>
          <rect
            x={screenX - 5}
            y={screenY - 5}
            width="10"
            height="10"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
          />
          <circle cx={screenX} cy={screenY} r="2" fill={color} />
        </>
      )}
    </svg>
  );
}

function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const flipSectionPlane = useViewerStore((s) => s.flipSectionPlane);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleAxisChange = useCallback((axis: 'x' | 'y' | 'z') => {
    setSectionPlaneAxis(axis);
  }, [setSectionPlaneAxis]);

  const handlePositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSectionPlanePosition(Number(e.target.value));
  }, [setSectionPlanePosition]);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg p-3 min-w-72 z-30">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Slice className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Section Plane</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Axis Selection */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Axis</label>
          <div className="flex gap-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <Button
                key={axis}
                variant={sectionPlane.axis === axis ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => handleAxisChange(axis)}
              >
                {axis.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* Position Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Position</label>
            <span className="text-xs font-mono">{sectionPlane.position}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={sectionPlane.position}
            onChange={handlePositionChange}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant={sectionPlane.enabled ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={toggleSectionPlane}
          >
            {sectionPlane.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={flipSectionPlane}>
            Flip
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          Section plane cuts the model along the selected axis
        </div>
      </div>
    </div>
  );
}

function formatDistance(meters: number): string {
  if (meters < 0.01) {
    return `${(meters * 1000).toFixed(1)} mm`;
  } else if (meters < 1) {
    return `${(meters * 100).toFixed(1)} cm`;
  } else if (meters < 1000) {
    return `${meters.toFixed(2)} m`;
  } else {
    return `${(meters / 1000).toFixed(2)} km`;
  }
}

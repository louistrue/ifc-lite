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
  const projectToScreen = useViewerStore((s) => s.cameraCallbacks.projectToScreen);

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
        projectToScreen={projectToScreen}
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
  snapVisualization: {
    // 3D world coordinates for edge (projected to screen dynamically)
    edgeLine3D?: { v0: { x: number; y: number; z: number }; v1: { x: number; y: number; z: number } };
    planeIndicator?: { x: number; y: number; normal: { x: number; y: number; z: number } };
    slidingDot?: { t: number }; // Position on edge (t = 0-1)
    cornerRings?: { atStart: boolean; valence: number }; // Corner at v0 (true) or v1 (false)
  } | null;
  hoverPosition?: { x: number; y: number } | null;
  projectToScreen?: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null;
}

const MeasurementOverlays = React.memo(function MeasurementOverlays({ measurements, pending, activeMeasurement, snapTarget, snapVisualization, hoverPosition, projectToScreen }: MeasurementOverlaysProps) {
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
      {snapVisualization?.edgeLine3D && projectToScreen && (() => {
        const start = projectToScreen(snapVisualization.edgeLine3D.v0);
        const end = projectToScreen(snapVisualization.edgeLine3D.v1);
        if (!start || !end) return null;

        // Corner position (at v0 or v1)
        const cornerPos = snapVisualization.cornerRings
          ? (snapVisualization.cornerRings.atStart ? start : end)
          : null;

        return (
          <svg
            className="absolute inset-0 pointer-events-none z-30"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            {/* Edge line with snap color (orange for edges) */}
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#FF9800"
              strokeWidth="4"
              strokeOpacity="0.9"
              strokeLinecap="round"
              filter="url(#snap-glow)"
            />
            {/* Outer glow line for better visibility */}
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#FF9800"
              strokeWidth="8"
              strokeOpacity="0.3"
              strokeLinecap="round"
            />
            {/* Edge endpoints */}
            <circle cx={start.x} cy={start.y} r="4" fill="#FF9800" fillOpacity="0.6" />
            <circle cx={end.x} cy={end.y} r="4" fill="#FF9800" fillOpacity="0.6" />

            {/* Corner rings - shows strong attraction at corners */}
            {cornerPos && snapVisualization.cornerRings && (
              <>
                {/* Outer pulsing ring */}
                <circle
                  cx={cornerPos.x}
                  cy={cornerPos.y}
                  r="18"
                  fill="none"
                  stroke="#FFEB3B"
                  strokeWidth="2"
                  strokeOpacity="0.4"
                  className="animate-pulse"
                />
                {/* Middle ring */}
                <circle
                  cx={cornerPos.x}
                  cy={cornerPos.y}
                  r="12"
                  fill="none"
                  stroke="#FFEB3B"
                  strokeWidth="2"
                  strokeOpacity="0.6"
                />
                {/* Inner ring */}
                <circle
                  cx={cornerPos.x}
                  cy={cornerPos.y}
                  r="6"
                  fill="#FFEB3B"
                  fillOpacity="0.8"
                  stroke="white"
                  strokeWidth="1"
                />
                {/* Center dot */}
                <circle
                  cx={cornerPos.x}
                  cy={cornerPos.y}
                  r="2"
                  fill="white"
                />
                {/* Valence indicators (small dots around corner) */}
                {snapVisualization.cornerRings.valence >= 3 && (
                  <>
                    <circle cx={cornerPos.x - 10} cy={cornerPos.y} r="2" fill="#FFEB3B" fillOpacity="0.7" />
                    <circle cx={cornerPos.x + 10} cy={cornerPos.y} r="2" fill="#FFEB3B" fillOpacity="0.7" />
                    <circle cx={cornerPos.x} cy={cornerPos.y - 10} r="2" fill="#FFEB3B" fillOpacity="0.7" />
                  </>
                )}
              </>
            )}
          </svg>
        );
      })()}

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
    // Compare edgeLine3D (3D world coordinates)
    const prevEdge = prevProps.snapVisualization.edgeLine3D;
    const nextEdge = nextProps.snapVisualization.edgeLine3D;
    if (!!prevEdge !== !!nextEdge) return false;
    if (prevEdge && nextEdge) {
      if (
        prevEdge.v0.x !== nextEdge.v0.x ||
        prevEdge.v0.y !== nextEdge.v0.y ||
        prevEdge.v0.z !== nextEdge.v0.z ||
        prevEdge.v1.x !== nextEdge.v1.x ||
        prevEdge.v1.y !== nextEdge.v1.y ||
        prevEdge.v1.z !== nextEdge.v1.z
      ) return false;
    }
    // Compare slidingDot (t parameter only)
    const prevDot = prevProps.snapVisualization.slidingDot;
    const nextDot = nextProps.snapVisualization.slidingDot;
    if (!!prevDot !== !!nextDot) return false;
    if (prevDot && nextDot) {
      if (prevDot.t !== nextDot.t) return false;
    }
    // Compare cornerRings (atStart + valence)
    const prevCorner = prevProps.snapVisualization.cornerRings;
    const nextCorner = nextProps.snapVisualization.cornerRings;
    if (!!prevCorner !== !!nextCorner) return false;
    if (prevCorner && nextCorner) {
      if (
        prevCorner.atStart !== nextCorner.atStart ||
        prevCorner.valence !== nextCorner.valence
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

  // Compare projectToScreen (always re-render if it changes as we need it for projection)
  if (prevProps.projectToScreen !== nextProps.projectToScreen) return false;
  
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

// Axis display info for semantic names
const AXIS_INFO = {
  down: { label: 'Down', description: 'Horizontal cut (floor plan view)', icon: '↓' },
  front: { label: 'Front', description: 'Vertical cut (elevation view)', icon: '→' },
  side: { label: 'Side', description: 'Vertical cut (side elevation)', icon: '⊙' },
} as const;

function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleAxisChange = useCallback((axis: 'down' | 'front' | 'side') => {
    setSectionPlaneAxis(axis);
  }, [setSectionPlaneAxis]);

  const handlePositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSectionPlanePosition(Number(e.target.value));
  }, [setSectionPlanePosition]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => !prev);
  }, []);

  return (
    <>
      {/* Compact Section Tool Panel - matches Measure tool style */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
        {/* Header - always visible */}
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            onClick={togglePanel}
            className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 transition-colors"
          >
            <Slice className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Section</span>
            {sectionPlane.enabled && (
              <span className="text-xs text-primary font-mono">
                {AXIS_INFO[sectionPlane.axis].label} {sectionPlane.position}%
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Expandable content */}
        {!isPanelCollapsed && (
          <div className="border-t px-3 pb-3 min-w-64">
            {/* Direction Selection */}
            <div className="mt-3">
              <label className="text-xs text-muted-foreground mb-2 block">Direction</label>
              <div className="flex gap-1">
                {(['down', 'front', 'side'] as const).map((axis) => (
                  <Button
                    key={axis}
                    variant={sectionPlane.axis === axis ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 flex-col h-auto py-1.5"
                    onClick={() => handleAxisChange(axis)}
                  >
                    <span className="text-xs font-medium">{AXIS_INFO[axis].label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Position Slider */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Position</label>
                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{sectionPlane.position}%</span>
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
          </div>
        )}
      </div>

      {/* Instruction hint - brutalist style matching Measure tool */}
      <div
        className="pointer-events-auto absolute bottom-16 left-1/2 -translate-x-1/2 z-30 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-100 transition-shadow duration-150"
        style={{
          boxShadow: sectionPlane.enabled
            ? '4px 4px 0px 0px #03A9F4' // Light blue shadow when active
            : '3px 3px 0px 0px rgba(0,0,0,0.3)'
        }}
      >
        <span className="font-mono text-xs uppercase tracking-wide">
          {sectionPlane.enabled
            ? `Cutting ${AXIS_INFO[sectionPlane.axis].label.toLowerCase()} at ${sectionPlane.position}%`
            : 'Preview mode'}
        </span>
      </div>

      {/* Enable toggle - brutalist style matching Measure tool */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          onClick={toggleSectionPlane}
          className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider border-2 transition-colors ${
            sectionPlane.enabled
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-300 dark:border-zinc-700'
          }`}
          title="Toggle section plane"
        >
          {sectionPlane.enabled ? 'Cutting' : 'Preview'}
        </button>
      </div>

      {/* Section plane visualization overlay */}
      <SectionPlaneVisualization axis={sectionPlane.axis} enabled={sectionPlane.enabled} />
    </>
  );
}

// Section plane visual indicator component
function SectionPlaneVisualization({ axis, enabled }: { axis: 'down' | 'front' | 'side'; enabled: boolean }) {
  // Get the axis color
  const axisColors = {
    down: '#03A9F4',  // Light blue for horizontal cuts
    front: '#4CAF50', // Green for front cuts
    side: '#FF9800',  // Orange for side cuts
  };

  const color = axisColors[axis];

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20"
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        <filter id="section-glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        {/* Animated dash pattern */}
        <pattern id="section-pattern" patternUnits="userSpaceOnUse" width="10" height="10">
          <line x1="0" y1="0" x2="10" y2="10" stroke={color} strokeWidth="1" strokeOpacity="0.5"/>
        </pattern>
      </defs>

      {/* Axis indicator in corner */}
      <g transform="translate(24, 24)">
        <circle cx="20" cy="20" r="18" fill={color} fillOpacity={enabled ? 0.2 : 0.1} stroke={color} strokeWidth={enabled ? 3 : 2} filter="url(#section-glow)"/>
        <text
          x="20"
          y="20"
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontFamily="monospace"
          fontSize="11"
          fontWeight="bold"
        >
          {AXIS_INFO[axis].label.toUpperCase()}
        </text>
        {/* Active indicator */}
        {enabled && (
          <text
            x="20"
            y="32"
            textAnchor="middle"
            fill={color}
            fontFamily="monospace"
            fontSize="7"
            fontWeight="bold"
          >
            CUT
          </text>
        )}
      </g>
    </svg>
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

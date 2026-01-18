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

  // Track cursor position for snap indicators
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  // Panel collapsed by default for minimal UI
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleClear = useCallback(() => {
    clearMeasurements();
  }, [clearMeasurements]);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleDeleteMeasurement = useCallback((id: string) => {
    deleteMeasurement(id);
  }, [deleteMeasurement]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => !prev);
  }, []);

  // Calculate total distance
  const totalDistance = measurements.reduce((sum, m) => sum + m.distance, 0);

  return (
    <>
      {/* Compact Measure Tool Panel */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
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

      {/* Instruction hint */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm shadow-lg z-30 flex items-center gap-2">
        <span>
          {activeMeasurement
            ? 'Release to complete measurement'
            : 'Drag to measure distance'}
        </span>
        {snapTarget && (
          <span className="px-2 py-0.5 bg-white/20 rounded text-xs">
            Snap: {snapTarget.type === 'vertex' ? 'Vertex' :
                   snapTarget.type === 'edge' ? 'Edge' :
                   snapTarget.type === 'edge_midpoint' ? 'Midpoint' :
                   snapTarget.type === 'face' ? 'Face' : 'Center'}
          </span>
        )}
      </div>

      {/* Snap status indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs text-muted-foreground z-30">
        <button
          onClick={toggleSnap}
          className={`px-2 py-1 rounded ${snapEnabled ? 'bg-primary/20 text-primary' : 'bg-muted'}`}
          title="Toggle snap (S key)"
        >
          Snap: {snapEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Render measurement lines, labels, and snap indicators */}
      <MeasurementOverlays
        measurements={measurements}
        pending={pendingMeasurePoint}
        activeMeasurement={activeMeasurement}
        snapTarget={snapTarget}
        snapVisualization={snapVisualization}
        hoverPosition={cursorPos}
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

function MeasurementOverlays({ measurements, pending, activeMeasurement, snapTarget, snapVisualization, hoverPosition }: MeasurementOverlaysProps) {
  // Determine snap indicator position
  // Priority: activeMeasurement.current > hoverPosition
  const snapIndicatorPos = activeMeasurement
    ? { x: activeMeasurement.current.screenX, y: activeMeasurement.current.screenY }
    : hoverPosition;

  return (
    <>
      {/* SVG filter definitions for glow effect */}
      <svg className="absolute w-0 h-0">
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
        <div key={m.id}>
          {/* Line connecting start and end */}
          <svg
            className="absolute inset-0 pointer-events-none z-20"
            style={{ overflow: 'visible' }}
          >
            <line
              x1={m.start.screenX}
              y1={m.start.screenY}
              x2={m.end.screenX}
              y2={m.end.screenY}
              stroke="hsl(var(--primary))"
              strokeWidth="4"
              strokeDasharray="8,4"
              filter="url(#glow)"
            />
            {/* Start point */}
            <circle
              cx={m.start.screenX}
              cy={m.start.screenY}
              r="8"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
            />
            {/* End point */}
            <circle
              cx={m.end.screenX}
              cy={m.end.screenY}
              r="8"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
            />
          </svg>

          {/* Distance label at midpoint */}
          <div
            className="absolute pointer-events-none z-20 bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm font-mono font-semibold -translate-x-1/2 -translate-y-1/2 border-2 border-white shadow-lg"
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
        <div>
          <svg
            className="absolute inset-0 pointer-events-none z-20"
            style={{ overflow: 'visible' }}
          >
            {/* Animated dashed line (marching ants effect) */}
            <line
              x1={activeMeasurement.start.screenX}
              y1={activeMeasurement.start.screenY}
              x2={activeMeasurement.current.screenX}
              y2={activeMeasurement.current.screenY}
              stroke="hsl(var(--primary))"
              strokeWidth="4"
              strokeDasharray="8,4"
              strokeOpacity="0.7"
              filter="url(#glow)"
            />
            {/* Start point */}
            <circle
              cx={activeMeasurement.start.screenX}
              cy={activeMeasurement.start.screenY}
              r="10"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              filter="url(#glow)"
            />
            {/* Current point (larger, pulsing) */}
            <circle
              cx={activeMeasurement.current.screenX}
              cy={activeMeasurement.current.screenY}
              r="12"
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              filter="url(#glow)"
              className="animate-pulse"
            />
          </svg>

          {/* Live distance label */}
          <div
            className="absolute pointer-events-none z-20 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-base font-mono font-bold -translate-x-1/2 -translate-y-1/2 border-2 border-white shadow-xl"
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
          style={{ overflow: 'visible' }}
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
          style={{ overflow: 'visible' }}
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
          style={{ overflow: 'visible' }}
        >
          <circle
            cx={pending.screenX}
            cy={pending.screenY}
            r="8"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
          />
          <circle
            cx={pending.screenX}
            cy={pending.screenY}
            r="4"
            fill="hsl(var(--primary))"
          />
        </svg>
      )}
    </>
  );
}

interface SnapIndicatorProps {
  screenX: number;
  screenY: number;
  snapType: SnapType;
}

function SnapIndicator({ screenX, screenY, snapType }: SnapIndicatorProps) {
  const snapLabels = {
    [SnapType.VERTEX]: 'Vertex',
    [SnapType.EDGE]: 'Edge',
    [SnapType.EDGE_MIDPOINT]: 'Midpoint',
    [SnapType.FACE]: 'Face',
    [SnapType.FACE_CENTER]: 'Center',
  };

  const snapColors = {
    [SnapType.VERTEX]: '#FFEB3B', // Yellow
    [SnapType.EDGE]: '#FF9800', // Orange
    [SnapType.EDGE_MIDPOINT]: '#FFC107', // Amber
    [SnapType.FACE]: '#03A9F4', // Light Blue
    [SnapType.FACE_CENTER]: '#00BCD4', // Cyan
  };

  const color = snapColors[snapType];

  return (
    <>
      <svg
        className="absolute inset-0 pointer-events-none z-25"
        style={{ overflow: 'visible' }}
      >
        {/* Outer glow ring */}
        <circle
          cx={screenX}
          cy={screenY}
          r="20"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeOpacity="0.5"
          filter="url(#snap-glow)"
          className="animate-pulse"
        />
        {/* Inner snap indicator */}
        {snapType === SnapType.VERTEX && (
          <>
            <circle cx={screenX} cy={screenY} r="12" fill={color} opacity="0.3" />
            <circle cx={screenX} cy={screenY} r="6" fill={color} />
          </>
        )}
        {(snapType === SnapType.EDGE || snapType === SnapType.EDGE_MIDPOINT) && (
          <>
            <line
              x1={screenX - 15}
              y1={screenY}
              x2={screenX + 15}
              y2={screenY}
              stroke={color}
              strokeWidth="4"
              filter="url(#snap-glow)"
            />
            <circle cx={screenX} cy={screenY} r="5" fill={color} />
          </>
        )}
        {(snapType === SnapType.FACE || snapType === SnapType.FACE_CENTER) && (
          <>
            <rect
              x={screenX - 12}
              y={screenY - 12}
              width="24"
              height="24"
              fill="none"
              stroke={color}
              strokeWidth="3"
              opacity="0.5"
            />
            <circle cx={screenX} cy={screenY} r="4" fill={color} />
          </>
        )}
      </svg>

      {/* Snap type label */}
      <div
        className="absolute pointer-events-none z-25 text-xs font-semibold px-2 py-0.5 rounded shadow-lg"
        style={{
          left: screenX,
          top: screenY - 35,
          transform: 'translateX(-50%)',
          backgroundColor: color,
          color: '#000',
        }}
      >
        {snapLabels[snapType]}
      </div>
    </>
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

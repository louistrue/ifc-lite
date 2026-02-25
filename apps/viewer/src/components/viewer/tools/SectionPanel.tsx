/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane controls panel
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Slice, ChevronDown, FileImage, MousePointerClick, MoveVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { AXIS_INFO } from './sectionConstants';
import { SectionPlaneVisualization } from './SectionVisualization';

interface SectionPositionGizmoProps {
  position: number;
  mode: 'axis' | 'surface';
  axis: 'down' | 'front' | 'side';
  onPositionChange: (position: number) => void;
}

function SectionPositionGizmo({ position, mode, axis, onPositionChange }: SectionPositionGizmoProps) {
  const [dragType, setDragType] = useState<'arrow' | 'plane' | null>(null);
  const [showShiftHint, setShowShiftHint] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartPositionRef = useRef(0);

  const trackHeight = 130;
  const clampedPosition = Math.min(100, Math.max(0, position));
  const handleY = ((100 - clampedPosition) / 100) * trackHeight;

  const accent = useMemo(() => {
    if (mode === 'surface') return 'rgb(168 85 247)';
    if (axis === 'down') return '#03A9F4';
    if (axis === 'front') return '#4CAF50';
    return '#FF9800';
  }, [mode, axis]);

  const beginDrag = useCallback((type: 'arrow' | 'plane', e: React.PointerEvent<HTMLButtonElement>) => {
    if (type === 'plane' && !e.shiftKey) {
      setShowShiftHint(true);
      window.setTimeout(() => setShowShiftHint(false), 1800);
      return;
    }

    dragStartYRef.current = e.clientY;
    dragStartPositionRef.current = clampedPosition;
    setDragType(type);

    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [clampedPosition]);

  useEffect(() => {
    if (!dragType) return;

    const onMove = (e: PointerEvent) => {
      const deltaY = dragStartYRef.current - e.clientY;
      const nextPosition = dragStartPositionRef.current + (deltaY / trackHeight) * 100;
      onPositionChange(nextPosition);
    };

    const onUp = () => {
      setDragType(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragType, onPositionChange]);

  return (
    <div className="mt-3 rounded-md border bg-muted/25 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <div className="font-medium">Cut Plane Gizmo</div>
          <div className="mt-1 flex items-center gap-1 text-[11px]">
            <MoveVertical className="h-3 w-3" />
            <span>Drag arrow or hold Shift + drag plane</span>
          </div>
          {showShiftHint && (
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Hold Shift while dragging the plane handle.
            </div>
          )}
        </div>
        <div className="text-right text-xs font-mono text-muted-foreground tabular-nums">
          {clampedPosition.toFixed(1)}%
        </div>
      </div>

      <div className="mt-2 flex justify-center">
        <div className="relative" style={{ height: `${trackHeight + 8}px`, width: '84px' }}>
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-muted-foreground/30"
            style={{ top: 4, height: `${trackHeight}px`, width: '4px' }}
          />

          <button
            type="button"
            onPointerDown={(e) => beginDrag('plane', e)}
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm border shadow-sm transition-transform active:scale-95"
            style={{
              top: `${handleY + 4}px`,
              width: '34px',
              height: '20px',
              borderColor: accent,
              backgroundColor: `${accent}26`,
              cursor: 'grab',
            }}
            title="Hold Shift and drag to move section plane"
          />

          <button
            type="button"
            onPointerDown={(e) => beginDrag('arrow', e)}
            className="absolute -translate-y-1/2 transition-transform active:scale-95"
            style={{ top: `${handleY + 4}px`, right: '4px', cursor: 'ns-resize' }}
            title="Drag to move section plane"
          >
            <svg width="26" height="22" viewBox="0 0 26 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="1" y1="11" x2="15" y2="11" stroke={accent} strokeWidth="2" />
              <path d="M25 11L16 5V17L25 11Z" fill={accent} />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlaneMode = useViewerStore((s) => s.setSectionPlaneMode);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const setDrawingPanelVisible = useViewerStore((s) => s.setDrawing2DPanelVisible);
  const drawingPanelVisible = useViewerStore((s) => s.drawing2DPanelVisible);
  const clearDrawing = useViewerStore((s) => s.clearDrawing2D);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleAxisChange = useCallback((nextAxis: 'down' | 'front' | 'side') => {
    setSectionPlaneAxis(nextAxis);
  }, [setSectionPlaneAxis]);

  const handleModeChange = useCallback((nextMode: 'axis' | 'surface') => {
    setSectionPlaneMode(nextMode);
  }, [setSectionPlaneMode]);

  const handlePositionChange = useCallback((nextPosition: number) => {
    setSectionPlanePosition(nextPosition);
  }, [setSectionPlanePosition]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed((prev) => !prev);
  }, []);

  const handleView2D = useCallback(() => {
    // Clear existing drawing to force regeneration with current settings
    clearDrawing();
    setDrawingPanelVisible(true);
  }, [clearDrawing, setDrawingPanelVisible]);

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
                {sectionPlane.mode === 'surface' ? 'Surface' : AXIS_INFO[sectionPlane.axis].label}{' '}
                <span className="inline-block w-12 text-right tabular-nums">{sectionPlane.position.toFixed(1)}%</span>
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            {/* Only show 2D button when panel is closed */}
            {!drawingPanelVisible && sectionPlane.mode === 'axis' && (
              <Button variant="ghost" size="icon-sm" onClick={handleView2D} title="Open 2D Drawing Panel">
                <FileImage className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Expandable content */}
        {!isPanelCollapsed && (
          <div className="border-t px-3 pb-3 min-w-64">
            {/* Mode Selection */}
            <div className="mt-3">
              <label className="text-xs text-muted-foreground mb-2 block">Mode</label>
              <div className="flex gap-1">
                <Button
                  variant={sectionPlane.mode === 'axis' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleModeChange('axis')}
                >
                  Axis
                </Button>
                <Button
                  variant={sectionPlane.mode === 'surface' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleModeChange('surface')}
                >
                  Surface
                </Button>
              </div>
            </div>

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
                    disabled={sectionPlane.mode !== 'axis'}
                    onClick={() => handleAxisChange(axis)}
                  >
                    <span className="text-xs font-medium">{AXIS_INFO[axis].label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {sectionPlane.mode === 'surface' && (
              <div className="mt-2 text-[11px] text-muted-foreground flex items-start gap-1.5">
                <MousePointerClick className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Click a visible face in the model to align the cut plane to that surface normal.</span>
              </div>
            )}

            <SectionPositionGizmo
              position={sectionPlane.position}
              mode={sectionPlane.mode}
              axis={sectionPlane.axis}
              onPositionChange={handlePositionChange}
            />

            {/* Show 2D panel button - only when panel is closed */}
            {!drawingPanelVisible && sectionPlane.mode === 'axis' && (
              <div className="mt-3 pt-3 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleView2D}
                >
                  <FileImage className="h-4 w-4 mr-2" />
                  Open 2D Drawing
                </Button>
              </div>
            )}
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
            ? `Cutting ${sectionPlane.mode === 'surface' ? 'surface' : AXIS_INFO[sectionPlane.axis].label.toLowerCase()} at ${sectionPlane.position.toFixed(1)}%`
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
      <SectionPlaneVisualization axis={sectionPlane.axis} enabled={sectionPlane.enabled} mode={sectionPlane.mode} />
    </>
  );
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section tool overlay panel
 *
 * Provides controls for axis-aligned and face-based section cutting:
 * - Axis selector (Down / Front / Side)
 * - Position slider + numeric input
 * - Section-by-face mode toggle
 * - Flip direction
 * - Enable/disable toggle
 * - 2D drawing panel launcher
 */

import React, { useCallback, useState } from 'react';
import { X, Slice, ChevronDown, FileImage, FlipVertical, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import type { SectionPlaneAxis } from '@/store';
import { AXIS_INFO, GIZMO_COLORS } from './sectionConstants';
import { SectionPlaneVisualization } from './SectionVisualization';

export function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const flipSectionPlane = useViewerStore((s) => s.flipSectionPlane);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const setSectionMode = useViewerStore((s) => s.setSectionMode);
  const clearSectionFace = useViewerStore((s) => s.clearSectionFace);
  const setDrawingPanelVisible = useViewerStore((s) => s.setDrawing2DPanelVisible);
  const drawingPanelVisible = useViewerStore((s) => s.drawing2DPanelVisible);
  const clearDrawing = useViewerStore((s) => s.clearDrawing2D);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleAxisChange = useCallback((axis: SectionPlaneAxis) => {
    setSectionPlaneAxis(axis);
  }, [setSectionPlaneAxis]);

  const handlePositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isNaN(value)) {
      setSectionPlanePosition(value);
    }
  }, [setSectionPlanePosition]);

  const handleFaceMode = useCallback(() => {
    if (sectionPlane.mode === 'face') {
      clearSectionFace();
    } else {
      setSectionMode('face');
    }
  }, [sectionPlane.mode, setSectionMode, clearSectionFace]);

  const handleView2D = useCallback(() => {
    clearDrawing();
    setDrawingPanelVisible(true);
  }, [clearDrawing, setDrawingPanelVisible]);

  const activeColor = sectionPlane.mode === 'face'
    ? GIZMO_COLORS.face
    : GIZMO_COLORS[sectionPlane.axis];

  const positionLabel = sectionPlane.mode === 'face'
    ? `${(sectionPlane.face?.offset ?? 0).toFixed(2)}m`
    : `${sectionPlane.position.toFixed(1)}%`;

  return (
    <>
      {/* Main panel */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            onClick={() => setIsPanelCollapsed((p) => !p)}
            className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 transition-colors"
          >
            <Slice className="h-4 w-4" style={{ color: activeColor }} />
            <span className="font-medium text-sm">Section</span>
            {sectionPlane.enabled && (
              <span className="text-xs font-mono" style={{ color: activeColor }}>
                {sectionPlane.mode === 'face' ? 'Face' : AXIS_INFO[sectionPlane.axis].label}{' '}
                <span className="inline-block w-14 text-right tabular-nums">{positionLabel}</span>
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            {!drawingPanelVisible && sectionPlane.mode === 'axis' && (
              <Button variant="ghost" size="icon-sm" onClick={handleView2D} title="Open 2D Drawing">
                <FileImage className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Expanded content */}
        {!isPanelCollapsed && (
          <div className="border-t px-3 pb-3 min-w-72">
            {/* Mode toggle */}
            <div className="mt-3 flex gap-1">
              <Button
                variant={sectionPlane.mode === 'axis' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => { if (sectionPlane.mode !== 'axis') clearSectionFace(); }}
              >
                <Slice className="h-3 w-3 mr-1" />
                Axis
              </Button>
              <Button
                variant={sectionPlane.mode === 'face' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 text-xs"
                onClick={handleFaceMode}
              >
                <Box className="h-3 w-3 mr-1" />
                Face
              </Button>
            </div>

            {/* Axis-mode controls */}
            {sectionPlane.mode === 'axis' && (
              <>
                {/* Direction buttons */}
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground mb-2 block">Direction</label>
                  <div className="flex gap-1">
                    {(['down', 'front', 'side'] as const).map((axis) => (
                      <Button
                        key={axis}
                        variant={sectionPlane.axis === axis ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 h-auto py-1.5"
                        onClick={() => handleAxisChange(axis)}
                      >
                        <span
                          className="w-2 h-2 rounded-full mr-1.5 inline-block"
                          style={{ backgroundColor: AXIS_INFO[axis].color }}
                        />
                        <span className="text-xs font-medium">{AXIS_INFO[axis].label}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Position slider */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">Position</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={sectionPlane.position}
                        onChange={handlePositionChange}
                        className="w-16 text-xs font-mono bg-muted px-1.5 py-0.5 rounded border-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={sectionPlane.position}
                    onChange={handlePositionChange}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: AXIS_INFO[sectionPlane.axis].color }}
                  />
                </div>
              </>
            )}

            {/* Face-mode info */}
            {sectionPlane.mode === 'face' && (
              <div className="mt-3">
                {sectionPlane.face ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div className="flex items-center justify-between">
                      <span>Normal</span>
                      <span className="font-mono">
                        ({sectionPlane.face.normal.x.toFixed(2)}, {sectionPlane.face.normal.y.toFixed(2)}, {sectionPlane.face.normal.z.toFixed(2)})
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Offset</span>
                      <span className="font-mono">{sectionPlane.face.offset.toFixed(3)}m</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      Drag the gizmo arrow in 3D to move the plane
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click a surface in the 3D view to define the section plane
                  </p>
                )}
              </div>
            )}

            {/* Flip + actions row */}
            <div className="mt-3 pt-3 border-t flex gap-1">
              <Button
                variant={sectionPlane.flipped ? 'default' : 'outline'}
                size="sm"
                className="flex-1 text-xs"
                onClick={flipSectionPlane}
              >
                <FlipVertical className="h-3 w-3 mr-1" />
                {sectionPlane.flipped ? 'Flipped' : 'Flip'}
              </Button>
              {!drawingPanelVisible && sectionPlane.mode === 'axis' && (
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleView2D}>
                  <FileImage className="h-3 w-3 mr-1" />
                  2D Drawing
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div
        className="pointer-events-auto absolute bottom-16 left-1/2 -translate-x-1/2 z-30 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-100 transition-shadow duration-150"
        style={{
          boxShadow: sectionPlane.enabled
            ? `4px 4px 0px 0px ${activeColor}`
            : '3px 3px 0px 0px rgba(0,0,0,0.3)',
        }}
      >
        <span className="font-mono text-xs uppercase tracking-wide">
          {sectionPlane.enabled
            ? sectionPlane.mode === 'face'
              ? `Face cut at ${(sectionPlane.face?.offset ?? 0).toFixed(2)}m`
              : `Cutting ${AXIS_INFO[sectionPlane.axis].label.toLowerCase()} at ${sectionPlane.position.toFixed(1)}%`
            : 'Preview mode — drag gizmo or use slider'}
        </span>
      </div>

      {/* Enable toggle */}
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

      {/* Section plane gizmo visualization overlay */}
      <SectionPlaneVisualization />
    </>
  );
}

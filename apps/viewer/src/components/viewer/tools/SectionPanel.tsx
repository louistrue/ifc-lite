/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane controls panel
 */

import React, { useCallback, useState } from 'react';
import { X, Slice, ChevronDown, FileImage, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import type { SectionMode } from '@/store/types';
import { AXIS_INFO, MODE_INFO, FACE_SECTION_COLOR } from './sectionConstants';
import { SectionPlaneVisualization } from './SectionVisualization';

export function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const sectionMode = useViewerStore((s) => s.sectionMode);
  const faceSectionPlane = useViewerStore((s) => s.faceSectionPlane);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const setSectionMode = useViewerStore((s) => s.setSectionMode);
  const clearFaceSection = useViewerStore((s) => s.clearFaceSection);
  const toggleFaceSection = useViewerStore((s) => s.toggleFaceSection);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const setDrawingPanelVisible = useViewerStore((s) => s.setDrawing2DPanelVisible);
  const drawingPanelVisible = useViewerStore((s) => s.drawing2DPanelVisible);
  const clearDrawing = useViewerStore((s) => s.clearDrawing2D);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleModeChange = useCallback((mode: SectionMode) => {
    setSectionMode(mode);
    if (mode !== 'face') {
      setSectionPlaneAxis(mode);
    }
  }, [setSectionMode, setSectionPlaneAxis]);

  const handlePositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isNaN(value)) {
      setSectionPlanePosition(value);
    }
  }, [setSectionPlanePosition]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => !prev);
  }, []);

  const handleView2D = useCallback(() => {
    clearDrawing();
    setDrawingPanelVisible(true);
  }, [clearDrawing, setDrawingPanelVisible]);

  const isFaceMode = sectionMode === 'face';
  const isFaceActive = isFaceMode && faceSectionPlane?.confirmed;

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
            {isFaceMode ? (
              <span className="text-xs font-mono" style={{ color: FACE_SECTION_COLOR }}>
                Face {isFaceActive ? 'Cut' : 'Pick'}
              </span>
            ) : sectionPlane.enabled && (
              <span className="text-xs text-primary font-mono">
                {AXIS_INFO[sectionPlane.axis].label} <span className="inline-block w-12 text-right tabular-nums">{sectionPlane.position.toFixed(1)}%</span>
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            {!drawingPanelVisible && !isFaceMode && (
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
              <label className="text-xs text-muted-foreground mb-2 block">Direction</label>
              <div className="flex gap-1">
                {(['down', 'front', 'side', 'face'] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={sectionMode === mode ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 flex-col h-auto py-1.5"
                    onClick={() => handleModeChange(mode)}
                    style={sectionMode === mode && mode === 'face' ? { backgroundColor: FACE_SECTION_COLOR, borderColor: FACE_SECTION_COLOR } : undefined}
                  >
                    <span className="text-xs font-medium">{MODE_INFO[mode].label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Axis-aligned controls */}
            {!isFaceMode && (
              <>
                {/* Position Slider */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">Position</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={sectionPlane.position}
                      onChange={handlePositionChange}
                      className="w-16 text-xs font-mono bg-muted px-1.5 py-0.5 rounded border-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={sectionPlane.position}
                    onChange={handlePositionChange}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>

                {/* Show 2D panel button */}
                {!drawingPanelVisible && (
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
              </>
            )}

            {/* Face mode controls */}
            {isFaceMode && (
              <div className="mt-3">
                {isFaceActive ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Face section active. Drag the arrow to move the cut plane.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={clearFaceSection}
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear Face Section
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Hover over any face to preview, then click to cut.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instruction hint - brutalist style matching Measure tool */}
      <div
        className="pointer-events-auto absolute bottom-16 left-1/2 -translate-x-1/2 z-30 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-100 transition-shadow duration-150"
        style={{
          boxShadow: (isFaceActive || (!isFaceMode && sectionPlane.enabled))
            ? `4px 4px 0px 0px ${isFaceMode ? FACE_SECTION_COLOR : '#03A9F4'}`
            : '3px 3px 0px 0px rgba(0,0,0,0.3)'
        }}
      >
        <span className="font-mono text-xs uppercase tracking-wide">
          {isFaceMode
            ? (isFaceActive ? 'Face section active \u2014 drag arrow to move' : 'Click a face to cut')
            : (sectionPlane.enabled
              ? `Cutting ${AXIS_INFO[sectionPlane.axis].label.toLowerCase()} at ${sectionPlane.position.toFixed(1)}%`
              : 'Preview mode')}
        </span>
      </div>

      {/* Enable toggle */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          onClick={isFaceMode ? toggleFaceSection : toggleSectionPlane}
          className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider border-2 transition-colors ${
            (isFaceMode ? isFaceActive : sectionPlane.enabled)
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-300 dark:border-zinc-700'
          }`}
          style={(isFaceMode && isFaceActive) ? { backgroundColor: FACE_SECTION_COLOR, borderColor: FACE_SECTION_COLOR } : undefined}
          title="Toggle section plane"
        >
          {isFaceMode
            ? (isFaceActive ? 'Cutting' : 'Pick Face')
            : (sectionPlane.enabled ? 'Cutting' : 'Preview')}
        </button>
      </div>

      {/* Section plane visualization overlay */}
      <SectionPlaneVisualization
        axis={sectionPlane.axis}
        enabled={isFaceMode ? !!isFaceActive : sectionPlane.enabled}
        isFaceMode={isFaceMode}
      />
    </>
  );
}

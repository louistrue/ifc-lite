/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section tool overlay — face-based clipping.
 *
 * The user clicks any face in 3D to define a cutting plane.
 * A distance slider lets them push the plane along its normal.
 * The 3D scene reflects the actual clipped model in real time.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { X, Slice, ChevronDown, FileImage, FlipHorizontal2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';

/**
 * Compute the min/max distance range by projecting the AABB onto the plane normal.
 * Returns the range of signed distances where the section plane intersects the model.
 */
function computeSliderRange(
  normal: { x: number; y: number; z: number },
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
): { min: number; max: number } {
  // Project all 8 AABB corners onto the normal and take min/max
  const { min: bMin, max: bMax } = bounds;
  const corners = [
    bMin.x * normal.x + bMin.y * normal.y + bMin.z * normal.z,
    bMax.x * normal.x + bMin.y * normal.y + bMin.z * normal.z,
    bMin.x * normal.x + bMax.y * normal.y + bMin.z * normal.z,
    bMax.x * normal.x + bMax.y * normal.y + bMin.z * normal.z,
    bMin.x * normal.x + bMin.y * normal.y + bMax.z * normal.z,
    bMax.x * normal.x + bMin.y * normal.y + bMax.z * normal.z,
    bMin.x * normal.x + bMax.y * normal.y + bMax.z * normal.z,
    bMax.x * normal.x + bMax.y * normal.y + bMax.z * normal.z,
  ];

  let lo = corners[0], hi = corners[0];
  for (let i = 1; i < 8; i++) {
    if (corners[i] < lo) lo = corners[i];
    if (corners[i] > hi) hi = corners[i];
  }

  // Add 10% padding on each side so the slider can move the plane past the model edges
  const padding = (hi - lo) * 0.1;
  return { min: lo - padding, max: hi + padding };
}

export function SectionOverlay() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const setSectionPlaneDistance = useViewerStore((s) => s.setSectionPlaneDistance);
  const flipSectionPlane = useViewerStore((s) => s.flipSectionPlane);
  const resetSectionPlane = useViewerStore((s) => s.resetSectionPlane);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const setDrawingPanelVisible = useViewerStore((s) => s.setDrawing2DPanelVisible);
  const drawingPanelVisible = useViewerStore((s) => s.drawing2DPanelVisible);
  const clearDrawing = useViewerStore((s) => s.clearDrawing2D);
  const geometryResult = useViewerStore((s) => s.geometryResult);
  const models = useViewerStore((s) => s.models);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  // Track the slider range — frozen when the section is first set or the normal changes
  const sliderRangeRef = useRef<{ min: number; max: number; normalKey: string } | null>(null);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleDistanceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isNaN(value)) {
      setSectionPlaneDistance(value);
    }
  }, [setSectionPlaneDistance]);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => !prev);
  }, []);

  const handleView2D = useCallback(() => {
    clearDrawing();
    setDrawingPanelVisible(true);
  }, [clearDrawing, setDrawingPanelVisible]);

  // Compute model bounds from geometry — federated or single model
  const modelBounds = useMemo(() => {
    // Try federated models first
    if (models.size > 0) {
      let hasValidBounds = false;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const model of models.values()) {
        if (!model.visible || !model.geometryResult?.coordinateInfo?.shiftedBounds) continue;
        const b = model.geometryResult.coordinateInfo.shiftedBounds;
        minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
        maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
        hasValidBounds = true;
      }
      if (hasValidBounds) {
        return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
      }
    }
    // Single model fallback
    if (geometryResult?.coordinateInfo?.shiftedBounds) {
      return geometryResult.coordinateInfo.shiftedBounds;
    }
    return null;
  }, [geometryResult, models]);

  // Compute slider range from model bounds (or fallback), frozen per-normal
  const sliderRange = useMemo(() => {
    if (!sectionPlane.enabled) {
      sliderRangeRef.current = null;
      return null;
    }

    const n = sectionPlane.normal;
    const normalKey = `${n.x.toFixed(4)},${n.y.toFixed(4)},${n.z.toFixed(4)}`;

    // Reuse cached range if normal hasn't changed
    if (sliderRangeRef.current && sliderRangeRef.current.normalKey === normalKey) {
      return sliderRangeRef.current;
    }

    let range: { min: number; max: number };
    if (modelBounds) {
      range = computeSliderRange(n, modelBounds);
    } else {
      // Fallback: create a range centered on current distance
      const d = sectionPlane.distance;
      const halfSpan = Math.max(50, Math.abs(d) * 2);
      range = { min: d - halfSpan, max: d + halfSpan };
    }
    sliderRangeRef.current = { ...range, normalKey };
    return sliderRangeRef.current;
  }, [sectionPlane.enabled, sectionPlane.normal, sectionPlane.distance, modelBounds]);

  // Format normal for display
  const n = sectionPlane.normal;
  const normalLabel = `(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`;

  // Slider step: adapt to range size for fine control
  const sliderStep = sliderRange
    ? Math.max(0.01, (sliderRange.max - sliderRange.min) / 500)
    : 0.05;

  return (
    <>
      {/* Compact Section Tool Panel */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg z-30">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            onClick={togglePanel}
            className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 transition-colors"
          >
            <Slice className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Section</span>
            {sectionPlane.enabled && (
              <span className="text-xs text-primary font-mono truncate max-w-[140px]">
                d={sectionPlane.distance.toFixed(2)}
              </span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${isPanelCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <div className="flex items-center gap-1">
            {!drawingPanelVisible && sectionPlane.enabled && (
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
            {!sectionPlane.enabled ? (
              /* No plane set yet */
              <div className="mt-3 text-xs text-muted-foreground text-center py-2">
                Click any face in 3D to define a cutting plane
              </div>
            ) : (
              <>
                {/* Normal info */}
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Plane Normal</label>
                  <div className="text-xs font-mono bg-muted px-2 py-1 rounded">{normalLabel}</div>
                </div>

                {/* Distance Slider */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">Distance</label>
                    <input
                      type="number"
                      step="0.1"
                      value={sectionPlane.distance}
                      onChange={handleDistanceChange}
                      className="w-20 text-xs font-mono bg-muted px-1.5 py-0.5 rounded border-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  {sliderRange && (
                    <input
                      type="range"
                      min={sliderRange.min}
                      max={sliderRange.max}
                      step={sliderStep}
                      value={sectionPlane.distance}
                      onChange={handleDistanceChange}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  )}
                </div>

                {/* Action buttons */}
                <div className="mt-3 flex gap-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={flipSectionPlane} title="Flip cutting direction">
                    <FlipHorizontal2 className="h-3.5 w-3.5 mr-1" />
                    Flip
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={resetSectionPlane} title="Clear section plane">
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Clear
                  </Button>
                </div>

                {/* Show 2D panel button */}
                {!drawingPanelVisible && (
                  <div className="mt-3 pt-3 border-t">
                    <Button variant="outline" size="sm" className="w-full" onClick={handleView2D}>
                      <FileImage className="h-4 w-4 mr-2" />
                      Open 2D Drawing
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Instruction hint */}
      <div
        className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 z-30 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-100 transition-shadow duration-150"
        style={{
          boxShadow: sectionPlane.enabled
            ? '4px 4px 0px 0px #03A9F4'
            : '3px 3px 0px 0px rgba(0,0,0,0.3)'
        }}
      >
        <span className="font-mono text-xs uppercase tracking-wide">
          {sectionPlane.enabled
            ? `Cutting at d=${sectionPlane.distance.toFixed(2)}`
            : 'Click a face to cut'}
        </span>
      </div>
    </>
  );
}

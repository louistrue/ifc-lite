/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for 2D annotation tools (polygon area, text, cloud).
 * Handles mouse events, coordinate conversion, snapping, and keyboard shortcuts
 * for the polygon-area, text, and cloud annotation tools.
 *
 * The existing useMeasure2D hook continues to handle linear distance measurements.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { Annotation2DTool, Point2D, TextAnnotation2D } from '@/store/slices/drawing2DSlice';
import { computePolygonArea, computePolygonPerimeter } from '@/components/viewer/tools/computePolygonArea';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface UseAnnotation2DParams {
  drawing: Drawing2D | null;
  viewTransform: { x: number; y: number; scale: number };
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeTool: Annotation2DTool;
  // Polygon area state
  polygonArea2DPoints: Point2D[];
  addPolygonArea2DPoint: (pt: Point2D) => void;
  completePolygonArea2D: (area: number, perimeter: number) => void;
  cancelPolygonArea2D: () => void;
  // Text state
  addTextAnnotation2D: (annotation: TextAnnotation2D) => void;
  setTextAnnotation2DEditing: (id: string | null) => void;
  // Cloud state
  cloudAnnotation2DPoints: Point2D[];
  addCloudAnnotation2DPoint: (pt: Point2D) => void;
  completeCloudAnnotation2D: (label?: string) => void;
  cancelCloudAnnotation2D: () => void;
  // Cursor and snap
  setAnnotation2DCursorPos: (pos: Point2D | null) => void;
  setMeasure2DSnapPoint: (pt: Point2D | null) => void;
}

export interface UseAnnotation2DResult {
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Distance threshold (in screen pixels) for closing a polygon by clicking near the first vertex */
const CLOSE_POLYGON_THRESHOLD_PX = 12;

// ─── Hook implementation ────────────────────────────────────────────────────

export function useAnnotation2D({
  drawing,
  viewTransform,
  sectionAxis,
  containerRef,
  activeTool,
  polygonArea2DPoints,
  addPolygonArea2DPoint,
  completePolygonArea2D,
  cancelPolygonArea2D,
  addTextAnnotation2D,
  setTextAnnotation2DEditing,
  cloudAnnotation2DPoints,
  addCloudAnnotation2DPoint,
  completeCloudAnnotation2D,
  cancelCloudAnnotation2D,
  setAnnotation2DCursorPos,
  setMeasure2DSnapPoint,
}: UseAnnotation2DParams): UseAnnotation2DResult {

  // Shift-constrain state for polygon area tool
  const shiftHeldRef = useRef(false);

  // ── Coordinate conversion ─────────────────────────────────────────────

  const screenToDrawing = useCallback((screenX: number, screenY: number): Point2D => {
    const flipY = sectionAxis !== 'down';
    const flipX = sectionAxis === 'side';
    const scaleX = flipX ? -viewTransform.scale : viewTransform.scale;
    const scaleY = flipY ? -viewTransform.scale : viewTransform.scale;
    return {
      x: (screenX - viewTransform.x) / scaleX,
      y: (screenY - viewTransform.y) / scaleY,
    };
  }, [viewTransform, sectionAxis]);

  // ── Orthogonal constraint (shift held) ────────────────────────────────

  /** Constrain a point to horizontal or vertical relative to an anchor */
  const applyShiftConstraint = useCallback((anchor: Point2D, point: Point2D): Point2D => {
    const dx = Math.abs(point.x - anchor.x);
    const dy = Math.abs(point.y - anchor.y);
    // Lock to whichever axis has the larger delta
    if (dx > dy) {
      return { x: point.x, y: anchor.y }; // horizontal
    } else {
      return { x: anchor.x, y: point.y }; // vertical
    }
  }, []);

  // ── Snap point detection (reuses same logic as useMeasure2D) ──────────

  const nearestPointOnSegment = useCallback((
    p: Point2D, a: Point2D, b: Point2D
  ): { point: Point2D; dist: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) {
      const d = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
      return { point: a, dist: d };
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);
    return { point: nearest, dist };
  }, []);

  const findSnapPoint = useCallback((drawingCoord: Point2D): Point2D | null => {
    if (!drawing) return null;
    const snapThreshold = 10 / viewTransform.scale;
    let bestSnap: Point2D | null = null;
    let bestDist = snapThreshold;

    // Priority 1: polygon vertices
    for (const polygon of drawing.cutPolygons) {
      for (const pt of polygon.polygon.outer) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
      }
      for (const hole of polygon.polygon.holes) {
        for (const pt of hole) {
          const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
          if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
        }
      }
    }

    // Priority 2: line endpoints
    for (const line of drawing.lines) {
      for (const pt of [line.line.start, line.line.end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
      }
    }

    // Priority 3: polygon edges
    for (const polygon of drawing.cutPolygons) {
      const outer = polygon.polygon.outer;
      for (let i = 0; i < outer.length; i++) {
        const { point, dist } = nearestPointOnSegment(drawingCoord, outer[i], outer[(i + 1) % outer.length]);
        if (dist < bestDist) { bestDist = dist; bestSnap = point; }
      }
      for (const hole of polygon.polygon.holes) {
        for (let i = 0; i < hole.length; i++) {
          const { point, dist } = nearestPointOnSegment(drawingCoord, hole[i], hole[(i + 1) % hole.length]);
          if (dist < bestDist) { bestDist = dist; bestSnap = point; }
        }
      }
    }

    // Priority 4: drawing lines
    for (const line of drawing.lines) {
      const { point, dist } = nearestPointOnSegment(drawingCoord, line.line.start, line.line.end);
      if (dist < bestDist) { bestDist = dist; bestSnap = point; }
    }

    return bestSnap;
  }, [drawing, viewTransform.scale, nearestPointOnSegment]);

  // ── Check if clicking near the first polygon vertex (to close) ────────

  const isNearFirstVertex = useCallback((drawingCoord: Point2D): boolean => {
    if (polygonArea2DPoints.length < 3) return false;
    const first = polygonArea2DPoints[0];
    const threshold = CLOSE_POLYGON_THRESHOLD_PX / viewTransform.scale;
    const dx = drawingCoord.x - first.x;
    const dy = drawingCoord.y - first.y;
    return Math.sqrt(dx * dx + dy * dy) < threshold;
  }, [polygonArea2DPoints, viewTransform.scale]);

  // ── Keyboard shortcuts (Escape to cancel, Shift for constraint) ───────

  useEffect(() => {
    if (activeTool === 'none' || activeTool === 'measure') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTool === 'polygon-area') cancelPolygonArea2D();
        else if (activeTool === 'cloud') cancelCloudAnnotation2D();
        else if (activeTool === 'text') setTextAnnotation2DEditing(null);
      }
      if (e.key === 'Shift') {
        shiftHeldRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeldRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTool, cancelPolygonArea2D, cancelCloudAnnotation2D, setTextAnnotation2DEditing]);

  // ── Mouse handlers ────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (activeTool === 'none' || activeTool === 'measure') return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);
    const snapPoint = findSnapPoint(drawingCoord);
    let point = snapPoint || drawingCoord;

    switch (activeTool) {
      case 'polygon-area': {
        // Apply shift constraint relative to the last placed vertex
        if (shiftHeldRef.current && polygonArea2DPoints.length > 0) {
          const lastPt = polygonArea2DPoints[polygonArea2DPoints.length - 1];
          point = applyShiftConstraint(lastPt, point);
        }

        // Check if clicking near first vertex to close the polygon
        if (isNearFirstVertex(point)) {
          const area = computePolygonArea(polygonArea2DPoints);
          const perimeter = computePolygonPerimeter(polygonArea2DPoints);
          completePolygonArea2D(area, perimeter);
        } else {
          addPolygonArea2DPoint(point);
        }
        break;
      }
      case 'text': {
        const annotation: TextAnnotation2D = {
          id: `text-${Date.now()}`,
          position: point,
          text: '',
          fontSize: 14,
          color: '#000000',
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderColor: '#333333',
        };
        addTextAnnotation2D(annotation);
        setTextAnnotation2DEditing(annotation.id);
        break;
      }
      case 'cloud': {
        // Apply shift constraint for cloud second corner (square constraint)
        if (shiftHeldRef.current && cloudAnnotation2DPoints.length === 1) {
          const firstPt = cloudAnnotation2DPoints[0];
          const dx = point.x - firstPt.x;
          const dy = point.y - firstPt.y;
          const maxDelta = Math.max(Math.abs(dx), Math.abs(dy));
          point = {
            x: firstPt.x + Math.sign(dx) * maxDelta,
            y: firstPt.y + Math.sign(dy) * maxDelta,
          };
        }

        if (cloudAnnotation2DPoints.length === 0) {
          // First corner
          addCloudAnnotation2DPoint(point);
        } else {
          // Second corner - complete the cloud
          addCloudAnnotation2DPoint(point);
          // Defer to next tick since state hasn't updated yet
          setTimeout(() => completeCloudAnnotation2D(''), 0);
        }
        break;
      }
    }
  }, [
    activeTool, containerRef, screenToDrawing, findSnapPoint, isNearFirstVertex,
    applyShiftConstraint, polygonArea2DPoints, addPolygonArea2DPoint, completePolygonArea2D,
    addTextAnnotation2D, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, addCloudAnnotation2DPoint, completeCloudAnnotation2D,
  ]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'none' || activeTool === 'measure') return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);
    const snapPoint = findSnapPoint(drawingCoord);

    // Update snap point indicator
    setMeasure2DSnapPoint(snapPoint);

    // Update cursor position for preview rendering
    let point = snapPoint || drawingCoord;

    // Apply shift constraint for polygon area preview line
    if (shiftHeldRef.current && activeTool === 'polygon-area' && polygonArea2DPoints.length > 0) {
      const lastPt = polygonArea2DPoints[polygonArea2DPoints.length - 1];
      point = applyShiftConstraint(lastPt, point);
    }

    // Apply shift constraint for cloud rectangle preview
    if (shiftHeldRef.current && activeTool === 'cloud' && cloudAnnotation2DPoints.length === 1) {
      const firstPt = cloudAnnotation2DPoints[0];
      const dx = point.x - firstPt.x;
      const dy = point.y - firstPt.y;
      const maxDelta = Math.max(Math.abs(dx), Math.abs(dy));
      point = {
        x: firstPt.x + Math.sign(dx) * maxDelta,
        y: firstPt.y + Math.sign(dy) * maxDelta,
      };
    }

    setAnnotation2DCursorPos(point);
  }, [activeTool, containerRef, screenToDrawing, findSnapPoint, setMeasure2DSnapPoint,
    setAnnotation2DCursorPos, applyShiftConstraint, polygonArea2DPoints, cloudAnnotation2DPoints]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'polygon-area') return;
    if (polygonArea2DPoints.length < 3) return;

    e.preventDefault();
    const area = computePolygonArea(polygonArea2DPoints);
    const perimeter = computePolygonPerimeter(polygonArea2DPoints);
    completePolygonArea2D(area, perimeter);
  }, [activeTool, polygonArea2DPoints, completePolygonArea2D]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleDoubleClick,
  };
}

export default useAnnotation2D;

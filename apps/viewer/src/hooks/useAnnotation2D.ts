/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for 2D annotation tools (polygon area, text, cloud).
 * Handles mouse events, coordinate conversion, snapping, keyboard shortcuts,
 * annotation selection, drag-to-move, and delete.
 *
 * The existing useMeasure2D hook continues to handle linear distance measurements.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type {
  Annotation2DTool, Point2D, TextAnnotation2D,
  SelectedAnnotation2D, Measure2DResult, PolygonArea2DResult, CloudAnnotation2D,
} from '@/store/slices/drawing2DSlice';
import { computePolygonArea, computePolygonPerimeter, computePolygonCentroid } from '@/components/viewer/tools/computePolygonArea';

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
  textAnnotations2D: TextAnnotation2D[];
  addTextAnnotation2D: (annotation: TextAnnotation2D) => void;
  setTextAnnotation2DEditing: (id: string | null) => void;
  // Cloud state
  cloudAnnotation2DPoints: Point2D[];
  cloudAnnotations2D: CloudAnnotation2D[];
  addCloudAnnotation2DPoint: (pt: Point2D) => void;
  completeCloudAnnotation2D: (label?: string) => void;
  cancelCloudAnnotation2D: () => void;
  // Completed results (for hit testing)
  measure2DResults: Measure2DResult[];
  polygonArea2DResults: PolygonArea2DResult[];
  // Selection
  selectedAnnotation2D: SelectedAnnotation2D | null;
  setSelectedAnnotation2D: (sel: SelectedAnnotation2D | null) => void;
  deleteSelectedAnnotation2D: () => void;
  startDragAnnotation2D: (offset: Point2D) => void;
  moveAnnotation2D: (drawingPos: Point2D) => void;
  stopDragAnnotation2D: () => void;
  draggingAnnotation2D: boolean;
  // Cursor and snap
  setAnnotation2DCursorPos: (pos: Point2D | null) => void;
  setMeasure2DSnapPoint: (pt: Point2D | null) => void;
}

export interface UseAnnotation2DResult {
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CLOSE_POLYGON_THRESHOLD_PX = 12;
/** Hit-test radius in screen pixels */
const HIT_TEST_RADIUS_PX = 10;

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
  textAnnotations2D,
  addTextAnnotation2D,
  setTextAnnotation2DEditing,
  cloudAnnotation2DPoints,
  cloudAnnotations2D,
  addCloudAnnotation2DPoint,
  completeCloudAnnotation2D,
  cancelCloudAnnotation2D,
  measure2DResults,
  polygonArea2DResults,
  selectedAnnotation2D,
  setSelectedAnnotation2D,
  deleteSelectedAnnotation2D,
  startDragAnnotation2D,
  moveAnnotation2D,
  stopDragAnnotation2D,
  draggingAnnotation2D,
  setAnnotation2DCursorPos,
  setMeasure2DSnapPoint,
}: UseAnnotation2DParams): UseAnnotation2DResult {

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

  const drawingToScreen = useCallback((pt: Point2D): { x: number; y: number } => {
    const scaleX = sectionAxis === 'side' ? -viewTransform.scale : viewTransform.scale;
    const scaleY = sectionAxis === 'down' ? viewTransform.scale : -viewTransform.scale;
    return {
      x: pt.x * scaleX + viewTransform.x,
      y: pt.y * scaleY + viewTransform.y,
    };
  }, [viewTransform, sectionAxis]);

  // ── Orthogonal constraint (shift held) ────────────────────────────────

  const applyShiftConstraint = useCallback((anchor: Point2D, point: Point2D): Point2D => {
    const dx = Math.abs(point.x - anchor.x);
    const dy = Math.abs(point.y - anchor.y);
    if (dx > dy) {
      return { x: point.x, y: anchor.y };
    } else {
      return { x: anchor.x, y: point.y };
    }
  }, []);

  // ── Snap point detection ──────────────────────────────────────────────

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

    for (const line of drawing.lines) {
      for (const pt of [line.line.start, line.line.end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
      }
    }

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

    for (const line of drawing.lines) {
      const { point, dist } = nearestPointOnSegment(drawingCoord, line.line.start, line.line.end);
      if (dist < bestDist) { bestDist = dist; bestSnap = point; }
    }

    return bestSnap;
  }, [drawing, viewTransform.scale, nearestPointOnSegment]);

  // ── Hit-testing for annotation selection ──────────────────────────────

  /** Check if a screen point hits any existing annotation. Returns the hit or null. */
  const hitTestAnnotations = useCallback((screenX: number, screenY: number): SelectedAnnotation2D | null => {
    const threshold = HIT_TEST_RADIUS_PX;

    // Test text annotations (highest priority — small precise targets)
    for (const annotation of textAnnotations2D) {
      if (!annotation.text.trim()) continue;
      const sp = drawingToScreen(annotation.position);
      // Approximate text box bounds in screen space
      const fontSize = annotation.fontSize;
      const lines = annotation.text.split('\n');
      const lineHeight = fontSize * 1.3;
      const padding = 6;
      // We don't know exact width without a canvas context, so estimate
      const approxCharWidth = fontSize * 0.6;
      const maxLineLen = Math.max(...lines.map((l) => l.length));
      const w = maxLineLen * approxCharWidth + padding * 2;
      const h = lines.length * lineHeight + padding * 2;

      if (screenX >= sp.x - 2 && screenX <= sp.x + w + 2 &&
          screenY >= sp.y - 2 && screenY <= sp.y + h + 2) {
        return { type: 'text', id: annotation.id };
      }
    }

    // Test cloud annotations (rectangle bounds)
    for (const cloud of cloudAnnotations2D) {
      if (cloud.points.length < 2) continue;
      const sp1 = drawingToScreen(cloud.points[0]);
      const sp2 = drawingToScreen(cloud.points[1]);
      const minX = Math.min(sp1.x, sp2.x);
      const maxX = Math.max(sp1.x, sp2.x);
      const minY = Math.min(sp1.y, sp2.y);
      const maxY = Math.max(sp1.y, sp2.y);

      // Check if near the rectangle border (not just inside fill)
      const nearLeft = Math.abs(screenX - minX) < threshold && screenY >= minY - threshold && screenY <= maxY + threshold;
      const nearRight = Math.abs(screenX - maxX) < threshold && screenY >= minY - threshold && screenY <= maxY + threshold;
      const nearTop = Math.abs(screenY - minY) < threshold && screenX >= minX - threshold && screenX <= maxX + threshold;
      const nearBottom = Math.abs(screenY - maxY) < threshold && screenX >= minX - threshold && screenX <= maxX + threshold;
      // Also hit if inside
      const inside = screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY;

      if (nearLeft || nearRight || nearTop || nearBottom || inside) {
        return { type: 'cloud', id: cloud.id };
      }
    }

    // Test polygon area results (check near edges or centroid label)
    for (const result of polygonArea2DResults) {
      if (result.points.length < 3) continue;
      // Check near any edge
      for (let i = 0; i < result.points.length; i++) {
        const a = drawingToScreen(result.points[i]);
        const b = drawingToScreen(result.points[(i + 1) % result.points.length]);
        const { dist } = nearestPointOnScreenSegment({ x: screenX, y: screenY }, a, b);
        if (dist < threshold) {
          return { type: 'polygon', id: result.id };
        }
      }
      // Check near centroid label
      const centroid = computePolygonCentroid(result.points);
      const sc = drawingToScreen(centroid);
      if (Math.abs(screenX - sc.x) < 40 && Math.abs(screenY - sc.y) < 20) {
        return { type: 'polygon', id: result.id };
      }
    }

    // Test measure results (check near line)
    for (const result of measure2DResults) {
      const sa = drawingToScreen(result.start);
      const sb = drawingToScreen(result.end);
      const { dist } = nearestPointOnScreenSegment({ x: screenX, y: screenY }, sa, sb);
      if (dist < threshold) {
        return { type: 'measure', id: result.id };
      }
    }

    return null;
  }, [textAnnotations2D, cloudAnnotations2D, polygonArea2DResults, measure2DResults, drawingToScreen]);

  const isNearFirstVertex = useCallback((drawingCoord: Point2D): boolean => {
    if (polygonArea2DPoints.length < 3) return false;
    const first = polygonArea2DPoints[0];
    const threshold = CLOSE_POLYGON_THRESHOLD_PX / viewTransform.scale;
    const dx = drawingCoord.x - first.x;
    const dy = drawingCoord.y - first.y;
    return Math.sqrt(dx * dx + dy * dy) < threshold;
  }, [polygonArea2DPoints, viewTransform.scale]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeldRef.current = true;
      }
      if (e.key === 'Escape') {
        if (activeTool === 'polygon-area') cancelPolygonArea2D();
        else if (activeTool === 'cloud') cancelCloudAnnotation2D();
        else if (activeTool === 'text') setTextAnnotation2DEditing(null);
        // Also deselect on Escape
        if (selectedAnnotation2D) setSelectedAnnotation2D(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation2D) {
        // Don't delete if a text input/textarea is focused
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        deleteSelectedAnnotation2D();
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
  }, [activeTool, selectedAnnotation2D, cancelPolygonArea2D, cancelCloudAnnotation2D,
    setTextAnnotation2DEditing, setSelectedAnnotation2D, deleteSelectedAnnotation2D]);

  // ── Mouse handlers ────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);

    // ── Tool-specific placement (only when a creation tool is active) ───
    if (activeTool !== 'none' && activeTool !== 'measure') {
      const snapPoint = findSnapPoint(drawingCoord);
      let point = snapPoint || drawingCoord;

      switch (activeTool) {
        case 'polygon-area': {
          if (shiftHeldRef.current && polygonArea2DPoints.length > 0) {
            const lastPt = polygonArea2DPoints[polygonArea2DPoints.length - 1];
            point = applyShiftConstraint(lastPt, point);
          }
          if (isNearFirstVertex(point)) {
            const area = computePolygonArea(polygonArea2DPoints);
            const perimeter = computePolygonPerimeter(polygonArea2DPoints);
            completePolygonArea2D(area, perimeter);
          } else {
            addPolygonArea2DPoint(point);
          }
          return;
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
          return;
        }
        case 'cloud': {
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
            addCloudAnnotation2DPoint(point);
          } else {
            addCloudAnnotation2DPoint(point);
            setTimeout(() => completeCloudAnnotation2D(''), 0);
          }
          return;
        }
      }
    }

    // ── Selection / drag mode (tool is 'none' or 'measure') ─────────────
    const hit = hitTestAnnotations(screenX, screenY);
    if (hit) {
      setSelectedAnnotation2D(hit);
      // Calculate drag offset: distance from click to the annotation's origin
      const origin = getAnnotationOrigin(hit);
      if (origin) {
        startDragAnnotation2D({
          x: drawingCoord.x - origin.x,
          y: drawingCoord.y - origin.y,
        });
      }
    } else {
      // Clicked empty space — deselect
      if (selectedAnnotation2D) {
        setSelectedAnnotation2D(null);
      }
    }
  }, [
    activeTool, containerRef, screenToDrawing, findSnapPoint, isNearFirstVertex,
    applyShiftConstraint, polygonArea2DPoints, addPolygonArea2DPoint, completePolygonArea2D,
    addTextAnnotation2D, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, addCloudAnnotation2DPoint, completeCloudAnnotation2D,
    hitTestAnnotations, selectedAnnotation2D, setSelectedAnnotation2D, startDragAnnotation2D,
  ]);

  /** Get the origin point of an annotation (used for drag offset) */
  const getAnnotationOrigin = useCallback((sel: SelectedAnnotation2D): Point2D | null => {
    switch (sel.type) {
      case 'measure': {
        const r = measure2DResults.find((m) => m.id === sel.id);
        return r ? r.start : null;
      }
      case 'polygon': {
        const r = polygonArea2DResults.find((p) => p.id === sel.id);
        return r && r.points.length > 0 ? r.points[0] : null;
      }
      case 'text': {
        const a = textAnnotations2D.find((t) => t.id === sel.id);
        return a ? a.position : null;
      }
      case 'cloud': {
        const c = cloudAnnotations2D.find((cl) => cl.id === sel.id);
        return c && c.points.length > 0 ? c.points[0] : null;
      }
    }
    return null;
  }, [measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);

    // ── Dragging a selected annotation ──────────────────────────────────
    if (draggingAnnotation2D && selectedAnnotation2D) {
      moveAnnotation2D(drawingCoord);
      return;
    }

    // ── Tool preview (only for creation tools) ──────────────────────────
    if (activeTool === 'none' || activeTool === 'measure') return;

    const snapPoint = findSnapPoint(drawingCoord);
    setMeasure2DSnapPoint(snapPoint);

    let point = snapPoint || drawingCoord;

    if (shiftHeldRef.current && activeTool === 'polygon-area' && polygonArea2DPoints.length > 0) {
      const lastPt = polygonArea2DPoints[polygonArea2DPoints.length - 1];
      point = applyShiftConstraint(lastPt, point);
    }

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
    setAnnotation2DCursorPos, applyShiftConstraint, polygonArea2DPoints, cloudAnnotation2DPoints,
    draggingAnnotation2D, selectedAnnotation2D, moveAnnotation2D]);

  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
    if (draggingAnnotation2D) {
      stopDragAnnotation2D();
    }
  }, [draggingAnnotation2D, stopDragAnnotation2D]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Double-click to close polygon
    if (activeTool === 'polygon-area' && polygonArea2DPoints.length >= 3) {
      e.preventDefault();
      const area = computePolygonArea(polygonArea2DPoints);
      const perimeter = computePolygonPerimeter(polygonArea2DPoints);
      completePolygonArea2D(area, perimeter);
      return;
    }

    // Double-click on a text annotation to edit it
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const hit = hitTestAnnotations(screenX, screenY);
    if (hit && hit.type === 'text') {
      e.preventDefault();
      setSelectedAnnotation2D(hit);
      setTextAnnotation2DEditing(hit.id);
    }
  }, [activeTool, polygonArea2DPoints, completePolygonArea2D, containerRef,
    hitTestAnnotations, setSelectedAnnotation2D, setTextAnnotation2DEditing]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
  };
}

// ─── Helper: nearest point on a screen-space segment ────────────────────────

function nearestPointOnScreenSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { point: { x: number; y: number }; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.01) {
    const d = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    return { point: a, dist: d };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nearest = { x: a.x + t * dx, y: a.y + t * dy };
  const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);
  return { point: nearest, dist };
}

export default useAnnotation2D;

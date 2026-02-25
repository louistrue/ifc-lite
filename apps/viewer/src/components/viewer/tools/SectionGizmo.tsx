/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useViewerStore } from '@/store';
import { calculateProjectionRange } from '../../../utils/viewportUtils.js';

interface GizmoScreenState {
  center: { x: number; y: number };
  arrowEnd: { x: number; y: number };
  visible: boolean;
}

interface DragState {
  kind: 'arrow' | 'plane';
  startPointer: { x: number; y: number };
  startPosition: number;
  axisDir: { x: number; y: number };
  axisPixelLength: number;
  rangeLength: number;
}

function normalize3(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function SectionGizmo() {
  const activeTool = useViewerStore((s) => s.activeTool);
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const coordinateInfo = useViewerStore((s) => s.geometryResult?.coordinateInfo);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);

  const [screenState, setScreenState] = useState<GizmoScreenState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const planeMath = useMemo(() => {
    const bounds = coordinateInfo?.shiftedBounds;
    if (!bounds) return null;

    let normal = sectionPlane.mode === 'surface' ? sectionPlane.surface?.normal ?? null : null;
    if (!normal) {
      normal = sectionPlane.axis === 'side'
        ? { x: 1, y: 0, z: 0 }
        : sectionPlane.axis === 'down'
          ? { x: 0, y: 1, z: 0 }
          : { x: 0, y: 0, z: 1 };
    }

    const n = normalize3(normal);
    const range = sectionPlane.mode === 'surface'
      ? calculateProjectionRange(bounds, n)
      : (() => {
        const axisKey = sectionPlane.axis === 'side' ? 'x' : sectionPlane.axis === 'down' ? 'y' : 'z';
        const min = bounds.min[axisKey];
        const max = bounds.max[axisKey];
        return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
      })();

    if (!range) return null;

    const distance = range.min + (sectionPlane.position / 100) * (range.max - range.min);
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };

    const centerDot = dot3(center, n);
    const centerOnPlane = {
      x: center.x + (distance - centerDot) * n.x,
      y: center.y + (distance - centerDot) * n.y,
      z: center.z + (distance - centerDot) * n.z,
    };

    const diag = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
    const arrowLength = Math.max(2, diag * 0.12);

    return {
      normal: n,
      range,
      centerOnPlane,
      arrowEnd: {
        x: centerOnPlane.x + n.x * arrowLength,
        y: centerOnPlane.y + n.y * arrowLength,
        z: centerOnPlane.z + n.z * arrowLength,
      },
      arrowLength,
    };
  }, [coordinateInfo, sectionPlane]);

  useEffect(() => {
    if (activeTool !== 'section') {
      setScreenState(null);
      return;
    }

    let raf: number | null = null;
    const tick = () => {
      const projectToScreen = cameraCallbacks.projectToScreen;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-viewport="main"]');
      if (!projectToScreen || !planeMath || !canvas) {
        setScreenState(null);
        raf = requestAnimationFrame(tick);
        return;
      }

      const centerRaw = projectToScreen(planeMath.centerOnPlane);
      const arrowRaw = projectToScreen(planeMath.arrowEnd);

      if (!centerRaw || !arrowRaw || canvas.width <= 0 || canvas.height <= 0) {
        setScreenState(null);
        raf = requestAnimationFrame(tick);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;

      const center = { x: centerRaw.x * scaleX, y: centerRaw.y * scaleY };
      const arrowEnd = { x: arrowRaw.x * scaleX, y: arrowRaw.y * scaleY };

      setScreenState({ center, arrowEnd, visible: true });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [activeTool, cameraCallbacks.projectToScreen, planeMath]);

  const beginDrag = useCallback((kind: 'arrow' | 'plane', e: ReactPointerEvent) => {
    if (!screenState || !planeMath) return;
    if (kind === 'plane' && !e.shiftKey) return;

    const dx = screenState.arrowEnd.x - screenState.center.x;
    const dy = screenState.arrowEnd.y - screenState.center.y;
    const axisPixelLength = Math.hypot(dx, dy);
    if (axisPixelLength < 5) return;

    dragStateRef.current = {
      kind,
      startPointer: { x: e.clientX, y: e.clientY },
      startPosition: sectionPlane.position,
      axisDir: { x: dx / axisPixelLength, y: dy / axisPixelLength },
      axisPixelLength,
      rangeLength: Math.max(1e-6, planeMath.range.max - planeMath.range.min),
    };

    setIsDragging(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, [planeMath, screenState, sectionPlane.position]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || !planeMath) return;

    const moveX = e.clientX - drag.startPointer.x;
    const moveY = e.clientY - drag.startPointer.y;
    const projectedPx = moveX * drag.axisDir.x + moveY * drag.axisDir.y;

    const worldDelta = (projectedPx / drag.axisPixelLength) * planeMath.arrowLength;
    const percentDelta = (worldDelta / drag.rangeLength) * 100;
    setSectionPlanePosition(drag.startPosition + percentDelta);

    e.preventDefault();
    e.stopPropagation();
  }, [planeMath, setSectionPlanePosition]);

  const endDrag = useCallback((e: ReactPointerEvent) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    setIsDragging(false);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (activeTool !== 'section' || !screenState?.visible) {
    return null;
  }

  const color = sectionPlane.mode === 'surface' ? '#A855F7' : sectionPlane.axis === 'down' ? '#03A9F4' : sectionPlane.axis === 'front' ? '#4CAF50' : '#FF9800';
  const planeSize = 28;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <line
        x1={screenState.center.x}
        y1={screenState.center.y}
        x2={screenState.arrowEnd.x}
        y2={screenState.arrowEnd.y}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.9}
      />
      <polygon
        points={`${screenState.arrowEnd.x},${screenState.arrowEnd.y} ${screenState.arrowEnd.x - 8},${screenState.arrowEnd.y + 5} ${screenState.arrowEnd.x - 8},${screenState.arrowEnd.y - 5}`}
        fill={color}
        className="pointer-events-auto cursor-grab"
        onPointerDown={(e) => beginDrag('arrow', e)}
      />
      <rect
        x={screenState.center.x - planeSize / 2}
        y={screenState.center.y - planeSize / 2}
        width={planeSize}
        height={planeSize}
        fill={color}
        fillOpacity={0.2}
        stroke={color}
        strokeWidth={2}
        className={`pointer-events-auto ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={(e) => beginDrag('plane', e)}
      />
      <text
        x={screenState.center.x}
        y={screenState.center.y + planeSize / 2 + 14}
        textAnchor="middle"
        fill={color}
        fontSize="10"
        fontFamily="monospace"
      >
        {`Hold Shift + drag plane`}
      </text>
    </svg>
  );
}

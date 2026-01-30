/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Handles Overlay
 *
 * SVG overlay that displays interactive manipulation handles for geometry editing.
 * Provides:
 * - Dimension handles for parametric editing (width, height, depth)
 * - Drag interaction for live parameter updates
 * - Visual feedback during manipulation
 */

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { useViewerStore } from '@/store';
import { useGeometryEdit } from '@/hooks/useGeometryEdit';
import type { GeometryParameter } from '@ifc-lite/geometry-edit';
import type { Vec3 } from '@ifc-lite/geometry';

interface HandlePosition {
  x: number;
  y: number;
  parameter: GeometryParameter;
  direction: Vec3; // Direction the handle moves in world space
  label: string;
}

interface GeometryHandlesProps {
  containerRef: React.RefObject<HTMLDivElement>;
}

// worldToScreen removed - using camera callback projectToScreen instead

export function GeometryHandles({ containerRef }: GeometryHandlesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<{
    handle: HandlePosition;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);

  const { session, isEditing, updateParameter, constraintAxis } = useGeometryEdit();

  // Get camera matrices for projection
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);

  // Calculate handle positions from editable parameters
  const handles = useMemo<HandlePosition[]>(() => {
    if (!isEditing || !session) return [];

    const result: HandlePosition[] = [];
    const entity = session.entity;

    // Get entity center position (simplified - would need actual geometry bounds)
    const center: Vec3 = { x: 0, y: 0, z: 0 };

    // Extract dimension parameters and create handles for them
    for (const param of entity.parameters) {
      if (!param.editable) continue;

      // Only create handles for numeric dimension parameters
      if (param.type !== 'number') continue;

      const value = param.value as number;
      if (typeof value !== 'number') continue;

      // Determine handle direction based on parameter name
      let direction: Vec3 = { x: 0, y: 0, z: 0 };
      let offset: Vec3 = { x: 0, y: 0, z: 0 };

      if (param.path.includes('width') || param.path.includes('xDim')) {
        direction = { x: 1, y: 0, z: 0 };
        offset = { x: value / 2, y: 0, z: 0 };
      } else if (param.path.includes('height') || param.path.includes('yDim')) {
        direction = { x: 0, y: 1, z: 0 };
        offset = { x: 0, y: value / 2, z: 0 };
      } else if (param.path.includes('depth')) {
        direction = { x: 0, y: 0, z: 1 };
        offset = { x: 0, y: 0, z: value / 2 };
      } else if (param.path.includes('radius')) {
        direction = { x: 1, y: 0, z: 0 };
        offset = { x: value, y: 0, z: 0 };
      } else {
        continue; // Skip non-dimension parameters
      }

      // Calculate handle position in world space
      const handlePos: Vec3 = {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      };

      result.push({
        x: handlePos.x,
        y: handlePos.y,
        parameter: param,
        direction,
        label: param.displayName,
      });
    }

    return result;
  }, [isEditing, session]);

  // Project handles to screen space using camera projectToScreen callback
  const screenHandles = useMemo(() => {
    if (handles.length === 0 || !cameraCallbacks?.projectToScreen) return [];

    return handles
      .map((handle) => {
        const screen = cameraCallbacks.projectToScreen!({ x: handle.x, y: handle.y, z: 0 });
        if (!screen) return null;
        return {
          ...handle,
          screenX: screen.x,
          screenY: screen.y,
          visible: true,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  }, [handles, cameraCallbacks]);

  // Handle drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.preventDefault();
      e.stopPropagation();

      const value = handle.parameter.value;
      if (typeof value !== 'number') return;

      setDragging({
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startValue: value,
      });
    },
    []
  );

  // Handle drag move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;

      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;

      // Calculate movement along handle direction
      // Apply constraint axis if set
      let movement = 0;
      const { direction } = dragging.handle;

      if (constraintAxis === 'x' && direction.x !== 0) {
        movement = dx * 0.01 * direction.x;
      } else if (constraintAxis === 'y' && direction.y !== 0) {
        movement = -dy * 0.01 * direction.y;
      } else if (constraintAxis === 'z' && direction.z !== 0) {
        movement = -dy * 0.01 * direction.z;
      } else {
        // Default: use primary direction
        if (Math.abs(direction.x) > 0.5) {
          movement = dx * 0.01;
        } else if (Math.abs(direction.y) > 0.5) {
          movement = -dy * 0.01;
        } else {
          movement = -dy * 0.01;
        }
      }

      // Calculate new value
      const newValue = Math.max(0.001, dragging.startValue + movement);

      // Update parameter with live preview
      updateParameter(dragging.handle.parameter, newValue);
    },
    [dragging, constraintAxis, updateParameter]
  );

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Global mouse event listeners for dragging
  useEffect(() => {
    if (!dragging) return;

    const handleGlobalMove = (e: MouseEvent) => {
      handleMouseMove(e as unknown as React.MouseEvent);
    };

    const handleGlobalUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  if (!isEditing || screenHandles.length === 0) {
    return null;
  }

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: dimensions.width, height: dimensions.height }}
    >
      {/* Dimension lines and handles */}
      {screenHandles.map((handle, index) => {
        const isActive = dragging?.handle.parameter.path === handle.parameter.path;
        const handleSize = isActive ? 10 : 8;
        const color = isActive
          ? '#f59e0b'
          : handle.direction.x !== 0
          ? '#ef4444'
          : handle.direction.y !== 0
          ? '#22c55e'
          : '#3b82f6';

        return (
          <g key={`${handle.parameter.path}-${index}`}>
            {/* Handle circle */}
            <circle
              cx={handle.screenX}
              cy={handle.screenY}
              r={handleSize}
              fill={color}
              stroke="white"
              strokeWidth={2}
              className="pointer-events-auto cursor-move"
              style={{
                filter: isActive ? 'drop-shadow(0 0 4px rgba(245, 158, 11, 0.5))' : undefined,
              }}
              onMouseDown={(e) => handleMouseDown(e, handle)}
            />

            {/* Value label */}
            <text
              x={handle.screenX}
              y={handle.screenY - handleSize - 8}
              textAnchor="middle"
              className="text-[10px] font-mono fill-white pointer-events-none"
              style={{
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {(handle.parameter.value as number).toFixed(2)}
              {handle.parameter.unit ? ` ${handle.parameter.unit}` : ''}
            </text>

            {/* Parameter name */}
            <text
              x={handle.screenX}
              y={handle.screenY + handleSize + 14}
              textAnchor="middle"
              className="text-[9px] uppercase fill-zinc-400 pointer-events-none"
              style={{
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {handle.label}
            </text>
          </g>
        );
      })}

      {/* Axis indicator when constraining */}
      {constraintAxis && (
        <text
          x={20}
          y={dimensions.height - 20}
          className="text-sm font-bold fill-white pointer-events-none"
          style={{
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}
        >
          Constrained to {constraintAxis.toUpperCase()} axis
        </text>
      )}
    </svg>
  );
}

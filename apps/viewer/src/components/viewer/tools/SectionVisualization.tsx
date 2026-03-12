/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane 3D gizmo overlay
 *
 * Renders an interactive SVG gizmo on top of the 3D viewport:
 * - Draggable arrow handle along the section axis
 * - Axis indicator badge
 * - Visual feedback during drag (color, scale)
 *
 * The gizmo is positioned at the right edge of the viewport, vertically centered.
 * Dragging up/down adjusts the section plane position along its axis.
 */

import React, { useCallback, useEffect } from 'react';
import { useViewerStore } from '@/store';
import { AXIS_INFO, GIZMO_COLORS, GIZMO_AXIS_SENSITIVITY, GIZMO_FACE_SENSITIVITY } from './sectionConstants';

export function SectionPlaneVisualization() {
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const startGizmoDrag = useViewerStore((s) => s.startGizmoDrag);
  const updateGizmoDrag = useViewerStore((s) => s.updateGizmoDrag);
  const endGizmoDrag = useViewerStore((s) => s.endGizmoDrag);
  const dragging = sectionPlane.gizmo.dragging;

  const color = sectionPlane.mode === 'face'
    ? GIZMO_COLORS.face
    : GIZMO_COLORS[sectionPlane.axis];

  const sensitivity = sectionPlane.mode === 'face'
    ? GIZMO_FACE_SENSITIVITY
    : GIZMO_AXIS_SENSITIVITY;

  // Global pointer move/up while dragging (captured via window)
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      updateGizmoDrag(e.clientY, sensitivity);
    };

    const handleUp = () => {
      endGizmoDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endGizmoDrag();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dragging, updateGizmoDrag, endGizmoDrag, sensitivity]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startGizmoDrag(e.clientY);
  }, [startGizmoDrag]);

  const label = sectionPlane.mode === 'face'
    ? 'FACE'
    : AXIS_INFO[sectionPlane.axis].label.toUpperCase();

  // Arrow direction: Down axis = vertical (pointing up/down), Front/Side = rotated 90 degrees
  const isVertical = sectionPlane.mode === 'face' || sectionPlane.axis === 'down';

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id="gizmo-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="gizmo-shadow">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.4)" />
        </filter>
      </defs>

      {/* Axis badge (top-left corner) */}
      <g transform="translate(24, 24)">
        <rect
          x="2" y="2" width="36" height="36" rx="8"
          fill={color}
          fillOpacity={sectionPlane.enabled ? 0.15 : 0.08}
          stroke={color}
          strokeWidth={sectionPlane.enabled ? 2 : 1}
          strokeOpacity={0.6}
        />
        <text
          x="20" y="17"
          textAnchor="middle" dominantBaseline="central"
          fill={color} fontFamily="monospace" fontSize="10" fontWeight="bold"
        >
          {label}
        </text>
        {sectionPlane.enabled && (
          <text
            x="20" y="29"
            textAnchor="middle"
            fill={color} fontFamily="monospace" fontSize="7" fontWeight="bold" opacity={0.8}
          >
            CUT
          </text>
        )}
      </g>

      {/* Gizmo handle (right edge, vertically centered) */}
      <g style={{ pointerEvents: 'auto' }}>
        {/* Position the gizmo: for vertical axes it's on the right edge;
            for horizontal axes (front/side) it's at the bottom-center */}
        <g
          transform={isVertical
            ? 'translate(calc(100% - 36), 50%)'
            : 'translate(50%, calc(100% - 36))'
          }
          style={{
            transform: isVertical
              ? 'translate(calc(100% - 36px), calc(50%))'
              : 'translate(calc(50%), calc(100% - 36px))',
          }}
        >
          <g
            style={{
              cursor: dragging ? 'grabbing' : 'grab',
              transform: isVertical ? 'rotate(0deg)' : 'rotate(90deg)',
              transformOrigin: '0 0',
            }}
            onPointerDown={handlePointerDown}
          >
            {/* Invisible hit area */}
            <rect x="-18" y="-44" width="36" height="88" fill="transparent" />

            {/* Arrow shaft */}
            <line
              x1="0" y1="-28" x2="0" y2="28"
              stroke={color}
              strokeWidth={dragging ? 3.5 : 2.5}
              strokeLinecap="round"
              filter="url(#gizmo-glow)"
              opacity={dragging ? 1 : 0.7}
            />

            {/* Top arrowhead */}
            <polygon
              points="0,-36 -7,-24 7,-24"
              fill={color}
              filter="url(#gizmo-glow)"
              opacity={dragging ? 1 : 0.7}
            />

            {/* Bottom arrowhead */}
            <polygon
              points="0,36 -7,24 7,24"
              fill={color}
              filter="url(#gizmo-glow)"
              opacity={dragging ? 1 : 0.7}
            />

            {/* Center handle dot */}
            <circle
              cx="0" cy="0"
              r={dragging ? 9 : 7}
              fill={color}
              stroke="white"
              strokeWidth="2"
              filter="url(#gizmo-shadow)"
            />

            {/* Drag feedback ring */}
            {dragging && (
              <circle
                cx="0" cy="0" r="14"
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity={0.5}
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 0 0" to="360 0 0"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}

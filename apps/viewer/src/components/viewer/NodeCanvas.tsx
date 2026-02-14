/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * NodeCanvas — SVG-based visual node graph editor.
 *
 * Renders a DAG of nodes connected by bezier curve edges.
 * Supports drag-to-move, port-to-port connections, zoom, and pan.
 * All state lives in the parent component (or store) via callbacks.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import type { Graph, GraphNode, GraphEdge, NodeDefinition } from '@ifc-lite/node-registry';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

const NODE_WIDTH = 200;
const NODE_HEADER_HEIGHT = 32;
const PORT_RADIUS = 6;
const PORT_SPACING = 28;
const NODE_PADDING = 8;
const GRID_SIZE = 20;

/** Category → color mapping */
const CATEGORY_COLORS: Record<string, string> = {
  Query: '#3b82f6',      // blue
  Viewer: '#8b5cf6',     // violet
  Data: '#06b6d4',       // cyan
  Mutation: '#f59e0b',   // amber
  Export: '#10b981',     // emerald
  Validation: '#ef4444', // red
  Drawing: '#ec4899',    // pink
  Analysis: '#6366f1',   // indigo
  Script: '#64748b',     // slate
  Input: '#84cc16',      // lime
  Spatial: '#14b8a6',    // teal
  Lens: '#a855f7',       // purple
};

// ============================================================================
// Types
// ============================================================================

interface NodeCanvasProps {
  graph: Graph;
  nodeDefinitions: Map<string, NodeDefinition>;
  onNodeMove: (nodeId: string, x: number, y: number) => void;
  onEdgeAdd: (edge: GraphEdge) => void;
  onEdgeRemove: (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => void;
  onNodeRemove: (nodeId: string) => void;
  onNodeAdd: (definitionId: string, x: number, y: number) => void;
  className?: string;
}

interface DragState {
  type: 'node' | 'wire' | 'pan';
  nodeId?: string;
  offsetX?: number;
  offsetY?: number;
  // Wire drag state
  sourceNodeId?: string;
  sourcePortId?: string;
  sourceIsOutput?: boolean;
  wireEndX?: number;
  wireEndY?: number;
  // Pan state
  startViewX?: number;
  startViewY?: number;
  startMouseX?: number;
  startMouseY?: number;
}

// ============================================================================
// Component
// ============================================================================

export function NodeCanvas({
  graph,
  nodeDefinitions,
  onNodeMove,
  onEdgeAdd,
  onEdgeRemove,
  onNodeRemove,
  onNodeAdd,
  className,
}: NodeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: -50, y: -50, w: 1200, h: 800 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState<{ x: number; y: number } | null>(null);

  /** Convert screen coords to SVG coords */
  const screenToSvg = useCallback(
    (screenX: number, screenY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: viewBox.x + ((screenX - rect.left) / rect.width) * viewBox.w,
        y: viewBox.y + ((screenY - rect.top) / rect.height) * viewBox.h,
      };
    },
    [viewBox],
  );

  /** Get port position for a node */
  const getPortPos = useCallback(
    (node: GraphNode, portId: string, isOutput: boolean) => {
      const def = nodeDefinitions.get(node.definitionId);
      if (!def) return { x: node.position.x, y: node.position.y };

      const ports = isOutput ? def.outputs : def.inputs;
      const idx = ports.findIndex((p) => p.id === portId);
      if (idx < 0) return { x: node.position.x, y: node.position.y };

      const nodeHeight = NODE_HEADER_HEIGHT + Math.max(def.inputs.length, def.outputs.length) * PORT_SPACING + NODE_PADDING;
      const yStart = node.position.y + NODE_HEADER_HEIGHT + PORT_SPACING / 2;

      return {
        x: isOutput ? node.position.x + NODE_WIDTH : node.position.x,
        y: yStart + idx * PORT_SPACING,
      };
    },
    [nodeDefinitions],
  );

  // ── Mouse handlers ──

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Click on background → start pan or deselect
      if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList?.contains('canvas-bg')) {
        setSelectedNodeId(null);
        setShowPalette(null);
        setDragState({
          type: 'pan',
          startViewX: viewBox.x,
          startViewY: viewBox.y,
          startMouseX: e.clientX,
          startMouseY: e.clientY,
        });
      }
    },
    [viewBox],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState) return;

      if (dragState.type === 'pan') {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const dx = ((e.clientX - dragState.startMouseX!) / rect.width) * viewBox.w;
        const dy = ((e.clientY - dragState.startMouseY!) / rect.height) * viewBox.h;
        setViewBox({
          ...viewBox,
          x: dragState.startViewX! - dx,
          y: dragState.startViewY! - dy,
        });
        return;
      }

      if (dragState.type === 'node' && dragState.nodeId) {
        const pos = screenToSvg(e.clientX, e.clientY);
        const x = Math.round((pos.x - (dragState.offsetX ?? 0)) / GRID_SIZE) * GRID_SIZE;
        const y = Math.round((pos.y - (dragState.offsetY ?? 0)) / GRID_SIZE) * GRID_SIZE;
        onNodeMove(dragState.nodeId, x, y);
        return;
      }

      if (dragState.type === 'wire') {
        const pos = screenToSvg(e.clientX, e.clientY);
        setDragState({ ...dragState, wireEndX: pos.x, wireEndY: pos.y });
      }
    },
    [dragState, viewBox, screenToSvg, onNodeMove],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragState?.type === 'wire') {
        // Check if we dropped on a port
        const target = e.target as Element;
        const portEl = target.closest('[data-port-id]');
        if (portEl) {
          const targetNodeId = portEl.getAttribute('data-node-id')!;
          const targetPortId = portEl.getAttribute('data-port-id')!;
          const targetIsOutput = portEl.getAttribute('data-is-output') === 'true';

          // Ensure we're connecting output → input (or input → output)
          if (dragState.sourceIsOutput !== targetIsOutput && targetNodeId !== dragState.sourceNodeId) {
            const edge: GraphEdge = dragState.sourceIsOutput
              ? {
                  sourceNodeId: dragState.sourceNodeId!,
                  sourcePortId: dragState.sourcePortId!,
                  targetNodeId,
                  targetPortId,
                }
              : {
                  sourceNodeId: targetNodeId,
                  sourcePortId: targetPortId,
                  targetNodeId: dragState.sourceNodeId!,
                  targetPortId: dragState.sourcePortId!,
                };
            onEdgeAdd(edge);
          }
        }
      }
      setDragState(null);
    },
    [dragState, onEdgeAdd],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();

      // Zoom centered on mouse position
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      const newW = viewBox.w * factor;
      const newH = viewBox.h * factor;
      setViewBox({
        x: viewBox.x + (viewBox.w - newW) * mx,
        y: viewBox.y + (viewBox.h - newH) * my,
        w: newW,
        h: newH,
      });
    },
    [viewBox],
  );

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      setSelectedNodeId(nodeId);
      setShowPalette(null);
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const pos = screenToSvg(e.clientX, e.clientY);
      setDragState({
        type: 'node',
        nodeId,
        offsetX: pos.x - node.position.x,
        offsetY: pos.y - node.position.y,
      });
    },
    [graph.nodes, screenToSvg],
  );

  const handlePortMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => {
      e.stopPropagation();
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const portPos = getPortPos(node, portId, isOutput);
      setDragState({
        type: 'wire',
        sourceNodeId: nodeId,
        sourcePortId: portId,
        sourceIsOutput: isOutput,
        wireEndX: portPos.x,
        wireEndY: portPos.y,
      });
    },
    [graph.nodes, getPortPos],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList?.contains('canvas-bg')) {
        const pos = screenToSvg(e.clientX, e.clientY);
        setShowPalette({ x: pos.x, y: pos.y });
      }
    },
    [screenToSvg],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          onNodeRemove(selectedNodeId);
          setSelectedNodeId(null);
        }
      }
      if (e.key === 'Escape') {
        setShowPalette(null);
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId, onNodeRemove],
  );

  // ── Render ──

  // Compute edges with positions
  const edgePaths = useMemo(() => {
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.sourceNodeId);
      const targetNode = nodeMap.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) return null;
      const start = getPortPos(sourceNode, edge.sourcePortId, true);
      const end = getPortPos(targetNode, edge.targetPortId, false);
      return { edge, start, end };
    }).filter(Boolean) as Array<{ edge: GraphEdge; start: { x: number; y: number }; end: { x: number; y: number } }>;
  }, [graph.nodes, graph.edges, getPortPos]);

  // Grouped node definitions for palette
  const paletteGroups = useMemo(() => {
    const groups = new Map<string, NodeDefinition[]>();
    for (const [, def] of nodeDefinitions) {
      if (!groups.has(def.category)) groups.set(def.category, []);
      groups.get(def.category)!.push(def);
    }
    return groups;
  }, [nodeDefinitions]);

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className={cn('w-full h-full select-none', className)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ outline: 'none' }}
    >
      {/* Grid background */}
      <defs>
        <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
          <circle cx={GRID_SIZE / 2} cy={GRID_SIZE / 2} r="0.5" fill="currentColor" opacity="0.15" />
        </pattern>
      </defs>
      <rect
        className="canvas-bg"
        x={viewBox.x - 1000}
        y={viewBox.y - 1000}
        width={viewBox.w + 2000}
        height={viewBox.h + 2000}
        fill="url(#grid)"
      />

      {/* Edges */}
      <g>
        {edgePaths.map(({ edge, start, end }) => {
          const dx = Math.abs(end.x - start.x) * 0.5;
          const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
          return (
            <g key={`${edge.sourceNodeId}:${edge.sourcePortId}-${edge.targetNodeId}:${edge.targetPortId}`}>
              {/* Wider invisible hit area */}
              <path d={path} fill="none" stroke="transparent" strokeWidth="12" className="cursor-pointer"
                onClick={() => onEdgeRemove(edge.sourceNodeId, edge.sourcePortId, edge.targetNodeId, edge.targetPortId)}
              />
              <path d={path} fill="none" stroke="var(--border)" strokeWidth="2" opacity="0.7" className="pointer-events-none" />
            </g>
          );
        })}

        {/* Dragging wire */}
        {dragState?.type === 'wire' && dragState.wireEndX != null && dragState.wireEndY != null && (() => {
          const sourceNode = graph.nodes.find((n) => n.id === dragState.sourceNodeId);
          if (!sourceNode) return null;
          const start = getPortPos(sourceNode, dragState.sourcePortId!, dragState.sourceIsOutput!);
          const end = { x: dragState.wireEndX!, y: dragState.wireEndY! };
          const dx = Math.abs(end.x - start.x) * 0.5;
          const path = dragState.sourceIsOutput
            ? `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`
            : `M ${end.x} ${end.y} C ${end.x + dx} ${end.y}, ${start.x - dx} ${start.y}, ${start.x} ${start.y}`;
          return <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 3" opacity="0.8" />;
        })()}
      </g>

      {/* Nodes */}
      <g>
        {graph.nodes.map((node) => {
          const def = nodeDefinitions.get(node.definitionId);
          if (!def) return null;
          const maxPorts = Math.max(def.inputs.length, def.outputs.length, 1);
          const nodeHeight = NODE_HEADER_HEIGHT + maxPorts * PORT_SPACING + NODE_PADDING;
          const color = CATEGORY_COLORS[def.category] ?? '#64748b';
          const isSelected = selectedNodeId === node.id;

          return (
            <g key={node.id} transform={`translate(${node.position.x}, ${node.position.y})`}>
              {/* Node body */}
              <rect
                width={NODE_WIDTH}
                height={nodeHeight}
                rx="6"
                ry="6"
                fill="var(--card, #1c1c22)"
                stroke={isSelected ? 'var(--primary)' : 'var(--border)'}
                strokeWidth={isSelected ? 2 : 1}
                className="cursor-grab"
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              />

              {/* Header */}
              <rect
                width={NODE_WIDTH}
                height={NODE_HEADER_HEIGHT}
                rx="6"
                ry="6"
                fill={color}
                opacity="0.15"
                className="pointer-events-none"
              />
              <rect
                y={NODE_HEADER_HEIGHT - 1}
                width={NODE_WIDTH}
                height="6"
                fill={color}
                opacity="0.15"
                className="pointer-events-none"
              />

              {/* Header bar accent */}
              <rect width={NODE_WIDTH} height="3" rx="6" ry="6" fill={color} opacity="0.6" className="pointer-events-none" />

              {/* Node name */}
              <text
                x="10"
                y={NODE_HEADER_HEIGHT / 2 + 1}
                dominantBaseline="middle"
                fill="var(--foreground)"
                fontSize="11"
                fontWeight="600"
                fontFamily="system-ui, sans-serif"
                className="pointer-events-none"
              >
                {def.name}
              </text>

              {/* Category badge */}
              <text
                x={NODE_WIDTH - 10}
                y={NODE_HEADER_HEIGHT / 2 + 1}
                dominantBaseline="middle"
                textAnchor="end"
                fill={color}
                fontSize="9"
                fontFamily="system-ui, sans-serif"
                opacity="0.8"
                className="pointer-events-none"
              >
                {def.category}
              </text>

              {/* Input ports */}
              {def.inputs.map((port, i) => {
                const py = NODE_HEADER_HEIGHT + PORT_SPACING / 2 + i * PORT_SPACING;
                return (
                  <g key={port.id}>
                    <circle
                      cx={0}
                      cy={py}
                      r={PORT_RADIUS}
                      fill="var(--background)"
                      stroke="var(--border)"
                      strokeWidth="1.5"
                      className="cursor-crosshair"
                      data-node-id={node.id}
                      data-port-id={port.id}
                      data-is-output="false"
                      onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, false)}
                    />
                    <text
                      x={PORT_RADIUS + 6}
                      y={py}
                      dominantBaseline="middle"
                      fill="var(--muted-foreground)"
                      fontSize="10"
                      fontFamily="system-ui, sans-serif"
                      className="pointer-events-none"
                    >
                      {port.name}
                    </text>
                  </g>
                );
              })}

              {/* Output ports */}
              {def.outputs.map((port, i) => {
                const py = NODE_HEADER_HEIGHT + PORT_SPACING / 2 + i * PORT_SPACING;
                return (
                  <g key={port.id}>
                    <circle
                      cx={NODE_WIDTH}
                      cy={py}
                      r={PORT_RADIUS}
                      fill="var(--background)"
                      stroke={color}
                      strokeWidth="1.5"
                      className="cursor-crosshair"
                      data-node-id={node.id}
                      data-port-id={port.id}
                      data-is-output="true"
                      onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, true)}
                    />
                    <text
                      x={NODE_WIDTH - PORT_RADIUS - 6}
                      y={py}
                      dominantBaseline="middle"
                      textAnchor="end"
                      fill="var(--muted-foreground)"
                      fontSize="10"
                      fontFamily="system-ui, sans-serif"
                      className="pointer-events-none"
                    >
                      {port.name}
                    </text>
                  </g>
                );
              })}

              {/* Params display */}
              {def.params.length > 0 && (
                <text
                  x="10"
                  y={NODE_HEADER_HEIGHT + maxPorts * PORT_SPACING + 4}
                  fill="var(--muted-foreground)"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  opacity="0.6"
                  className="pointer-events-none"
                >
                  {def.params.map((p) => {
                    const val = node.params[p.id];
                    return val !== undefined ? `${p.id}: ${String(val).slice(0, 20)}` : null;
                  }).filter(Boolean).join(', ').slice(0, 30)}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Node palette (shown on double-click) */}
      {showPalette && (
        <foreignObject
          x={showPalette.x}
          y={showPalette.y}
          width={220}
          height={300}
        >
          <div
            className="bg-popover border border-border rounded-lg shadow-xl overflow-auto text-xs"
            style={{ maxHeight: 280 }}
          >
            <div className="px-2 py-1.5 border-b text-muted-foreground font-medium">
              Add Node
            </div>
            {Array.from(paletteGroups.entries()).map(([category, defs]) => (
              <div key={category}>
                <div
                  className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: CATEGORY_COLORS[category] ?? '#64748b' }}
                >
                  {category}
                </div>
                {defs.map((def) => (
                  <button
                    key={def.id}
                    className="w-full text-left px-2 py-1 hover:bg-accent text-foreground"
                    onClick={() => {
                      onNodeAdd(def.id, showPalette.x, showPalette.y);
                      setShowPalette(null);
                    }}
                  >
                    {def.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

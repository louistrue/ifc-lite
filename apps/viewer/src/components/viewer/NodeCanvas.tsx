/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * NodeCanvas — SVG-based visual node graph editor.
 *
 * Renders a DAG of nodes connected by bezier curve edges.
 * Supports drag-to-move, port-to-port connections, zoom, and pan.
 * All state lives in the parent component (or store) via callbacks.
 *
 * Broken into sub-components: NodeCard, EdgePath, WireDrag, NodePalette.
 */

import { useState, useCallback, useRef, useMemo, memo } from 'react';
import type { Graph, GraphNode, GraphEdge, NodeDefinition, PortDefinition } from '@ifc-lite/node-registry';
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
const PALETTE_WIDTH = 220;
const PALETTE_HEIGHT = 300;

/** Category → color mapping */
const CATEGORY_COLORS: Record<string, string> = {
  Query: '#3b82f6',
  Viewer: '#8b5cf6',
  Data: '#06b6d4',
  Mutation: '#f59e0b',
  Export: '#10b981',
  Validation: '#ef4444',
  Drawing: '#ec4899',
  Analysis: '#6366f1',
  Script: '#64748b',
  Input: '#84cc16',
  Spatial: '#14b8a6',
  Lens: '#a855f7',
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
  sourceNodeId?: string;
  sourcePortId?: string;
  sourceIsOutput?: boolean;
  wireEndX?: number;
  wireEndY?: number;
  startViewX?: number;
  startViewY?: number;
  startMouseX?: number;
  startMouseY?: number;
}

// ============================================================================
// Port Position Calculation
// ============================================================================

function getPortPos(
  node: GraphNode,
  portId: string,
  isOutput: boolean,
  def: NodeDefinition,
): { x: number; y: number } {
  const ports = isOutput ? def.outputs : def.inputs;
  const idx = ports.findIndex((p) => p.id === portId);
  if (idx < 0) {
    console.warn(`[NodeCanvas] Port "${portId}" not found on node "${node.id}" (def: ${node.definitionId})`);
    return { x: node.position.x, y: node.position.y };
  }

  const yStart = node.position.y + NODE_HEADER_HEIGHT + PORT_SPACING / 2;
  return {
    x: isOutput ? node.position.x + NODE_WIDTH : node.position.x,
    y: yStart + idx * PORT_SPACING,
  };
}

function getPortPosFromMap(
  node: GraphNode,
  portId: string,
  isOutput: boolean,
  nodeDefinitions: Map<string, NodeDefinition>,
): { x: number; y: number } {
  const def = nodeDefinitions.get(node.definitionId);
  if (!def) {
    console.warn(`[NodeCanvas] Missing definition for node "${node.id}" (definitionId: ${node.definitionId})`);
    return { x: node.position.x, y: node.position.y };
  }
  return getPortPos(node, portId, isOutput, def);
}

// ============================================================================
// Sub-Components
// ============================================================================

/** Renders a single port (circle + label) */
const PortCircle = memo(function PortCircle({
  port,
  index,
  isOutput,
  nodeId,
  color,
  onMouseDown,
}: {
  port: PortDefinition;
  index: number;
  isOutput: boolean;
  nodeId: string;
  color: string;
  onMouseDown: (e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => void;
}) {
  const py = NODE_HEADER_HEIGHT + PORT_SPACING / 2 + index * PORT_SPACING;
  const cx = isOutput ? NODE_WIDTH : 0;

  return (
    <g>
      <circle
        cx={cx}
        cy={py}
        r={PORT_RADIUS}
        fill="var(--background)"
        stroke={isOutput ? color : 'var(--border)'}
        strokeWidth="1.5"
        className="cursor-crosshair"
        data-node-id={nodeId}
        data-port-id={port.id}
        data-is-output={String(isOutput)}
        onMouseDown={(e) => onMouseDown(e, nodeId, port.id, isOutput)}
      />
      <text
        x={isOutput ? NODE_WIDTH - PORT_RADIUS - 6 : PORT_RADIUS + 6}
        y={py}
        dominantBaseline="middle"
        textAnchor={isOutput ? 'end' : 'start'}
        fill="var(--muted-foreground)"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        className="pointer-events-none"
      >
        {port.name}
      </text>
    </g>
  );
});

/** Renders a complete node card */
const NodeCard = memo(function NodeCard({
  node,
  def,
  isSelected,
  onMouseDown,
  onPortMouseDown,
}: {
  node: GraphNode;
  def: NodeDefinition;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent, nodeId: string) => void;
  onPortMouseDown: (e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => void;
}) {
  const maxPorts = Math.max(def.inputs.length, def.outputs.length, 1);
  const nodeHeight = NODE_HEADER_HEIGHT + maxPorts * PORT_SPACING + NODE_PADDING;
  const color = CATEGORY_COLORS[def.category] ?? '#64748b';

  return (
    <g transform={`translate(${node.position.x}, ${node.position.y})`}>
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
        onMouseDown={(e) => onMouseDown(e, node.id)}
      />

      {/* Header background */}
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
      {def.inputs.map((port, i) => (
        <PortCircle
          key={port.id}
          port={port}
          index={i}
          isOutput={false}
          nodeId={node.id}
          color={color}
          onMouseDown={onPortMouseDown}
        />
      ))}

      {/* Output ports */}
      {def.outputs.map((port, i) => (
        <PortCircle
          key={port.id}
          port={port}
          index={i}
          isOutput={true}
          nodeId={node.id}
          color={color}
          onMouseDown={onPortMouseDown}
        />
      ))}

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
});

/** Renders a bezier edge between two ports */
const EdgePath = memo(function EdgePath({
  edge,
  start,
  end,
  onRemove,
}: {
  edge: GraphEdge;
  start: { x: number; y: number };
  end: { x: number; y: number };
  onRemove: (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => void;
}) {
  const dx = Math.abs(end.x - start.x) * 0.5;
  const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;

  return (
    <g>
      {/* Wider invisible hit area */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth="12"
        className="cursor-pointer"
        onClick={() => onRemove(edge.sourceNodeId, edge.sourcePortId, edge.targetNodeId, edge.targetPortId)}
      />
      <path d={path} fill="none" stroke="var(--border)" strokeWidth="2" opacity="0.7" className="pointer-events-none" />
    </g>
  );
});

/** Renders the temporary wire while dragging from a port */
function WireDrag({
  dragState,
  graph,
  nodeDefinitions,
}: {
  dragState: DragState;
  graph: Graph;
  nodeDefinitions: Map<string, NodeDefinition>;
}) {
  if (dragState.wireEndX == null || dragState.wireEndY == null) return null;

  const sourceNode = graph.nodes.find((n) => n.id === dragState.sourceNodeId);
  if (!sourceNode) return null;

  const start = getPortPosFromMap(sourceNode, dragState.sourcePortId!, dragState.sourceIsOutput!, nodeDefinitions);
  const end = { x: dragState.wireEndX, y: dragState.wireEndY };
  const dx = Math.abs(end.x - start.x) * 0.5;
  const path = dragState.sourceIsOutput
    ? `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`
    : `M ${end.x} ${end.y} C ${end.x + dx} ${end.y}, ${start.x - dx} ${start.y}, ${start.x} ${start.y}`;

  return <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 3" opacity="0.8" />;
}

/** Node palette shown on double-click */
const NodePalette = memo(function NodePalette({
  position,
  groups,
  onAdd,
  onClose,
}: {
  position: { x: number; y: number };
  groups: Map<string, NodeDefinition[]>;
  onAdd: (definitionId: string, x: number, y: number) => void;
  onClose: () => void;
}) {
  return (
    <foreignObject x={position.x} y={position.y} width={PALETTE_WIDTH} height={PALETTE_HEIGHT}>
      <div
        className="bg-popover border border-border rounded-lg shadow-xl overflow-auto text-xs"
        style={{ maxHeight: PALETTE_HEIGHT - 20 }}
      >
        <div className="px-2 py-1.5 border-b text-muted-foreground font-medium">
          Add Node
        </div>
        {Array.from(groups.entries()).map(([category, defs]) => (
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
                  onAdd(def.id, position.x, position.y);
                  onClose();
                }}
              >
                {def.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </foreignObject>
  );
});

// ============================================================================
// Main Component
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

  // ── Mouse handlers ──

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
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
        const target = e.target as Element;
        const portEl = target.closest('[data-port-id]');
        if (portEl) {
          const targetNodeId = portEl.getAttribute('data-node-id')!;
          const targetPortId = portEl.getAttribute('data-port-id')!;
          const targetIsOutput = portEl.getAttribute('data-is-output') === 'true';

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
      const portPos = getPortPosFromMap(node, portId, isOutput, nodeDefinitions);
      setDragState({
        type: 'wire',
        sourceNodeId: nodeId,
        sourcePortId: portId,
        sourceIsOutput: isOutput,
        wireEndX: portPos.x,
        wireEndY: portPos.y,
      });
    },
    [graph.nodes, nodeDefinitions],
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

  const closePalette = useCallback(() => setShowPalette(null), []);

  // ── Memoized derived data ──

  const edgePaths = useMemo(() => {
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.sourceNodeId);
      const targetNode = nodeMap.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) return null;
      const start = getPortPosFromMap(sourceNode, edge.sourcePortId, true, nodeDefinitions);
      const end = getPortPosFromMap(targetNode, edge.targetPortId, false, nodeDefinitions);
      return { edge, start, end };
    }).filter(Boolean) as Array<{ edge: GraphEdge; start: { x: number; y: number }; end: { x: number; y: number } }>;
  }, [graph.nodes, graph.edges, nodeDefinitions]);

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
        {edgePaths.map(({ edge, start, end }) => (
          <EdgePath
            key={`${edge.sourceNodeId}:${edge.sourcePortId}-${edge.targetNodeId}:${edge.targetPortId}`}
            edge={edge}
            start={start}
            end={end}
            onRemove={onEdgeRemove}
          />
        ))}

        {/* Dragging wire */}
        {dragState?.type === 'wire' && (
          <WireDrag dragState={dragState} graph={graph} nodeDefinitions={nodeDefinitions} />
        )}
      </g>

      {/* Nodes */}
      <g>
        {graph.nodes.map((node) => {
          const def = nodeDefinitions.get(node.definitionId);
          if (!def) {
            console.warn(`[NodeCanvas] Skipping node "${node.id}" — definition "${node.definitionId}" not found`);
            return null;
          }
          return (
            <NodeCard
              key={node.id}
              node={node}
              def={def}
              isSelected={selectedNodeId === node.id}
              onMouseDown={handleNodeMouseDown}
              onPortMouseDown={handlePortMouseDown}
            />
          );
        })}
      </g>

      {/* Node palette (shown on double-click) */}
      {showPalette && (
        <NodePalette
          position={showPalette}
          groups={paletteGroups}
          onAdd={onNodeAdd}
          onClose={closePalette}
        />
      )}
    </svg>
  );
}

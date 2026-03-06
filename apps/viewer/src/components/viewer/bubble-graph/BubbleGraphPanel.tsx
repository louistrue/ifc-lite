/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BubbleGraphPanel — visual relational building-graph editor ported from
 * webBubbleBIM / ModernGraphEditor and adapted for ifc-lite.
 *
 * Key ifc-lite integrations:
 *  - Storey nodes → automatic `ViewDefinition` (floor plan) in viewsSlice
 *  - State persisted in bubbleGraphSlice (Zustand)
 *  - GraphML export/import (feed into graphmlBuilderNode in NodeEditor)
 *  - Uses ifc-lite CSS variables (--bg-dark, --border, etc.)
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { newViewId } from '@/store/slices/viewsSlice';
import type { ViewDefinition } from '@/store/slices/viewsSlice';
import type { BubbleGraphNode, BubbleGraphEdge } from '@/store/slices/bubbleGraphSlice';
import { getGeometriesByFamily } from './geometryResolver';
import nodeLibraryData from './nodeLibrary.json';

// ─── Types ────────────────────────────────────────────────────────────────

interface NodeType {
  id: string;
  label: string;
  category: string;
  color: string;
  description: string;
  defaultProperties: Record<string, unknown>;
}

interface Category {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

type InteractionMode = 'select' | 'addNode' | 'addEdge';
type EdgePlacementType = 'simple' | 'wall' | 'beam';

// ─── Constants ────────────────────────────────────────────────────────────

const NODE_LIBRARY: { categories: Category[]; nodeTypes: NodeType[] } =
  nodeLibraryData as { categories: Category[]; nodeTypes: NodeType[] };

const NODE_COLORS: Record<string, string> = Object.fromEntries(
  NODE_LIBRARY.nodeTypes.map((nt) => [nt.id, nt.color]),
);

const MM_TO_PX = 0.05; // 1 mm = 0.05 canvas pixels

// ─── Helpers ──────────────────────────────────────────────────────────────

function getNodeTypeData(id: string): NodeType | undefined {
  return NODE_LIBRARY.nodeTypes.find((n) => n.id === id);
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function pointToLineDist(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const lenSq = C * C + D * D;
  const t = lenSq ? Math.max(0, Math.min(1, (A * C + B * D) / lenSq)) : 0;
  return Math.hypot(px - (x1 + t * C), py - (y1 + t * D));
}

// ─── useStoreyViewSync ────────────────────────────────────────────────────

/**
 * Keeps viewsSlice in sync with storey nodes in BubbleGraph.
 * For each storey node → upsert one `floorplan` ViewDefinition.
 * Storeys that disappear from the graph → remove the associated view.
 *
 * View IDs are tracked in a stable Map stored in a ref to survive re-renders.
 */
function useStoreyViewSync(nodes: BubbleGraphNode[]) {
  const addView = useViewerStore((s) => s.addView);
  const updateView = useViewerStore((s) => s.updateView);
  const deleteView = useViewerStore((s) => s.deleteView);
  const views = useViewerStore((s) => s.views);

  // storeyId → viewId
  const storeyViewMap = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const storeyNodes = nodes.filter((n) => n.type === 'storey');
    const existingStoreyIds = new Set(storeyNodes.map((n) => n.id));

    // Remove views whose storey is gone
    for (const [storeyId, viewId] of storeyViewMap.current) {
      if (!existingStoreyIds.has(storeyId)) {
        deleteView(viewId);
        storeyViewMap.current.delete(storeyId);
      }
    }

    // Upsert views for current storeys
    for (const storey of storeyNodes) {
      const botElev = ((storey.properties.bottomElevation as number) ?? 0) / 1000; // mm → m
      const cutElev = botElev + 1.2; // 1.2 m above floor

      if (storeyViewMap.current.has(storey.id)) {
        const viewId = storeyViewMap.current.get(storey.id)!;
        if (views.has(viewId)) {
          updateView(viewId, {
            name: `Floor Plan — ${storey.name}`,
            cutElevation: cutElev,
            baseElevation: botElev,
            sectionPosition: 50,
          });
        }
      } else {
        const viewId = newViewId();
        const viewDef: ViewDefinition = {
          id: viewId,
          name: `Floor Plan — ${storey.name}`,
          type: 'floorplan',
          sectionAxis: 'down',
          sectionPosition: 50,
          sectionEnabled: true,
          sectionFlipped: false,
          camera: { presetView: 'top', projectionMode: 'orthographic' },
          cutElevation: cutElev,
          baseElevation: botElev,
          viewDepth: 10,
          scale: 100,
          includeHiddenLines: false,
          createdAt: Date.now(),
        };
        addView(viewDef);
        storeyViewMap.current.set(storey.id, viewId);
      }
    }
  // Only re-run when storey identity/properties change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, addView, updateView, deleteView]);
}

// ─── PropertiesPanel ──────────────────────────────────────────────────────

interface PropertiesPanelProps {
  node: BubbleGraphNode | null;
  onUpdateField: (field: keyof BubbleGraphNode, v: unknown) => void;
  onUpdateProp: (key: string, v: unknown) => void;
  onAddProp: () => void;
  onDeleteProp: (key: string) => void;
  onDuplicateStorey: (id: string) => void;
}

function PropertiesPanel({
  node,
  onUpdateField,
  onUpdateProp,
  onAddProp,
  onDeleteProp,
  onDuplicateStorey,
}: PropertiesPanelProps) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 p-4">
        <span className="text-3xl opacity-30">⬡</span>
        <span>Select a node to inspect</span>
      </div>
    );
  }

  const typeDef = getNodeTypeData(node.type);

  // Smart property keys that get dedicated UI
  const smartKeys = new Set([
    'has_column', 'column_type', 'has_beam', 'beam_type',
    'wall_type', 'slab_type', 'material',
    'bottomElevation', 'topElevation', 'axesX', 'axesY', 'width', 'height',
  ]);

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      {/* Info */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Information</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
          <span className="text-muted-foreground">Type</span>
          <span
            className="font-semibold px-2 py-0.5 rounded text-white text-xs"
            style={{ background: typeDef?.color ?? '#334155' }}
          >
            {typeDef?.label ?? node.type}
          </span>
          <span className="text-muted-foreground">Name</span>
          <input
            className="bg-background border border-border rounded px-1.5 py-0.5 w-full text-xs"
            value={node.name}
            onChange={(e) => onUpdateField('name', e.target.value)}
          />
        </div>
      </div>

      {/* Position */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Position (mm)</div>
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((ax) => (
            <div key={ax}>
              <div className="text-muted-foreground mb-0.5 uppercase">{ax}</div>
              <input
                type="number"
                className="bg-background border border-border rounded px-1.5 py-0.5 w-full text-xs"
                value={Math.round(node[ax] as number)}
                onChange={(e) => onUpdateField(ax, parseFloat(e.target.value))}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Storey elevations */}
      {node.type === 'storey' && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Elevations (mm)</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-muted-foreground mb-0.5">Bottom</div>
              <input
                type="number"
                className="bg-background border border-border rounded px-1.5 py-0.5 w-full text-xs"
                value={node.properties.bottomElevation as number ?? 0}
                onChange={(e) => onUpdateProp('bottomElevation', parseFloat(e.target.value))}
              />
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">Top</div>
              <input
                type="number"
                className="bg-background border border-border rounded px-1.5 py-0.5 w-full text-xs"
                value={node.properties.topElevation as number ?? 3000}
                onChange={(e) => onUpdateProp('topElevation', parseFloat(e.target.value))}
              />
            </div>
          </div>
          <button
            className="w-full text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-2 py-1.5 transition-colors"
            onClick={() => onDuplicateStorey(node.id)}
          >
            Duplicate Storey
          </button>
        </div>
      )}

      {/* Structural family pickers */}
      {node.type === 'ax' && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Column</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            <span className="text-muted-foreground">Enabled</span>
            <select
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={String(node.properties.has_column ?? 'False')}
              onChange={(e) => onUpdateProp('has_column', e.target.value)}
            >
              <option value="True">True</option>
              <option value="False">False</option>
            </select>
            {(node.properties.has_column === 'True' || node.properties.has_column === true) && (<>
              <span className="text-muted-foreground">Type</span>
              <select
                className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
                value={(node.properties.column_type as string) ?? 'C25x25'}
                onChange={(e) => onUpdateProp('column_type', e.target.value)}
              >
                {getGeometriesByFamily('column').map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </>)}
          </div>
        </div>
      )}

      {(node.type === 'column') && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Column</div>
          <select
            className="bg-background border border-border rounded px-1.5 py-0.5 text-xs w-full"
            value={(node.properties.column_type as string) ?? 'C30x30'}
            onChange={(e) => onUpdateProp('column_type', e.target.value)}
          >
            {getGeometriesByFamily('column').map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      )}

      {node.type === 'beam' && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Beam</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            <span className="text-muted-foreground">Type</span>
            <select
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={(node.properties.beam_type as string) ?? 'B30x60'}
              onChange={(e) => onUpdateProp('beam_type', e.target.value)}
            >
              {getGeometriesByFamily('beam').map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <span className="text-muted-foreground">Height (mm)</span>
            <input
              type="number"
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={(node.properties.height as number) ?? 300}
              onChange={(e) => onUpdateProp('height', parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}

      {node.type === 'wall' && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Wall</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            <span className="text-muted-foreground">Type</span>
            <select
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={(node.properties.wall_type as string) ?? 'W20'}
              onChange={(e) => onUpdateProp('wall_type', e.target.value)}
            >
              {getGeometriesByFamily('wall').map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <span className="text-muted-foreground">Height (mm)</span>
            <input
              type="number"
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={(node.properties.height as number) ?? 2500}
              onChange={(e) => onUpdateProp('height', parseFloat(e.target.value))}
            />
            <span className="text-muted-foreground">Has Beam</span>
            <select
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={String(node.properties.has_beam ?? 'True')}
              onChange={(e) => onUpdateProp('has_beam', e.target.value)}
            >
              <option value="True">True</option>
              <option value="False">False</option>
            </select>
          </div>
        </div>
      )}

      {node.type === 'slab' && (
        <div className="border-b border-border p-3 space-y-2">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Slab</div>
          <select
            className="bg-background border border-border rounded px-1.5 py-0.5 text-xs w-full"
            value={(node.properties.slab_type as string) ?? 'SLAB15'}
            onChange={(e) => onUpdateProp('slab_type', e.target.value)}
          >
            {getGeometriesByFamily('slab').map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Other custom properties */}
      <div className="p-3 space-y-2 flex-1">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Properties</div>
          <button
            className="text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-2 py-0.5"
            onClick={onAddProp}
          >+ Add</button>
        </div>
        {Object.entries(node.properties)
          .filter(([k]) => !smartKeys.has(k))
          .map(([k, v]) => (
            <div key={k} className="flex gap-1 items-center">
              <span className="text-muted-foreground shrink-0 w-16 truncate" title={k}>{k}</span>
              <input
                className="bg-background border border-border rounded px-1.5 py-0.5 flex-1 text-xs"
                value={String(v)}
                onChange={(e) => onUpdateProp(k, e.target.value)}
              />
              <button
                className="text-muted-foreground hover:text-destructive px-1"
                onClick={() => onDeleteProp(k)}
              >×</button>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── AxesConfigDialog ─────────────────────────────────────────────────────

interface AxesConfigDialogProps {
  onClose: () => void;
  onGenerate: (cfg: {
    name: string;
    bottomElev: number;
    topElev: number;
    xValues: number[];
    yValues: number[];
  }) => void;
}

function AxesConfigDialog({ onClose, onGenerate }: AxesConfigDialogProps) {
  const [name, setName] = useState('');
  const [bottomElev, setBottomElev] = useState('0');
  const [topElev, setTopElev] = useState('3000');
  const [axesX, setAxesX] = useState('0, 6000, 12000, 18000');
  const [axesY, setAxesY] = useState('0, 5000, 10000, 15000');

  const handleGenerate = () => {
    if (!name.trim()) { alert('Enter a unique storey name'); return; }
    const xs = axesX.split(',').map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v));
    const ys = axesY.split(',').map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v));
    if (!xs.length || !ys.length) { alert('Enter valid X/Y axis values'); return; }
    const bot = parseFloat(bottomElev);
    const top = parseFloat(topElev);
    if (isNaN(bot) || isNaN(top)) { alert('Enter valid elevations'); return; }
    onGenerate({ name: name.trim(), bottomElev: bot, topElev: top, xValues: xs, yValues: ys });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-2xl w-96 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">New Storey — Axes Grid</h3>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>✕</button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-muted-foreground block mb-1">Storey Name</label>
            <input className="bg-muted border border-border rounded px-2 py-1.5 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ground Floor" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted-foreground block mb-1">Bottom Elevation (mm)</label>
              <input type="number" className="bg-muted border border-border rounded px-2 py-1.5 w-full" value={bottomElev} onChange={(e) => setBottomElev(e.target.value)} />
            </div>
            <div>
              <label className="text-muted-foreground block mb-1">Top Elevation (mm)</label>
              <input type="number" className="bg-muted border border-border rounded px-2 py-1.5 w-full" value={topElev} onChange={(e) => setTopElev(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-muted-foreground block mb-1">X Axes positions (mm, comma-separated)</label>
            <input className="bg-muted border border-border rounded px-2 py-1.5 w-full" value={axesX} onChange={(e) => setAxesX(e.target.value)} />
          </div>
          <div>
            <label className="text-muted-foreground block mb-1">Y Axes positions (mm, comma-separated)</label>
            <input className="bg-muted border border-border rounded px-2 py-1.5 w-full" value={axesY} onChange={(e) => setAxesY(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleGenerate}>Generate Grid</Button>
        </div>
      </div>
    </div>
  );
}

// ─── BubbleGraphCanvas ────────────────────────────────────────────────────

interface BubbleGraphCanvasProps {
  nodes: BubbleGraphNode[];
  edges: BubbleGraphEdge[];
  setNodes: React.Dispatch<React.SetStateAction<BubbleGraphNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<BubbleGraphEdge[]>>;
}

function BubbleGraphCanvas({ nodes, edges, setNodes, setEdges }: BubbleGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<InteractionMode>('select');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; ox: number; oy: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [selectedNodeType, setSelectedNodeType] = useState('ax');
  const [continuousMode, setContinuousMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAxesDialog, setShowAxesDialog] = useState(false);
  const [edgeType, setEdgeType] = useState<EdgePlacementType>('simple');
  const [isPropsDocked, setIsPropsDocked] = useState(true);
  const [floatPos, setFloatPos] = useState({ x: 120, y: 80 });
  const [floatSize, setFloatSize] = useState({ w: 300, h: 500 });
  const [isDraggingFloat, setIsDraggingFloat] = useState(false);
  const [floatDragOff, setFloatDragOff] = useState({ x: 0, y: 0 });

  const setBubbleGraph = useViewerStore((s) => s.setBubbleGraph);

  // Sync to store when nodes/edges change
  useEffect(() => {
    setBubbleGraph(nodes, edges);
  }, [nodes, edges, setBubbleGraph]);

  // Sync storeys → views
  useStoreyViewSync(nodes);

  // ── Draw ──────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    // AutoCAD-style: Y positive upward
    ctx.translate(0, canvas.height / zoom);
    ctx.scale(1, -1);

    // Storey frames
    nodes.filter((n) => n.type === 'storey').forEach((s) => {
      const w = (s.properties.width as number || 0) * MM_TO_PX;
      const h = (s.properties.height as number || 0) * MM_TO_PX;
      const fx = s.x * MM_TO_PX - w / 2;
      const fy = s.y * MM_TO_PX - h / 2;

      ctx.fillStyle = 'rgba(108,92,231,0.06)';
      ctx.fillRect(fx, fy, w, h);
      ctx.strokeStyle = selectedNode === s.id ? '#e94560' : '#6c5ce7';
      ctx.lineWidth = selectedNode === s.id ? 3 : 2;
      ctx.setLineDash([10, 5]);
      ctx.strokeRect(fx, fy, w, h);
      ctx.setLineDash([]);

      ctx.save();
      ctx.translate(fx + 8, fy + h - 8);
      ctx.scale(1, -1);
      ctx.fillStyle = '#6c5ce7';
      ctx.font = 'bold 13px system-ui,sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(`▦ ${s.name}`, 0, 0);
      ctx.fillStyle = '#888';
      ctx.font = '10px system-ui,sans-serif';
      ctx.fillText(`↓${s.properties.bottomElevation}↑${s.properties.topElevation} mm`, 0, 16);
      ctx.restore();
    });

    // Edges
    edges.forEach((e) => {
      const sn = nodes.find((n) => n.id === e.from);
      const tn = nodes.find((n) => n.id === e.to);
      if (!sn || !tn) return;
      ctx.beginPath();
      ctx.moveTo(sn.x * MM_TO_PX, sn.y * MM_TO_PX);
      ctx.lineTo(tn.x * MM_TO_PX, tn.y * MM_TO_PX);
      ctx.strokeStyle = selectedEdge === e.id ? '#e94560' : '#3a3a5a';
      ctx.lineWidth = selectedEdge === e.id ? 3 : 2;
      ctx.stroke();
    });

    // Edge preview
    if (mode === 'addEdge' && edgeStart) {
      const startN = nodes.find((n) => n.id === edgeStart);
      if (startN && canvas) {
        ctx.beginPath();
        ctx.moveTo(startN.x * MM_TO_PX, startN.y * MM_TO_PX);
        const mx = (lastMousePos.x - pan.x) / zoom;
        const my = (canvas.height - (lastMousePos.y - pan.y)) / zoom;
        ctx.lineTo(mx, my);
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Non-storey nodes
    nodes.filter((n) => n.type !== 'storey').forEach((n) => {
      const nx = n.x * MM_TO_PX;
      const ny = n.y * MM_TO_PX;

      ctx.beginPath();
      ctx.arc(nx, ny, 20, 0, Math.PI * 2);
      ctx.fillStyle = NODE_COLORS[n.type] ?? '#1e3a5f';
      ctx.fill();

      if (mode === 'addEdge' && n.type !== 'storey' && edgeStart !== n.id) {
        ctx.strokeStyle = '#4ecdc4'; ctx.lineWidth = 2; ctx.stroke();
      }
      if (edgeStart === n.id) { ctx.strokeStyle = '#e94560'; ctx.lineWidth = 4; ctx.stroke(); }
      if (selectedNode === n.id) { ctx.strokeStyle = '#e94560'; ctx.lineWidth = 3; ctx.stroke(); }

      if (n.locked) {
        ctx.save();
        ctx.translate(nx + 12, ny + 12);
        ctx.scale(1, -1);
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', 0, 0);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(nx, ny - 28);
      ctx.scale(1, -1);
      ctx.fillStyle = '#dde';
      ctx.font = '11px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.name, 0, 0);
      ctx.restore();
    });

    ctx.restore();
  }, [nodes, edges, selectedNode, selectedEdge, pan, zoom, mode, edgeStart, lastMousePos]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const p = canvas.parentElement;
      if (p) { canvas.width = p.clientWidth; canvas.height = p.clientHeight; draw(); }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // Floating props drag
  useEffect(() => {
    const mm = (e: MouseEvent) => {
      if (isDraggingFloat) {
        setFloatPos({ x: e.clientX - floatDragOff.x, y: e.clientY - floatDragOff.y });
      }
    };
    const mu = () => { if (isDraggingFloat) setIsDraggingFloat(false); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
    return () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
  }, [isDraggingFloat, floatDragOff]);

  // ── Hit testing ───────────────────────────────────────────────────────

  const getNodeAt = useCallback((sx: number, sy: number): BubbleGraphNode | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = (sx - pan.x) / zoom;
    const cy = (canvas.height - (sy - pan.y)) / zoom;

    const regular = nodes.find((n) => {
      if (n.type === 'storey') return false;
      return Math.hypot(n.x * MM_TO_PX - cx, n.y * MM_TO_PX - cy) < 20;
    });
    if (regular) return regular;

    return nodes.find((n) => {
      if (n.type !== 'storey') return false;
      const w = (n.properties.width as number || 0) * MM_TO_PX;
      const h = (n.properties.height as number || 0) * MM_TO_PX;
      const fx = n.x * MM_TO_PX - w / 2;
      const fy = n.y * MM_TO_PX - h / 2;
      return cx >= fx && cx <= fx + w && cy >= fy && cy <= fy + h;
    });
  }, [nodes, pan, zoom]);

  const getEdgeAt = useCallback((sx: number, sy: number): BubbleGraphEdge | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = (sx - pan.x) / zoom;
    const cy = (canvas.height - (sy - pan.y)) / zoom;
    return edges.find((e) => {
      const sn = nodes.find((n) => n.id === e.from);
      const tn = nodes.find((n) => n.id === e.to);
      if (!sn || !tn) return false;
      return pointToLineDist(cx, cy, sn.x * MM_TO_PX, sn.y * MM_TO_PX, tn.x * MM_TO_PX, tn.y * MM_TO_PX) < 10;
    });
  }, [nodes, edges, pan, zoom]);

  // ── Mouse handlers ────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (mode === 'addNode') {
      const nx = (sx - pan.x) / zoom / MM_TO_PX;
      const ny = (canvas.height - (sy - pan.y)) / zoom / MM_TO_PX;
      const nt = getNodeTypeData(selectedNodeType);
      const newNode: BubbleGraphNode = {
        id: `node_${uid()}`,
        type: selectedNodeType,
        name: `${nt?.label ?? selectedNodeType}${nodes.filter((n) => n.type === selectedNodeType).length + 1}`,
        x: nx, y: ny, z: 0,
        properties: { ...(nt?.defaultProperties ?? {}) },
      };
      setNodes((prev) => [...prev, newNode]);
      if (!continuousMode) setMode('select');
      return;
    }

    if (mode === 'addEdge') {
      const hit = getNodeAt(sx, sy);
      if (hit && hit.type !== 'storey') {
        if (!edgeStart) {
          setEdgeStart(hit.id);
        } else if (edgeStart !== hit.id) {
          const startN = nodes.find((n) => n.id === edgeStart)!;
          const endN = hit;
          if (edgeType === 'simple') {
            setEdges((prev) => [...prev, { id: `edge_${uid()}`, from: edgeStart, to: endN.id }]);
          } else {
            const intType = edgeType === 'wall' ? 'wall' : 'beam';
            const intDef = getNodeTypeData(intType);
            const intId = `${intType}_${uid()}`;
            const intNode: BubbleGraphNode = {
              id: intId,
              type: intType,
              name: `${intDef?.label ?? intType}${nodes.filter((n) => n.type === intType).length + 1}`,
              x: (startN.x + endN.x) / 2,
              y: (startN.y + endN.y) / 2,
              z: 0,
              properties: { ...(intDef?.defaultProperties ?? {}) },
              parentId: startN.parentId ?? endN.parentId,
            };
            setNodes((prev) => [...prev, intNode]);
            setEdges((prev) => [
              ...prev,
              { id: `edge_${uid()}_1`, from: edgeStart, to: intId },
              { id: `edge_${uid()}_2`, from: intId, to: endN.id },
            ]);
          }
          if (!continuousMode) { setEdgeStart(null); setMode('select'); }
          else setEdgeStart(null);
        }
      }
      return;
    }

    const hitEdge = getEdgeAt(sx, sy);
    if (hitEdge) { setSelectedEdge(hitEdge.id); setSelectedNode(null); return; }
    const hitNode = getNodeAt(sx, sy);
    if (hitNode) {
      setSelectedNode(hitNode.id); setSelectedEdge(null);
      if (!hitNode.locked || hitNode.type === 'storey') {
        setDragging({
          nodeId: hitNode.id,
          ox: sx - hitNode.x * MM_TO_PX * zoom - pan.x,
          oy: (canvas.height - hitNode.y * MM_TO_PX * zoom) - (sy - pan.y),
        });
      }
    } else {
      setSelectedNode(null); setSelectedEdge(null);
    }
  }, [mode, pan, zoom, nodes, edges, edgeStart, edgeType, selectedNodeType, continuousMode, getNodeAt, getEdgeAt, setNodes, setEdges]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setLastMousePos({ x: sx, y: sy });

    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if (dragging) {
      const draggedNode = nodes.find((n) => n.id === dragging.nodeId);
      if (!draggedNode) return;
      const nx = (sx - pan.x - dragging.ox) / zoom / MM_TO_PX;
      const ny = (canvas.height - (sy - pan.y - dragging.oy)) / zoom / MM_TO_PX;

      if (draggedNode.type === 'storey') {
        const dx = nx - draggedNode.x, dy = ny - draggedNode.y;
        setNodes((prev) => prev.map((n) => {
          if (n.id === dragging.nodeId) return { ...n, x: nx, y: ny };
          if (n.parentId === dragging.nodeId) return { ...n, x: n.x + dx, y: n.y + dy };
          return n;
        }));
      } else if (!draggedNode.locked) {
        setNodes((prev) => prev.map((n) => n.id === dragging.nodeId ? { ...n, x: nx, y: ny } : n));
      }
    }
  }, [pan, panStart, zoom, isPanning, dragging, nodes, setNodes]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nz = Math.max(0.1, Math.min(5, zoom * delta));
    setPan({ x: mx - wx * nz, y: my - wy * nz });
    setZoom(nz);
  }, [pan, zoom]);

  // ── Actions ───────────────────────────────────────────────────────────

  const selectedNodeData = useMemo(
    () => nodes.find((n) => n.id === selectedNode) ?? null,
    [nodes, selectedNode],
  );

  const deleteSelected = useCallback(() => {
    if (selectedNode) {
      const n = nodes.find((x) => x.id === selectedNode);
      if (!n) return;
      if (n.type === 'storey') {
        const childIds = nodes.filter((c) => c.parentId === n.id).map((c) => c.id);
        const toDelete = new Set([n.id, ...childIds]);
        setNodes((prev) => prev.filter((x) => !toDelete.has(x.id)));
        setEdges((prev) => prev.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to)));
      } else {
        setNodes((prev) => prev.filter((x) => x.id !== n.id));
        setEdges((prev) => prev.filter((e) => e.from !== n.id && e.to !== n.id));
      }
      setSelectedNode(null);
    } else if (selectedEdge) {
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [selectedNode, selectedEdge, nodes, setNodes, setEdges]);

  const copyNode = useCallback(() => {
    if (!selectedNode) return;
    const n = nodes.find((x) => x.id === selectedNode);
    if (!n || n.type === 'storey' || n.locked) return;
    const copy: BubbleGraphNode = { ...n, id: `node_${uid()}`, name: `${n.name}_copy`, x: n.x + 500, y: n.y + 500, properties: { ...n.properties } };
    setNodes((prev) => [...prev, copy]);
    setSelectedNode(copy.id);
  }, [selectedNode, nodes, setNodes]);

  const insertNodeOnEdge = useCallback(() => {
    if (!selectedEdge) return;
    const edge = edges.find((e) => e.id === selectedEdge);
    if (!edge) return;
    const sn = nodes.find((n) => n.id === edge.from), tn = nodes.find((n) => n.id === edge.to);
    if (!sn || !tn) return;
    const nt = getNodeTypeData(selectedNodeType);
    const nid = `node_${uid()}`;
    const nn: BubbleGraphNode = {
      id: nid, type: selectedNodeType,
      name: `${nt?.label ?? selectedNodeType}${nodes.filter((n) => n.type === selectedNodeType).length + 1}`,
      x: (sn.x + tn.x) / 2, y: (sn.y + tn.y) / 2, z: 0,
      properties: { ...(nt?.defaultProperties ?? {}) },
    };
    setNodes((prev) => [...prev, nn]);
    setEdges((prev) => [
      ...prev.filter((e) => e.id !== selectedEdge),
      { id: `edge_${uid()}_1`, from: edge.from, to: nid },
      { id: `edge_${uid()}_2`, from: nid, to: edge.to },
    ]);
    setSelectedEdge(null); setSelectedNode(nid);
  }, [selectedEdge, edges, nodes, selectedNodeType, setNodes, setEdges]);

  const duplicateStorey = useCallback((storeyId: string) => {
    const storey = nodes.find((n) => n.id === storeyId);
    if (!storey || storey.type !== 'storey') return;
    const newName = prompt('Name for duplicated storey:', `${storey.name} Copy`);
    if (!newName?.trim()) return;
    if (nodes.some((n) => n.type === 'storey' && n.name === newName.trim())) {
      alert('A storey with this name already exists.');
      return;
    }
    const newStoreyId = `storey_${uid()}`;
    const children = nodes.filter((n) => n.parentId === storeyId);
    const idMap = new Map([[storeyId, newStoreyId]]);
    const newNodes: BubbleGraphNode[] = [
      { ...storey, id: newStoreyId, name: newName.trim(), x: storey.x + 5000, y: storey.y + 5000 },
    ];
    children.forEach((c) => {
      const nid = `${c.type}_${newStoreyId}_${uid()}`;
      idMap.set(c.id, nid);
      newNodes.push({ ...c, id: nid, parentId: newStoreyId, x: c.x + 5000, y: c.y + 5000 });
    });
    const childSet = new Set(children.map((c) => c.id));
    const newEdges = edges
      .filter((e) => childSet.has(e.from) && childSet.has(e.to))
      .map((e) => ({ ...e, id: `edge_${uid()}`, from: idMap.get(e.from) ?? e.from, to: idMap.get(e.to) ?? e.to }));
    setNodes((prev) => [...prev, ...newNodes]);
    setEdges((prev) => [...prev, ...newEdges]);
  }, [nodes, edges, setNodes, setEdges]);

  const generateAxesGrid = useCallback((cfg: {
    name: string; bottomElev: number; topElev: number; xValues: number[]; yValues: number[];
  }) => {
    const { name, bottomElev, topElev, xValues: rawX, yValues: rawY } = cfg;
    if (nodes.some((n) => n.type === 'storey' && n.name === name)) {
      alert('A storey with this name already exists.');
      return;
    }
    const xs = [...new Set(rawX)].sort((a, b) => a - b);
    const ys = [...new Set(rawY)].sort((a, b) => a - b);
    const maxX = xs[xs.length - 1] ?? 0;
    const maxY = ys[ys.length - 1] ?? 0;
    const cx = 8000, cy = 6000;
    const storeyId = `storey_${uid()}`;
    const axDef = getNodeTypeData('ax');
    const newNodes: BubbleGraphNode[] = [{
      id: storeyId, type: 'storey', name, x: cx, y: cy, z: 0,
      properties: { bottomElevation: bottomElev, topElevation: topElev, axesX: xs, axesY: ys, width: maxX, height: maxY },
      locked: false,
    }];
    let idx = 0;
    for (let i = 0; i < ys.length; i++) {
      for (let j = 0; j < xs.length; j++) {
        newNodes.push({
          id: `ax_${storeyId}_${idx++}`,
          type: 'ax',
          name: `${j + 1}-${String.fromCharCode(65 + i)}`,
          x: cx + (xs[j] - maxX / 2),
          y: cy + (ys[i] - maxY / 2),
          z: 0,
          properties: { ...(axDef?.defaultProperties ?? {}), gridX: j, gridY: i },
          locked: true,
          parentId: storeyId,
        });
      }
    }
    setNodes((prev) => [...prev, ...newNodes]);
    setShowAxesDialog(false);
  }, [nodes, setNodes]);

  // ── GraphML ───────────────────────────────────────────────────────────

  const exportGraphML = useCallback(() => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n  <graph id="G" edgedefault="undirected">\n';
    nodes.forEach((n) => {
      xml += `    <node id="${n.id}">\n`;
      xml += `      <data key="type">${n.type}</data>\n`;
      xml += `      <data key="name">${n.name}</data>\n`;
      xml += `      <data key="x">${n.x}</data>\n`;
      xml += `      <data key="y">${n.y}</data>\n`;
      xml += `      <data key="z">${n.z}</data>\n`;
      if (n.parentId) xml += `      <data key="parentId">${n.parentId}</data>\n`;
      Object.entries(n.properties).forEach(([k, v]) => {
        xml += `      <data key="${k}">${Array.isArray(v) ? v.join(',') : v}</data>\n`;
      });
      xml += '    </node>\n';
    });
    edges.forEach((e) => {
      xml += `    <edge id="${e.id}" source="${e.from}" target="${e.to}"/>\n`;
    });
    xml += '  </graph>\n</graphml>';
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bubble-graph.graphml'; a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const importGraphML = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const doc = new DOMParser().parseFromString(ev.target?.result as string, 'text/xml');
        const newNodes: BubbleGraphNode[] = [];
        for (const el of Array.from(doc.getElementsByTagName('node'))) {
          const id = el.getAttribute('id') ?? `node_${uid()}`;
          const n: BubbleGraphNode = { id, type: '', name: '', x: 0, y: 0, z: 0, properties: {} };
          for (const d of Array.from(el.getElementsByTagName('data'))) {
            const k = d.getAttribute('key'), v = d.textContent ?? '';
            if (k === 'type') n.type = v;
            else if (k === 'name') n.name = v;
            else if (k === 'x') n.x = parseFloat(v);
            else if (k === 'y') n.y = parseFloat(v);
            else if (k === 'z') n.z = parseFloat(v);
            else if (k === 'parentId') n.parentId = v;
            else if (k) n.properties[k] = v;
          }
          newNodes.push(n);
        }
        const newEdges: BubbleGraphEdge[] = Array.from(doc.getElementsByTagName('edge')).map((el) => ({
          id: el.getAttribute('id') ?? `edge_${uid()}`,
          from: el.getAttribute('source') ?? '',
          to: el.getAttribute('target') ?? '',
        }));
        setNodes(newNodes); setEdges(newEdges);
        setSelectedNode(null); setSelectedEdge(null);
      } catch (err) {
        alert('GraphML import error: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [setNodes, setEdges]);

  // ── Node prop update helpers ──────────────────────────────────────────

  const handleUpdateField = useCallback((field: keyof BubbleGraphNode, v: unknown) => {
    if (!selectedNode) return;
    setNodes((prev) => prev.map((n) => n.id === selectedNode ? { ...n, [field]: v } : n));
  }, [selectedNode, setNodes]);

  const handleUpdateProp = useCallback((key: string, v: unknown) => {
    if (!selectedNode) return;
    setNodes((prev) => prev.map((n) =>
      n.id === selectedNode ? { ...n, properties: { ...n.properties, [key]: v } } : n,
    ));
  }, [selectedNode, setNodes]);

  const handleAddProp = useCallback(() => {
    const key = prompt('Property name:');
    if (key && selectedNode) handleUpdateProp(key, '');
  }, [selectedNode, handleUpdateProp]);

  const handleDeleteProp = useCallback((key: string) => {
    if (!selectedNode) return;
    setNodes((prev) => prev.map((n) => {
      if (n.id !== selectedNode) return n;
      const { [key]: _, ...rest } = n.properties;
      return { ...n, properties: rest };
    }));
  }, [selectedNode, setNodes]);

  // ── Render ────────────────────────────────────────────────────────────

  const panelClass = cn(
    'flex flex-col bg-background text-foreground border-border',
    isFullscreen ? 'fixed inset-0 z-[150]' : 'relative w-full h-full',
  );

  const PropsContent = (
    <PropertiesPanel
      node={selectedNodeData}
      onUpdateField={handleUpdateField}
      onUpdateProp={handleUpdateProp}
      onAddProp={handleAddProp}
      onDeleteProp={handleDeleteProp}
      onDuplicateStorey={duplicateStorey}
    />
  );

  return (
    <div className={panelClass}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30 flex-shrink-0 flex-wrap">
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={exportGraphML}>⬆ Export GraphML</button>
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={() => fileInputRef.current?.click()}>⬇ Import GraphML</button>
        <div className="w-px h-4 bg-border mx-1" />
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={() => setShowAxesDialog(true)}>⊞ New Storey</button>
        <div className="w-px h-4 bg-border mx-1" />
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={() => setZoom((z) => Math.min(5, z * 1.2))}>＋</button>
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={() => setZoom((z) => Math.max(0.1, z * 0.8))}>－</button>
        <button className="text-xs px-2 py-1 rounded hover:bg-accent" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>⌂</button>
        <div className="flex-1" />
        <button
          className="text-xs px-2 py-1 rounded hover:bg-accent"
          onClick={() => setIsFullscreen((f) => !f)}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <input ref={fileInputRef} type="file" accept=".graphml,.xml" className="hidden" onChange={importGraphML} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="w-44 flex flex-col gap-1 p-2 border-r border-border bg-muted/20 overflow-y-auto flex-shrink-0 text-xs">
          <div className="font-semibold text-muted-foreground uppercase tracking-wider mb-1">Mode</div>
          <button
            className={cn('px-2 py-1.5 rounded text-left transition-colors', mode === 'addNode' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            onClick={() => { setMode(mode === 'addNode' ? 'select' : 'addNode'); setEdgeStart(null); }}
          >
            {mode === 'addNode' ? '✓ ' : ''}Add Node
          </button>
          <button
            className={cn('px-2 py-1.5 rounded text-left transition-colors', mode === 'addEdge' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            onClick={() => { setMode(mode === 'addEdge' ? 'select' : 'addEdge'); setEdgeStart(null); }}
          >
            {mode === 'addEdge' ? '✓ ' : ''}Add Edge
          </button>

          {mode === 'addEdge' && (
            <div className="pl-1 space-y-1 mt-1">
              <div className="text-muted-foreground text-[10px] uppercase">Edge Type</div>
              {(['simple', 'wall', 'beam'] as EdgePlacementType[]).map((et) => (
                <button
                  key={et}
                  className={cn('w-full px-2 py-1 rounded text-left text-[11px]', edgeType === et ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-accent')}
                  onClick={() => setEdgeType(et)}
                >
                  {et.charAt(0).toUpperCase() + et.slice(1)}
                </button>
              ))}
            </div>
          )}

          {mode === 'addNode' && (
            <div className="space-y-1 mt-1">
              <div className="text-muted-foreground text-[10px] uppercase">Node Type</div>
              <select
                className="w-full bg-background border border-border rounded px-1 py-1 text-xs"
                value={selectedNodeType}
                onChange={(e) => setSelectedNodeType(e.target.value)}
              >
                {NODE_LIBRARY.nodeTypes.map((nt) => (
                  <option key={nt.id} value={nt.id}>{nt.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input type="checkbox" checked={continuousMode} onChange={(e) => setContinuousMode(e.target.checked)} className="w-3 h-3" />
                Continuous
              </label>
            </div>
          )}

          <div className="border-t border-border my-2" />

          {/* Category legend */}
          <div className="text-muted-foreground text-[10px] uppercase mb-1">Categories</div>
          <div className="space-y-1">
            {NODE_LIBRARY.categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-1.5 text-[11px]">
                <span>{cat.icon}</span>
                <span style={{ color: cat.color }}>{cat.label}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-border my-2" />

          {/* Context actions */}
          {selectedNode && (
            <>
              <button className="px-2 py-1.5 rounded hover:bg-accent text-left" onClick={copyNode}>Copy Node</button>
              <button className="px-2 py-1.5 rounded hover:bg-destructive/20 text-destructive text-left" onClick={deleteSelected}>Delete Node</button>
            </>
          )}
          {selectedEdge && (
            <>
              <button className="px-2 py-1.5 rounded hover:bg-accent text-left" onClick={insertNodeOnEdge}>Insert Node</button>
              <button className="px-2 py-1.5 rounded hover:bg-destructive/20 text-destructive text-left" onClick={deleteSelected}>Delete Edge</button>
            </>
          )}

          <div className="border-t border-border my-2" />
          <div className="text-muted-foreground text-[10px]">Shift+Drag / Middle-drag to pan</div>
        </aside>

        {/* ── Canvas ── */}
        <section className="flex-1 relative overflow-hidden bg-[#0d0d1a]">
          <canvas
            ref={canvasRef}
            className="block w-full h-full"
            style={{ cursor: mode !== 'select' ? 'crosshair' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Zoom badge */}
          <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/60 px-1.5 py-0.5 rounded pointer-events-none">
            {Math.round(zoom * 100)}%
          </div>
        </section>

        {/* ── Docked Properties ── */}
        {isPropsDocked && (
          <aside className="w-64 border-l border-border flex flex-col flex-shrink-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
              <span className="text-xs font-semibold">Properties</span>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setIsPropsDocked(false)}
                title="Detach"
              >⊞</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {PropsContent}
            </div>
          </aside>
        )}
      </div>

      {/* ── Floating Properties ── */}
      {!isPropsDocked && (
        <div
          className="fixed z-[160] bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
          style={{ left: floatPos.x, top: floatPos.y, width: floatSize.w, height: floatSize.h }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border cursor-move select-none"
            onMouseDown={(e) => {
              setIsDraggingFloat(true);
              setFloatDragOff({ x: e.clientX - floatPos.x, y: e.clientY - floatPos.y });
            }}
          >
            <span className="text-xs font-semibold">Properties</span>
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setIsPropsDocked(true)}>Dock</button>
          </div>
          <div className="flex-1 overflow-y-auto">{PropsContent}</div>
        </div>
      )}

      {/* ── Axes Config Dialog ── */}
      {showAxesDialog && (
        <AxesConfigDialog
          onClose={() => setShowAxesDialog(false)}
          onGenerate={generateAxesGrid}
        />
      )}
    </div>
  );
}

// ─── BubbleGraphPanel (outer wrapper) ────────────────────────────────────

interface BubbleGraphPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function BubbleGraphPanel({ visible, onClose }: BubbleGraphPanelProps) {
  const storedNodes = useViewerStore((s) => s.bubbleGraphNodes);
  const storedEdges = useViewerStore((s) => s.bubbleGraphEdges);

  const [nodes, setNodes] = useState<BubbleGraphNode[]>(storedNodes);
  const [edges, setEdges] = useState<BubbleGraphEdge[]>(storedEdges);

  // Sync from store only on first mount (don't override local edits)
  const didInit = useRef(false);
  useEffect(() => {
    if (!didInit.current && storedNodes.length > 0) {
      setNodes(storedNodes);
      setEdges(storedEdges);
    }
    didInit.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">BubbleGraph</span>
            <span className="text-xs text-muted-foreground">— structural relational building graph</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {/* Canvas */}
        <div className="flex-1 min-h-0">
          <BubbleGraphCanvas
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
          />
        </div>
      </div>
    </div>
  );
}

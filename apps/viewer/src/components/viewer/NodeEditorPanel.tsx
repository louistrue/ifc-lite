/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
} from '@xyflow/react';
import {
  X,
  Zap,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { NodeRegistry } from './nodes/registry';
import { INITIAL_NODES, INITIAL_EDGES, compileGraphToIfc } from './nodes/types';
// Side-effect imports — registers all node types into NodeRegistry:
import './nodes/builtins';
import './nodes/graphmlBuilderNode';
import './nodes/fileInputNode';
import './nodes/transformNode';

// ─── Stable module-level registry snapshots ────────────────────────────────
// Called once after all side-effect imports have run, so the registry is fully
// populated before any component renders.
const NODE_TYPES = NodeRegistry.getNodeTypes();
const PALETTE_ITEMS = NodeRegistry.getPaletteItems();
const DEFAULT_DATA  = NodeRegistry.getDefaultData();

// ─── Compile status ────────────────────────────────────────────────────────

type CompileStatus = 'idle' | 'compiling' | 'ok' | 'error';


interface NodeEditorPanelInnerProps {
  visible: boolean;
  onClose: () => void;
}

function NodeEditorPanelInner({ visible, onClose }: NodeEditorPanelInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [autoCompile, setAutoCompile] = useState(false);
  const [status, setStatus] = useState<CompileStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flow = useReactFlow();

  // ── Floating window position & size ─────────────────────────────────────
  const [pos, setPos]   = useState({ x: 80, y: 80 });
  const [size, setSize] = useState({ w: 960, h: 580 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const dragRef   = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isFullscreen) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.px + me.clientX - dragRef.current.mx,
               y: dragRef.current.py + me.clientY - dragRef.current.my });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const onResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    const onMove = (me: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(420, resizeRef.current.w + me.clientX - resizeRef.current.mx),
        h: Math.max(300, resizeRef.current.h + me.clientY - resizeRef.current.my),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  const { loadFile } = useIfc();
  const setNodeEditorPanelVisible = useViewerStore((s) => s.setNodeEditorPanelVisible);
  const toggleTypeVisibility = useViewerStore((s) => s.toggleTypeVisibility);
  const typeVisibility = useViewerStore((s) => s.typeVisibility);

  // ── Ctrl+D: duplicate selected nodes ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!visible) return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'd') return;
      e.preventDefault();
      const selected = flow.getNodes().filter(n => n.selected);
      if (!selected.length) return;
      const stamp = Date.now();
      setNodes(nds => [
        ...nds.map(n => ({ ...n, selected: false })),
        ...selected.map((n, i) => ({
          ...n,
          id: `${n.type ?? 'node'}-dup-${stamp}-${i}`,
          position: { x: n.position.x + 30, y: n.position.y + 30 },
          selected: true,
          data: { ...n.data },
        })),
      ]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, flow, setNodes]);

  // ── Connect edges ───────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge({ ...connection, animated: true, style: { stroke: '#a855f7' } }, eds)
      ),
    [setEdges]
  );

  // ── Compile to IFC ──────────────────────────────────────────────────────
  const compile = useCallback(async () => {
    setStatus('compiling');
    setStatusMsg('');
    try {
      const content = await compileGraphToIfc(nodes, edges);
      if (!content) {
        setStatus('error');
        setStatusMsg('Add a Project node first');
        return;
      }
      const blob = new Blob([content], { type: 'application/x-step' });
      const file = new File([blob], 'node-graph.ifc', { type: 'application/x-step', lastModified: Date.now() });
      await loadFile(file);
      // loadFile resets store; restore node editor visibility
      setNodeEditorPanelVisible(true);
      // Enable visibility for special types present in the graph
      const hasSpaces = nodes.some(n => n.type === 'roomNode');
      const hasOpenings = nodes.some(n => n.type === 'openingNode');
      if (hasSpaces && !typeVisibility.spaces) toggleTypeVisibility('spaces');
      if (hasOpenings && !typeVisibility.openings) toggleTypeVisibility('openings');
      setStatus('ok');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }, [nodes, edges, loadFile, setNodeEditorPanelVisible, toggleTypeVisibility, typeVisibility]);

  // ── Auto-compile with debounce ──────────────────────────────────────────
  useEffect(() => {
    if (!autoCompile) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void compile(); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [nodes, edges, autoCompile, compile]);

  // ── Add node from palette ───────────────────────────────────────────────
  const addNode = useCallback((type: string) => {
    const id = `${type}-${Date.now()}`;
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 300;
    setNodes((nds) => [
      ...nds,
      { id, type, position: { x, y }, data: { ...DEFAULT_DATA[type] } },
    ]);
  }, [setNodes]);

  // ── Palette groups ────────────────────────────────────────────────────────
  const CATEGORY_ORDER = ['Input', 'Structure', 'Elements', 'Modifiers', 'Advanced'];

  const paletteGroups = useMemo(() => {
    const q = paletteSearch.trim().toLowerCase();
    const items = q
      ? PALETTE_ITEMS.filter(i => i.label.toLowerCase().includes(q))
      : PALETTE_ITEMS;
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const cat = item.category ?? 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [paletteSearch]);

  const toggleCategory = (cat: string) =>
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  // ── Status icon ─────────────────────────────────────────────────────────
  const StatusIcon = status === 'compiling' ? Loader2
    : status === 'ok'      ? CheckCircle2
    : status === 'error'   ? AlertCircle
    : null;
  const statusColor = status === 'ok' ? 'text-emerald-500'
    : status === 'error'   ? 'text-red-500'
    : status === 'compiling' ? 'text-muted-foreground animate-spin'
    : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'flex flex-col bg-background border shadow-2xl overflow-hidden',
        isFullscreen ? 'fixed inset-0 z-[9999] rounded-none' : 'absolute z-50 rounded-lg',
        !visible && 'hidden',
      )}
      style={isFullscreen ? undefined : { left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40 shrink-0 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold tracking-tight">Node Graph Editor</span>

        <div className="flex-1" />

        {/* Status indicator */}
        {StatusIcon && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn('flex items-center gap-1 text-xs', statusColor,
                                  status === 'compiling' && 'animate-pulse')}>
                <StatusIcon className={cn('h-3.5 w-3.5', status === 'compiling' && 'animate-spin')} />
                {statusMsg && <span className="hidden sm:inline">{statusMsg}</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{statusMsg || status}</TooltipContent>
          </Tooltip>
        )}

        {/* Auto-compile toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={autoCompile ? 'default' : 'ghost'}
              size="icon-sm"
              onClick={() => setAutoCompile((v) => !v)}
              className={cn(autoCompile && 'bg-primary text-primary-foreground')}
            >
              <Zap className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{autoCompile ? 'Auto-compile on (click to disable)' : 'Auto-compile off (click to enable)'}</TooltipContent>
        </Tooltip>

        {/* Fullscreen toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => setIsFullscreen((v) => !v)}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
        </Tooltip>

        {/* Manual compile */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => void compile()} disabled={status === 'compiling'}>
              {status === 'compiling' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compile to IFC</TooltipContent>
        </Tooltip>

        {/* Close */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body: sidebar + canvas ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        <div className="w-44 shrink-0 border-r bg-background overflow-y-auto flex flex-col">
          {/* Search */}
          <div className="relative px-2 py-2 border-b">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              value={paletteSearch}
              onChange={e => setPaletteSearch(e.target.value)}
              placeholder="Search nodes…"
              className="w-full rounded border bg-muted/30 pl-6 pr-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {/* Category groups */}
          <div className="flex flex-col gap-0 p-1">
            {paletteGroups.map(([cat, items]) => {
              const isCollapsed = collapsedCategories.has(cat);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="flex w-full items-center gap-1 px-1 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground select-none transition-colors"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-3 w-3 shrink-0" />
                      : <ChevronDown className="h-3 w-3 shrink-0" />
                    }
                    {cat}
                  </button>
                  {!isCollapsed && items.map(item => {
                    const isEmoji = typeof item.icon === 'string';
                    const IconEl  = isEmoji ? null : item.icon as React.ElementType;
                    return (
                      <button
                        key={item.type}
                        onClick={() => addNode(item.type)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                      >
                        {isEmoji
                          ? <span className="text-sm leading-none">{item.icon as string}</span>
                          : IconEl && <IconEl className={cn('h-3.5 w-3.5 shrink-0', item.iconColor)} />
                        }
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ReactFlow canvas */}
        <div className="flex-1 min-w-0 h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            multiSelectionKeyCode="Control"
            selectionOnDrag
            panOnDrag={[1, 2]}
            panOnScroll
          >
            <Background />
            <Controls />
            <MiniMap zoomable pannable />
          </ReactFlow>
        </div>
      </div>

      {/* Resize grip — bottom-right corner */}
      {!isFullscreen && <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
        onMouseDown={onResizeMouseDown}
        title="Resize"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground/40" fill="currentColor">
          <path d="M14 10l-4 4h4v-4zm0-4l-8 8h2l6-6V6zm0-4L6 10h2L14 4V2z" />
        </svg>
      </div>}
    </div>
  );
}

// ─── Public export (wraps with provider) ──────────────────────────────────

interface NodeEditorPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function NodeEditorPanel({ visible, onClose }: NodeEditorPanelProps) {
  return (
    <ReactFlowProvider>
      <NodeEditorPanelInner visible={visible} onClose={onClose} />
    </ReactFlowProvider>
  );
}

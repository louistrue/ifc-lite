/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ViewsPanel — Visual card-based browser for saved architectural views.
 *
 * Supports Floor Plans (from IFC storeys), Sections, and Elevations.
 * Each view card shows a schematic SVG thumbnail with cut-position indicator.
 * Single-click activates: restores section plane + camera preset/viewpoint.
 * "Capture Current View" snapshots the live camera + section state exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  ChevronDown,
  LayoutTemplate,
  Scissors,
  ArrowRight,
  Layers,
  Camera,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { newViewId } from '@/store/slices/viewsSlice';
import { useFloorplanView } from '@/hooks/useFloorplanView';
import type { ViewDefinition } from '@/store/slices/viewsSlice';
import type { SectionPlaneAxis } from '@/store/types';
import { useIfc } from '@/hooks/useIfc';

// ─── View type config ──────────────────────────────────────────────────────────

const VIEW_CONFIG = {
  floorplan: {
    label: 'Floor Plan',
    shortLabel: 'FP',
    color: '#3b82f6',
    Icon: LayoutTemplate,
    presetView: 'top' as const,
    sectionAxis: 'down' as SectionPlaneAxis,
  },
  section: {
    label: 'Section',
    shortLabel: 'SEC',
    color: '#f97316',
    Icon: Scissors,
    presetView: 'front' as const,
    sectionAxis: 'front' as SectionPlaneAxis,
  },
  elevation: {
    label: 'Elevation',
    shortLabel: 'ELV',
    color: '#22c55e',
    Icon: ArrowRight,
    presetView: 'right' as const,
    sectionAxis: 'side' as SectionPlaneAxis,
  },
} as const;

const SCALE_OPTIONS = [
  { label: '1:20',  value: 20  },
  { label: '1:50',  value: 50  },
  { label: '1:100', value: 100 },
  { label: '1:200', value: 200 },
  { label: '1:500', value: 500 },
];

// ─── SVG thumbnails ────────────────────────────────────────────────────────────

function FloorPlanThumb({ color, position }: { color: string; position: number }) {
  const cutY = 6 + (1 - position / 100) * 44;
  return (
    <svg viewBox="0 0 80 56" className="w-full h-full">
      <rect x="8" y="6" width="64" height="44" fill={color + '15'} stroke={color} strokeWidth="1.2" rx="1" />
      <line x1="8" y1="22" x2="72" y2="22" stroke={color} strokeWidth="0.6" strokeOpacity="0.45" />
      <line x1="8" y1="36" x2="72" y2="36" stroke={color} strokeWidth="0.6" strokeOpacity="0.45" />
      <line x1="28" y1="6" x2="28" y2="50" stroke={color} strokeWidth="0.6" strokeOpacity="0.45" />
      <line x1="52" y1="6" x2="52" y2="50" stroke={color} strokeWidth="0.6" strokeOpacity="0.45" />
      <line x1="2" y1={cutY} x2="78" y2={cutY} stroke={color} strokeWidth="1.6" strokeDasharray="5,3" />
      <polygon points={`2,${cutY - 4} 6,${cutY} 2,${cutY + 4}`} fill={color} />
      <polygon points={`78,${cutY - 4} 74,${cutY} 78,${cutY + 4}`} fill={color} />
    </svg>
  );
}

function SectionThumb({ color, position }: { color: string; position: number }) {
  const cutX = 8 + (position / 100) * 64;
  return (
    <svg viewBox="0 0 80 56" className="w-full h-full">
      <rect x="8" y="6" width="64" height="44" fill={color + '15'} stroke={color} strokeWidth="1.2" rx="1" />
      <line x1="8" y1="20" x2="72" y2="20" stroke={color} strokeWidth="1.1" strokeOpacity="0.55" />
      <line x1="8" y1="34" x2="72" y2="34" stroke={color} strokeWidth="1.1" strokeOpacity="0.55" />
      <line x1={cutX} y1="2" x2={cutX} y2="54" stroke={color} strokeWidth="1.6" strokeDasharray="5,3" />
      <polygon points={`${cutX - 4},2 ${cutX},6 ${cutX + 4},2`} fill={color} />
      <polygon points={`${cutX - 4},54 ${cutX},50 ${cutX + 4},54`} fill={color} />
    </svg>
  );
}

function ElevationThumb({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 80 56" className="w-full h-full">
      <polygon points="8,16 40,4 72,16" fill={color + '18'} stroke={color} strokeWidth="1.2" />
      <rect x="8" y="16" width="64" height="34" fill={color + '12'} stroke={color} strokeWidth="1.2" rx="1" />
      <rect x="16" y="22" width="11" height="8" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <rect x="32" y="22" width="11" height="8" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <rect x="48" y="22" width="11" height="8" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <rect x="16" y="33" width="11" height="8" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <rect x="48" y="33" width="11" height="8" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <rect x="32" y="34" width="11" height="16" fill={color + '25'} stroke={color} strokeWidth="0.8" rx="1" />
      <line x1="4" y1="50" x2="76" y2="50" stroke={color} strokeWidth="1.5" strokeOpacity="0.4" />
    </svg>
  );
}

function ViewThumb({ view }: { view: ViewDefinition }) {
  const color = VIEW_CONFIG[view.type].color;
  if (view.type === 'floorplan') return <FloorPlanThumb color={color} position={view.sectionPosition} />;
  if (view.type === 'section')   return <SectionThumb   color={color} position={view.sectionPosition} />;
  return <ElevationThumb color={color} />;
}




// ─── useActivateView ──────────────────────────────────────────────────────────

function useActivateView() {
  // Read everything lazily from the store at call-time to avoid stale closures.
  // Pattern mirrors basketViewActivator.ts and useFloorplanView.ts.
  return useCallback((id: string) => {
    const state = useViewerStore.getState();
    const view  = state.views.get(id);
    if (!view) return;

    // 1. Apply section plane position & axis
    state.setSectionPlaneAxis(view.sectionAxis);
    state.setSectionPlanePosition(view.sectionPosition);

    // 2. Activate / deactivate section tool
    //    The renderer checks activeTool === 'section', NOT sectionPlane.enabled.
    if (view.sectionEnabled) {
      if (state.activeTool !== 'section') {
        state.setSuppressNextSection2DPanelAutoOpen(true);
      }
      state.setActiveTool('section');
    } else if (state.activeTool === 'section') {
      state.setActiveTool('select');
    }

    // 3. Camera projection mode (calls renderer callback internally)
    state.setProjectionMode(view.camera.projectionMode);

    // 4. Camera position — prefer captured viewpoint, fall back to named preset
    if (view.camera.capturedViewpoint) {
      state.cameraCallbacks.applyViewpoint?.(view.camera.capturedViewpoint, true, 350);
    } else if (view.camera.presetView) {
      state.cameraCallbacks.setPresetView?.(view.camera.presetView);
    }
  }, []); // No React deps needed — reads live state at invocation time
}

// ─── useSectionPositionCalc ───────────────────────────────────────────────────

function useSectionPositionCalc() {
  const { models }     = useIfc();
  const geometryResult = useViewerStore((s) => s.geometryResult);

  return useCallback(
    (cutHeight: number) => {
      let yMin = Infinity, yMax = -Infinity;

      if (models.size > 0) {
        for (const [, model] of models) {
          const b = model.geometryResult?.coordinateInfo?.shiftedBounds;
          if (b) { yMin = Math.min(yMin, b.min.y); yMax = Math.max(yMax, b.max.y); }
        }
      }
      const b = geometryResult?.coordinateInfo?.shiftedBounds;
      if (b) { yMin = Math.min(yMin, b.min.y); yMax = Math.max(yMax, b.max.y); }
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -10; yMax = 50; }
      const range = yMax - yMin;
      return range > 0 ? Math.max(0, Math.min(100, ((cutHeight - yMin) / range) * 100)) : 50;
    },
    [models, geometryResult],
  );
}

// ─── StoreyInfo ───────────────────────────────────────────────────────────────

interface StoreyInfo {
  expressId: number;
  modelId: string;
  name: string;
  elevation: number;
}

// ─── ViewCard ─────────────────────────────────────────────────────────────────

interface ViewCardProps {
  view: ViewDefinition;
  isActive: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onOpenTab: () => void;
  onEditToggle: () => void;
  onDelete: () => void;
}

function ViewCard({ view, isActive, isEditing, onActivate, onOpenTab, onEditToggle, onDelete }: ViewCardProps) {
  const cfg        = VIEW_CONFIG[view.type];
  const color      = cfg.color;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft]       = useState(view.name);
  const updateView = useViewerStore((s) => s.updateView);

  const commitRename = () => {
    const t = draft.trim();
    if (t) updateView(view.id, { name: t });
    else   setDraft(view.name);
    setRenaming(false);
  };

  return (
    <div
      className={cn(
        'group relative rounded-lg border cursor-pointer flex flex-col overflow-hidden transition-all select-none',
        'hover:border-primary/50 hover:shadow-sm',
        isActive  ? 'border-primary/70 ring-1 ring-primary/40 shadow-sm' : 'border-border',
        isEditing && !isActive && 'ring-1 ring-ring',
      )}
      onClick={onActivate}
      onDoubleClick={onOpenTab}
      title={`Click to activate · Double-click to open as tab`}
    >
      {/* Thumbnail */}
      <div className="w-full aspect-[4/3] p-1.5" style={{ background: color + '08' }}>
        <ViewThumb view={view} />
      </div>

      {/* Footer */}
      <div className="px-2 pb-2 pt-1 flex flex-col gap-0.5">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setDraft(view.name); setRenaming(false); }
              e.stopPropagation();
            }}
            className="text-xs w-full bg-background border border-border rounded px-1 py-0 outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className={cn('text-xs font-medium leading-tight truncate', isActive && 'text-primary')}>
            {view.name}
          </span>
        )}
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="text-[9px] font-semibold px-1 py-0.5 rounded"
            style={{ background: color + '20', color }}
          >
            {cfg.shortLabel}
          </span>
          <span className="text-[10px] text-muted-foreground">{view.sectionPosition.toFixed(0)}%</span>
          <span className="text-[10px] text-muted-foreground">1:{view.scale}</span>
          {isActive && <Check className="h-2.5 w-2.5 ml-auto text-primary shrink-0" />}
        </div>
      </div>

      {/* Hover action buttons */}
      <div
        className="absolute top-1 right-1 hidden group-hover:flex items-center gap-0.5 bg-background/90 backdrop-blur-sm rounded-md p-0.5 border border-border shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
          onClick={() => setRenaming(true)}
          title="Rename"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded transition-colors',
            isEditing ? 'bg-primary/20 text-primary' : 'hover:bg-muted',
          )}
          onClick={onEditToggle}
          title="Edit settings"
        >
          <Settings2 className="h-2.5 w-2.5" />
        </button>
        <button
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive transition-colors"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── ViewSettings ─────────────────────────────────────────────────────────────

interface ViewSettingsProps {
  view: ViewDefinition;
  isActive: boolean;
  onChange: (updates: Partial<ViewDefinition>) => void;
  onActivate: () => void;
}

function ViewSettings({ view, isActive, onChange, onActivate }: ViewSettingsProps) {
  const AXIS_OPTIONS: { label: string; value: SectionPlaneAxis }[] = [
    { label: 'Horizontal cut (plan)',      value: 'down'  },
    { label: 'Longitudinal cut (section)', value: 'front' },
    { label: 'Lateral cut (side)',         value: 'side'  },
  ];

  return (
    <div className="p-3 space-y-3 text-xs">
      {/* Name */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Name</span>
        <input
          value={view.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </label>

      {/* Section axis */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Cut Axis</span>
        <select
          value={view.sectionAxis}
          onChange={(e) => onChange({ sectionAxis: e.target.value as SectionPlaneAxis })}
          className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {AXIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {/* Cut position */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground flex items-center justify-between">
          <span>Cut Position</span>
          <span className="text-foreground font-medium font-mono">{view.sectionPosition.toFixed(1)}%</span>
        </span>
        <input
          type="range" min={0} max={100} step={0.5}
          value={view.sectionPosition}
          onChange={(e) => onChange({ sectionPosition: parseFloat(e.target.value) })}
          className="w-full accent-primary"
        />
      </label>

      {/* Depth + Base elevation */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">View Depth</span>
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} max={200} step={1}
              value={view.viewDepth}
              onChange={(e) => onChange({ viewDepth: parseFloat(e.target.value) || 0 })}
              className="flex-1 rounded border bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-muted-foreground shrink-0">m</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Base Elev.</span>
          <div className="flex items-center gap-1">
            <input
              type="number" step={0.01}
              value={view.baseElevation}
              onChange={(e) => onChange({ baseElevation: parseFloat(e.target.value) || 0 })}
              className="flex-1 rounded border bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-muted-foreground shrink-0">m</span>
          </div>
        </label>
      </div>

      {/* Scale */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Drawing Scale</span>
        <select
          value={view.scale}
          onChange={(e) => onChange({ scale: parseInt(e.target.value) })}
          className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {SCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {/* Checkboxes */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={view.camera.projectionMode === 'orthographic'}
            onChange={(e) =>
              onChange({ camera: { ...view.camera, projectionMode: e.target.checked ? 'orthographic' : 'perspective' } })
            }
          />
          <span className="text-muted-foreground">Orthographic</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={view.includeHiddenLines}
            onChange={(e) => onChange({ includeHiddenLines: e.target.checked })}
          />
          <span className="text-muted-foreground">Hidden lines</span>
        </label>
      </div>

      {/* Captured viewpoint note */}
      {view.camera.capturedViewpoint && (
        <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1 pt-1 border-t border-border/50">
          <Camera className="h-3 w-3 shrink-0" />
          <span>Exact camera viewpoint captured</span>
        </div>
      )}

      {/* Storey ref */}
      {view.storeyRef && (
        <div className="text-[10px] text-muted-foreground/70 pt-1 border-t border-border/50">
          IFC Storey: <span className="font-mono">{view.storeyRef.elevation.toFixed(3)} m</span>
        </div>
      )}

      <Button size="sm" className="w-full" onClick={onActivate}>
        <Check className="h-3.5 w-3.5 mr-1.5" />
        {isActive ? 'Re-activate View' : 'Activate View'}
      </Button>
    </div>
  );
}

// ─── NewMenu ──────────────────────────────────────────────────────────────────

interface NewMenuProps {
  storeys: StoreyInfo[];
  onCreate: (storey: StoreyInfo) => void;
  onCreateBlank: (type: 'section' | 'elevation') => void;
  onCapture: () => void;
  onClose: () => void;
}

function NewMenu({ storeys, onCreate, onCreateBlank, onCapture, onClose }: NewMenuProps) {
  const [showStoreys, setShowStoreys] = useState(false);

  return (
    <div className="absolute z-50 top-full right-0 mt-1 min-w-[220px] rounded-md border bg-popover shadow-lg overflow-hidden">
      {/* Floor Plan (storey sub-list) */}
      <div
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors cursor-pointer"
        onClick={() => setShowStoreys((v) => !v)}
      >
        <LayoutTemplate className="h-3.5 w-3.5 shrink-0" style={{ color: VIEW_CONFIG.floorplan.color }} />
        <span className="flex-1">Floor Plan</span>
        <span className="text-muted-foreground text-[10px]">{showStoreys ? '▲' : '▶'}</span>
      </div>
      {showStoreys && (
        storeys.length === 0 ? (
          <p className="text-xs text-muted-foreground pl-8 pr-3 py-1.5 italic">No storeys in model</p>
        ) : storeys.map((s) => (
          <button
            key={`${s.modelId}-${s.expressId}`}
            className="flex w-full items-center gap-2 pl-8 pr-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
            onClick={() => { onCreate(s); onClose(); }}
          >
            <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground/60 font-mono text-[10px]">{s.elevation.toFixed(1)} m</span>
          </button>
        ))
      )}

      <div className="h-px bg-border/60 mx-2" />

      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors"
        onClick={() => { onCreateBlank('section'); onClose(); }}
      >
        <Scissors className="h-3.5 w-3.5 shrink-0" style={{ color: VIEW_CONFIG.section.color }} />
        <span>Section</span>
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors"
        onClick={() => { onCreateBlank('elevation'); onClose(); }}
      >
        <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color: VIEW_CONFIG.elevation.color }} />
        <span>Elevation</span>
      </button>

      <div className="h-px bg-border/60 mx-2" />

      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors"
        onClick={() => { onCapture(); onClose(); }}
      >
        <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>Capture Current View</span>
      </button>
    </div>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'floorplan' | 'section' | 'elevation';
const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',       label: 'All'  },
  { id: 'floorplan', label: 'FP'   },
  { id: 'section',   label: 'Sec'  },
  { id: 'elevation', label: 'Elv'  },
];

// ─── Main panel ───────────────────────────────────────────────────────────────

interface ViewsPanelProps {
  onClose?: () => void;
}

export function ViewsPanel({ onClose }: ViewsPanelProps) {
  const views           = useViewerStore((s) => s.views);
  const activeViewId    = useViewerStore((s) => s.activeViewId);
  const addView         = useViewerStore((s) => s.addView);
  const updateView      = useViewerStore((s) => s.updateView);
  const deleteView      = useViewerStore((s) => s.deleteView);
  const setActiveViewId = useViewerStore((s) => s.setActiveViewId);
  const geometryResult  = useViewerStore((s) => s.geometryResult);
  const sectionPlane    = useViewerStore((s) => s.sectionPlane);
  const projectionMode  = useViewerStore((s) => s.projectionMode);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const openViewTab     = useViewerStore((s) => s.openViewTab);
  const setActiveTab    = useViewerStore((s) => s.setActiveTab);

  const [filterTab,   setFilterTab]   = useState<FilterTab>('all');
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  const { availableStoreys } = useFloorplanView();
  const { models }           = useIfc();
  const activateView         = useActivateView();
  const calcSectionPos       = useSectionPositionCalc();

  const allViews = useMemo(
    () => [...views.values()].sort((a, b) => a.createdAt - b.createdAt),
    [views],
  );

  const filteredViews = useMemo(
    () => filterTab === 'all' ? allViews : allViews.filter((v) => v.type === filterTab),
    [allViews, filterTab],
  );

  const editingView = editingId ? views.get(editingId) : null;

  // Close new menu on outside click
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showNewMenu]);

  // ── Create helpers ────────────────────────────────────────────────────────

  const createFloorPlan = useCallback(
    (storey: StoreyInfo) => {
      const cutHeight = storey.elevation + 1.2;
      const view: ViewDefinition = {
        id: newViewId(),
        name: storey.name,
        type: 'floorplan',
        sectionAxis: 'down',
        sectionPosition: calcSectionPos(cutHeight),
        sectionEnabled: true,
        sectionFlipped: false,
        storeyRef: { expressId: storey.expressId, modelId: storey.modelId, elevation: storey.elevation },
        camera: { presetView: 'top', projectionMode: 'orthographic' },
        cutElevation: cutHeight,
        baseElevation: storey.elevation,
        viewDepth: 3,
        scale: 100,
        includeHiddenLines: true,
        createdAt: Date.now(),
      };
      addView(view);
      setActiveViewId(view.id);
      setEditingId(null);
      activateView(view.id);
    },
    [calcSectionPos, addView, setActiveViewId, activateView],
  );

  const createBlank = useCallback(
    (type: 'section' | 'elevation') => {
      let zMin = Infinity, zMax = -Infinity;
      if (models.size > 0) {
        for (const [, m] of models) {
          const b = m.geometryResult?.coordinateInfo?.shiftedBounds;
          if (b) { zMin = Math.min(zMin, b.min.z); zMax = Math.max(zMax, b.max.z); }
        }
      }
      const b = geometryResult?.coordinateInfo?.shiftedBounds;
      if (b) { zMin = Math.min(zMin, b.min.z); zMax = Math.max(zMax, b.max.z); }
      if (!Number.isFinite(zMin)) { zMin = 0; zMax = 20; }

      const count = allViews.filter((v) => v.type === type).length;
      const cfg   = VIEW_CONFIG[type];
      const view: ViewDefinition = {
        id: newViewId(),
        name: `${cfg.label} ${count + 1}`,
        type,
        sectionAxis: cfg.sectionAxis,
        sectionPosition: 50,
        sectionEnabled: type === 'section',
        sectionFlipped: false,
        camera: { presetView: cfg.presetView, projectionMode: 'orthographic' },
        cutElevation: (zMin + zMax) / 2,
        baseElevation: 0,
        viewDepth: type === 'section' ? 20 : 50,
        scale: 100,
        includeHiddenLines: type === 'section',
        createdAt: Date.now(),
      };
      addView(view);
      setActiveViewId(view.id);
      setEditingId(view.id);
      activateView(view.id);
    },
    [allViews, models, geometryResult, addView, setActiveViewId, activateView],
  );

  const captureCurrentView = useCallback(() => {
    const capturedViewpoint = cameraCallbacks.getViewpoint?.() ?? undefined;
    const axisToType = { down: 'floorplan', front: 'section', side: 'elevation' } as const;
    const type = (axisToType[sectionPlane.axis] ?? 'section') as 'floorplan' | 'section' | 'elevation';
    const cfg   = VIEW_CONFIG[type];
    const count = allViews.filter((v) => v.type === type).length;

    const view: ViewDefinition = {
      id: newViewId(),
      name: `${cfg.label} ${count + 1}`,
      type,
      sectionAxis: sectionPlane.axis,
      sectionPosition: sectionPlane.position,
      sectionEnabled: sectionPlane.enabled,
      sectionFlipped: sectionPlane.flipped,
      camera: {
        presetView: cfg.presetView,
        projectionMode: projectionMode ?? 'orthographic',
        capturedViewpoint,
      },
      cutElevation: 0,
      baseElevation: 0,
      viewDepth: 10,
      scale: 100,
      includeHiddenLines: false,
      createdAt: Date.now(),
    };
    addView(view);
    setActiveViewId(view.id);
    setEditingId(view.id);
  }, [cameraCallbacks, sectionPlane, projectionMode, allViews, addView, setActiveViewId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleActivate = useCallback(
    (id: string) => {
      setActiveViewId(id);
      activateView(id);
    },
    [setActiveViewId, activateView],
  );

  // Double-click opens (or focuses) a drawing tab in the center pane
  const handleOpenTab = useCallback(
    (id: string) => {
      setActiveViewId(id);
      openViewTab(id);
      setActiveTab(id);
      activateView(id);
    },
    [setActiveViewId, openViewTab, setActiveTab, activateView],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteView(id);
      if (editingId === id) setEditingId(null);
    },
    [deleteView, editingId],
  );

  const handleSettingsChange = useCallback(
    (updates: Partial<ViewDefinition>) => {
      if (!editingId) return;
      updateView(editingId, updates);
      // Live-apply changes when editing the active view
      if (activeViewId === editingId) {
        if (updates.sectionAxis !== undefined)     useViewerStore.getState().setSectionPlaneAxis(updates.sectionAxis);
        if (updates.sectionPosition !== undefined)  useViewerStore.getState().setSectionPlanePosition(updates.sectionPosition);
        if (updates.camera?.projectionMode !== undefined) useViewerStore.getState().setProjectionMode(updates.camera.projectionMode);
      }
    },
    [editingId, activeViewId, updateView],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Views</span>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Filter tabs + New button */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <div className="flex gap-0.5 flex-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                'text-[10px] px-2 py-1 rounded font-medium transition-colors',
                filterTab === tab.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent',
              )}
              onClick={() => setFilterTab(tab.id)}
            >
              {tab.label}
              {tab.id !== 'all' && (
                <span className="ml-1 opacity-60">
                  {allViews.filter((v) => v.type === tab.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative" ref={newMenuRef}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-accent transition-colors',
                  showNewMenu && 'bg-accent',
                )}
                onClick={() => setShowNewMenu((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </TooltipTrigger>
            <TooltipContent>Add a new view</TooltipContent>
          </Tooltip>
          {showNewMenu && (
            <NewMenu
              storeys={availableStoreys}
              onCreate={createFloorPlan}
              onCreateBlank={createBlank}
              onCapture={captureCurrentView}
              onClose={() => setShowNewMenu(false)}
            />
          )}
        </div>
      </div>

      {/* Cards grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {filteredViews.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center h-full">
            <LayoutTemplate className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {filterTab === 'all'
                ? 'No views yet'
                : `No ${VIEW_CONFIG[filterTab as Exclude<FilterTab, 'all'>]?.label ?? filterTab}s`}
            </p>
            <p className="text-xs text-muted-foreground/60">
              Use <strong>+ New</strong> to add a floor plan, section, or elevation.
              <br />Or <strong>Capture</strong> to save the current camera state.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredViews.map((view) => (
              <ViewCard
                key={view.id}
                view={view}
                isActive={activeViewId === view.id}
                isEditing={editingId === view.id}
                onActivate={() => handleActivate(view.id)}
                onOpenTab={() => handleOpenTab(view.id)}
                onEditToggle={() => setEditingId((prev) => prev === view.id ? null : view.id)}
                onDelete={() => handleDelete(view.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Settings accordion — slides in below the grid */}
      {editingView && (
        <div className="shrink-0 border-t overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/40 transition-colors bg-muted/20"
            onClick={() => setEditingId(null)}
          >
            <span className="font-medium truncate">{editingView.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 rotate-180" />
          </button>
          <div className="overflow-y-auto max-h-[340px]">
            <ViewSettings
              view={editingView}
              isActive={activeViewId === editingView.id}
              onChange={handleSettingsChange}
              onActivate={() => handleActivate(editingView.id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

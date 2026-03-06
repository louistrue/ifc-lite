/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ViewsPanel — Project browser for saved architectural views.
 *
 * Displays Floor Plans, Sections, and Elevations grouped by type.
 * Allows creating views from IFC storeys or from scratch, editing
 * per-view camera/cut/drawing settings, and activating views (which
 * restores section plane + camera preset + projection mode).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  Scissors,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { newViewId } from '@/store/slices/viewsSlice';
import { useFloorplanView } from '@/hooks/useFloorplanView';
import type { ViewDefinition } from '@/store/slices/viewsSlice';
import type { SectionPlaneAxis } from '@/store/types';

// ─── useActivateView ─────────────────────────────────────────────────────────

/**
 * Returns a stable callback that fires all store mutations needed
 * to restore a saved view: section plane, projection mode, camera preset.
 */
function useActivateView() {
  const views = useViewerStore((s) => s.views);
  const setSectionPlaneAxis = useViewerStore((s) => s.setSectionPlaneAxis);
  const setSectionPlanePosition = useViewerStore((s) => s.setSectionPlanePosition);
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const toggleSectionPlane = useViewerStore((s) => s.toggleSectionPlane);
  const setProjectionMode = useViewerStore((s) => s.setProjectionMode);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);

  return useCallback(
    (id: string) => {
      const view = views.get(id);
      if (!view) return;

      setSectionPlaneAxis(view.sectionAxis);
      setSectionPlanePosition(view.sectionPosition);

      if (view.sectionEnabled && !sectionPlane.enabled) toggleSectionPlane();
      else if (!view.sectionEnabled && sectionPlane.enabled) toggleSectionPlane();

      setProjectionMode(view.camera.projectionMode);

      if (view.camera.presetView) {
        cameraCallbacks.setPresetView?.(view.camera.presetView);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, setSectionPlaneAxis, setSectionPlanePosition, sectionPlane.enabled, toggleSectionPlane, setProjectionMode, cameraCallbacks],
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StoreyInfo {
  expressId: number;
  modelId: string;
  name: string;
  elevation: number;
}

function useSectionPositionCalc() {
  const { models } = useIfc();
  const geometryResult = useViewerStore((s) => s.geometryResult);

  return useCallback(
    (cutHeight: number) => {
      let yMin = Infinity;
      let yMax = -Infinity;

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

// import useIfc here to avoid circular dep issues
import { useIfc } from '@/hooks/useIfc';

// ─── Scale options ─────────────────────────────────────────────────────────

const SCALE_OPTIONS = [
  { label: '1:20',   value: 20  },
  { label: '1:50',   value: 50  },
  { label: '1:100',  value: 100 },
  { label: '1:200',  value: 200 },
  { label: '1:500',  value: 500 },
];

// ─── ViewRow ──────────────────────────────────────────────────────────────────

interface ViewRowProps {
  view: ViewDefinition;
  isActive: boolean;
  isSelected: boolean;
  onActivate: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function ViewRow({ view, isActive, isSelected, onActivate, onSelect, onDelete, onRename }: ViewRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.name);

  const Icon = view.type === 'floorplan' ? LayoutTemplate : view.type === 'section' ? Scissors : ArrowRight;

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    else setDraft(view.name);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer select-none transition-colors',
        isSelected ? 'bg-accent' : 'hover:bg-accent/60',
        isActive && 'ring-1 ring-primary/50',
      )}
      onClick={onSelect}
      onDoubleClick={onActivate}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setDraft(view.name); setEditing(false); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-background border rounded px-1 py-0 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <span className={cn('flex-1 min-w-0 truncate text-xs', isActive && 'font-medium')}>
          {view.name}
        </span>
      )}

      {isActive && !editing && (
        <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Active view" />
      )}

      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(view.name); }}
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive transition-colors"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── ViewGroup ────────────────────────────────────────────────────────────────

interface ViewGroupProps {
  title: string;
  icon: React.ElementType;
  views: ViewDefinition[];
  activeViewId: string | null;
  selectedId: string | null;
  onActivate: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  actions?: React.ReactNode;
}

function ViewGroup({
  title, icon: GroupIcon, views, activeViewId, selectedId,
  onActivate, onSelect, onDelete, onRename, actions,
}: ViewGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-muted/40 rounded select-none"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        }
        <GroupIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium flex-1">
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground/60 mr-1">{views.length}</span>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>

      {!collapsed && (
        <div className="ml-2">
          {views.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-1 italic">No views yet</p>
          )}
          {views.map((v) => (
            <ViewRow
              key={v.id}
              view={v}
              isActive={activeViewId === v.id}
              isSelected={selectedId === v.id}
              onActivate={() => onActivate(v.id)}
              onSelect={() => onSelect(v.id)}
              onDelete={() => onDelete(v.id)}
              onRename={(name) => onRename(v.id, name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ViewSettings ─────────────────────────────────────────────────────────────

interface ViewSettingsProps {
  view: ViewDefinition;
  onChange: (updates: Partial<ViewDefinition>) => void;
}

function ViewSettings({ view, onChange }: ViewSettingsProps) {
  const AXIS_OPTIONS: { label: string; value: SectionPlaneAxis }[] = [
    { label: 'Horizontal (Y)', value: 'down'  },
    { label: 'Longitudinal (Z)', value: 'front' },
    { label: 'Lateral (X)',  value: 'side'  },
  ];

  return (
    <div className="border-t bg-muted/20 p-3 flex flex-col gap-3 text-xs">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">View Settings</p>

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
          {AXIS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Cut position */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Cut Position <span className="text-foreground font-medium">{view.sectionPosition.toFixed(1)}%</span></span>
        <input
          type="range" min={0} max={100} step={0.5}
          value={view.sectionPosition}
          onChange={(e) => onChange({ sectionPosition: parseFloat(e.target.value) })}
          className="w-full"
        />
      </label>

      {/* View depth */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">View Depth <span className="text-foreground font-medium">{view.viewDepth} m</span></span>
        <input
          type="range" min={0} max={100} step={1}
          value={view.viewDepth}
          onChange={(e) => onChange({ viewDepth: parseFloat(e.target.value) })}
          className="w-full"
        />
      </label>

      {/* Base elevation */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Base Elevation (Workplane)</span>
        <div className="flex items-center gap-1">
          <input
            type="number" step={0.01}
            value={view.baseElevation}
            onChange={(e) => onChange({ baseElevation: parseFloat(e.target.value) || 0 })}
            className="flex-1 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground">m</span>
        </div>
      </label>

      {/* Scale */}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Drawing Scale</span>
        <select
          value={view.scale}
          onChange={(e) => onChange({ scale: parseInt(e.target.value) })}
          className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {SCALE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Projection mode */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={view.camera.projectionMode === 'orthographic'}
          onChange={(e) =>
            onChange({ camera: { ...view.camera, projectionMode: e.target.checked ? 'orthographic' : 'perspective' } })
          }
        />
        <span className="text-muted-foreground">Orthographic projection</span>
      </label>

      {/* Hidden lines */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={view.includeHiddenLines}
          onChange={(e) => onChange({ includeHiddenLines: e.target.checked })}
        />
        <span className="text-muted-foreground">Include hidden lines</span>
      </label>

      {/* Storey info (read-only) */}
      {view.storeyRef && (
        <div className="text-muted-foreground/70 pt-1 border-t">
          <span>IFC Storey elevation: </span>
          <span className="font-mono">{view.storeyRef.elevation.toFixed(3)} m</span>
        </div>
      )}
    </div>
  );
}

// ─── StoreyMenu ───────────────────────────────────────────────────────────────

interface StoreyMenuProps {
  storeys: StoreyInfo[];
  onSelect: (storey: StoreyInfo) => void;
  onClose: () => void;
}

function StoreyMenu({ storeys, onSelect, onClose }: StoreyMenuProps) {
  return (
    <div className="absolute z-50 top-full left-0 mt-1 min-w-[180px] rounded-md border bg-popover shadow-md overflow-hidden">
      {storeys.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">No storeys found</p>
      )}
      {storeys.map((s) => (
        <button
          key={`${s.modelId}-${s.expressId}`}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
          onClick={() => { onSelect(s); onClose(); }}
        >
          <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{s.name}</span>
          <span className="text-muted-foreground/60 font-mono">{s.elevation.toFixed(2)} m</span>
        </button>
      ))}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface ViewsPanelProps {
  onClose?: () => void;
}

export function ViewsPanel({ onClose }: ViewsPanelProps) {
  const views         = useViewerStore((s) => s.views);
  const activeViewId  = useViewerStore((s) => s.activeViewId);
  const addView       = useViewerStore((s) => s.addView);
  const updateView    = useViewerStore((s) => s.updateView);
  const deleteView    = useViewerStore((s) => s.deleteView);
  const setActiveViewId = useViewerStore((s) => s.setActiveViewId);
  const geometryResult = useViewerStore((s) => s.geometryResult);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showStoreyMenu, setShowStoreyMenu] = useState(false);
  const [showSectionStoreyMenu, setShowSectionStoreyMenu] = useState(false);

  const { availableStoreys } = useFloorplanView();
  const { models } = useIfc();
  const activateView = useActivateView();
  const calcSectionPos = useSectionPositionCalc();

  // Derived groups
  const floorPlans = useMemo(() => [...views.values()].filter((v) => v.type === 'floorplan'), [views]);
  const sections   = useMemo(() => [...views.values()].filter((v) => v.type === 'section'),   [views]);
  const elevations = useMemo(() => [...views.values()].filter((v) => v.type === 'elevation'),  [views]);

  const selectedView = selectedId ? views.get(selectedId) : null;

  // ── Create helpers ──────────────────────────────────────────────────────────

  const createFloorPlan = useCallback(
    (storey: StoreyInfo) => {
      const cutHeight = storey.elevation + 1.2;
      const pos = calcSectionPos(cutHeight);

      const view: ViewDefinition = {
        id: newViewId(),
        name: storey.name,
        type: 'floorplan',
        sectionAxis: 'down',
        sectionPosition: pos,
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
      setSelectedId(view.id);
      setActiveViewId(view.id);
      activateView(view.id);
    },
    [calcSectionPos, addView, setActiveViewId, activateView],
  );

  const createSection = useCallback(() => {
    // Get Z bounds for center position
    let zMin = Infinity;
    let zMax = -Infinity;
    if (models.size > 0) {
      for (const [, m] of models) {
        const b = m.geometryResult?.coordinateInfo?.shiftedBounds;
        if (b) { zMin = Math.min(zMin, b.min.z); zMax = Math.max(zMax, b.max.z); }
      }
    }
    const b = geometryResult?.coordinateInfo?.shiftedBounds;
    if (b) { zMin = Math.min(zMin, b.min.z); zMax = Math.max(zMax, b.max.z); }
    if (!Number.isFinite(zMin)) { zMin = 0; zMax = 20; }

    const view: ViewDefinition = {
      id: newViewId(),
      name: `Section ${sections.length + 1}`,
      type: 'section',
      sectionAxis: 'front',
      sectionPosition: 50,
      sectionEnabled: true,
      sectionFlipped: false,
      camera: { presetView: 'front', projectionMode: 'orthographic' },
      cutElevation: (zMin + zMax) / 2,
      baseElevation: 0,
      viewDepth: 20,
      scale: 100,
      includeHiddenLines: true,
      createdAt: Date.now(),
    };

    addView(view);
    setSelectedId(view.id);
    setActiveViewId(view.id);
    activateView(view.id);
  }, [sections.length, models, geometryResult, addView, setActiveViewId, activateView]);

  const createElevation = useCallback(() => {
    const view: ViewDefinition = {
      id: newViewId(),
      name: `Elevation ${elevations.length + 1}`,
      type: 'elevation',
      sectionAxis: 'side',
      sectionPosition: 100,
      sectionEnabled: false,
      sectionFlipped: false,
      camera: { presetView: 'right', projectionMode: 'orthographic' },
      cutElevation: 0,
      baseElevation: 0,
      viewDepth: 50,
      scale: 100,
      includeHiddenLines: false,
      createdAt: Date.now(),
    };

    addView(view);
    setSelectedId(view.id);
    setActiveViewId(view.id);
    activateView(view.id);
  }, [elevations.length, addView, setActiveViewId, activateView]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleActivate = useCallback(
    (id: string) => {
      setSelectedId(id);
      setActiveViewId(id);
      activateView(id);
    },
    [setActiveViewId, activateView],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      deleteView(id);
      if (selectedId === id) setSelectedId(null);
    },
    [deleteView, selectedId],
  );

  const handleRename = useCallback(
    (id: string, name: string) => updateView(id, { name }),
    [updateView],
  );

  // Close storey menus on outside click
  useEffect(() => {
    if (!showStoreyMenu && !showSectionStoreyMenu) return;
    const handler = () => { setShowStoreyMenu(false); setShowSectionStoreyMenu(false); };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showStoreyMenu, showSectionStoreyMenu]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const sharedGroupProps = {
    activeViewId,
    selectedId,
    onActivate: handleActivate,
    onSelect: handleSelect,
    onDelete: handleDelete,
    onRename: handleRename,
  };

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

      {/* View list */}
      <div className="flex-1 overflow-y-auto p-1 min-h-0">
        {/* Floor Plans group */}
        <ViewGroup
          title="Floor Plans"
          icon={LayoutTemplate}
          views={floorPlans}
          {...sharedGroupProps}
          actions={
            <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
                    onClick={(e) => { e.stopPropagation(); setShowStoreyMenu((v) => !v); }}
                    title="New floor plan from storey"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New floor plan from storey</TooltipContent>
              </Tooltip>
              {showStoreyMenu && (
                <StoreyMenu
                  storeys={availableStoreys}
                  onSelect={createFloorPlan}
                  onClose={() => setShowStoreyMenu(false)}
                />
              )}
            </div>
          }
        />

        {/* Sections group */}
        <ViewGroup
          title="Sections"
          icon={Scissors}
          views={sections}
          {...sharedGroupProps}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
                  onClick={(e) => { e.stopPropagation(); createSection(); }}
                  title="New section"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New section</TooltipContent>
            </Tooltip>
          }
        />

        {/* Elevations group */}
        <ViewGroup
          title="Elevations"
          icon={ArrowRight}
          views={elevations}
          {...sharedGroupProps}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
                  onClick={(e) => { e.stopPropagation(); createElevation(); }}
                  title="New elevation"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New elevation</TooltipContent>
            </Tooltip>
          }
        />

        {/* Empty state */}
        {views.size === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
            <LayoutTemplate className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No views yet</p>
            <p className="text-xs text-muted-foreground/60">
              Create a floor plan from an IFC storey using the <strong>+</strong> button above, or add a section / elevation.
            </p>
          </div>
        )}
      </div>

      {/* View settings — shown when a view is selected */}
      {selectedView && (
        <div className="shrink-0 overflow-y-auto max-h-[55%] border-t">
          <ViewSettings
            view={selectedView}
            onChange={(updates) => {
              updateView(selectedView.id, updates);
              // If this is the active view, re-apply changes immediately
              if (activeViewId === selectedView.id) {
                // Re-fire activateView so section plane / camera update
                const updated: ViewDefinition = { ...selectedView, ...updates };
                // Apply only the changed settings, not full re-activate
                if (updates.sectionAxis !== undefined || updates.sectionPosition !== undefined) {
                  const setSectionPlaneAxis = useViewerStore.getState().setSectionPlaneAxis;
                  const setSectionPlanePosition = useViewerStore.getState().setSectionPlanePosition;
                  setSectionPlaneAxis(updates.sectionAxis ?? updated.sectionAxis);
                  setSectionPlanePosition(updates.sectionPosition ?? updated.sectionPosition);
                }
                if (updates.camera?.projectionMode !== undefined) {
                  useViewerStore.getState().setProjectionMode(updated.camera.projectionMode);
                }
              }
            }}
          />
          {/* Activate button */}
          <div className="px-3 pb-3 pt-1 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => handleActivate(selectedView.id)}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Activate View
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

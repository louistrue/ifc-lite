/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CommandPalette — Ctrl+K / Cmd+K fuzzy-searchable command palette.
 *
 * Provides quick access to ALL viewer features: scripts, tools, camera,
 * visibility, panels, exports, and settings. Tracks recent usage per user
 * via localStorage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  Search,
  Play,
  MousePointer2,
  Hand,
  Rotate3d,
  PersonStanding,
  Ruler,
  Scissors,
  Home,
  Maximize2,
  Crosshair,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  EyeOff,
  Eye,
  Equal,
  Plus,
  Minus,
  RotateCcw,
  SquareX,
  Building2,
  Layout,
  TreeDeciduous,
  FileCode2,
  MessageSquare,
  ClipboardCheck,
  FileSpreadsheet,
  Palette,
  Camera,
  Download,
  FileJson,
  Sun,
  Info,
  Orbit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewerStore, stringToEntityRef } from '@/store';
import type { EntityRef } from '@/store';
import { useSandbox } from '@/hooks/useSandbox';
import { SCRIPT_TEMPLATES } from '@/lib/scripts/templates';
import { GLTFExporter, CSVExporter } from '@ifc-lite/export';

// ── Types ──────────────────────────────────────────────────────────────

type Category = 'Recent' | 'Scripts' | 'Tools' | 'Camera' | 'Visibility' | 'Panels' | 'Export' | 'Settings';

interface Command {
  id: string;
  label: string;
  description: string;
  category: Exclude<Category, 'Recent'>;
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
}

interface FlatItem {
  cmd: Command;
  flatIdx: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const RECENT_STORAGE_KEY = 'ifc-lite:cmd-palette:recent';
const MAX_RECENT_DISPLAY = 5;
const CATEGORY_ORDER: Category[] = [
  'Recent', 'Scripts', 'Tools', 'Camera', 'Visibility', 'Panels', 'Export', 'Settings',
];

// ── Helpers ────────────────────────────────────────────────────────────

/** Scored fuzzy match — returns 0 (no match) or a positive score.
 *  Higher = better match. Prefers substring > word-start > fuzzy.
 *  This avoids the "IDS" matching "Structural analysIs" problem. */
function matchScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring — best score
  if (t.includes(q)) return 100;

  // Word-start match: every query char starts a word boundary
  // e.g. "csv" matches "Export CSV: Spatial" via C-S-V word starts
  const words = t.split(/[\s\-_:\/]+/);
  let wi = 0;
  let qi = 0;
  while (wi < words.length && qi < q.length) {
    if (words[wi].length > 0 && words[wi][0] === q[qi]) qi++;
    wi++;
  }
  if (qi === q.length) return 50;

  // Strict fuzzy: characters must appear in order, but penalize large gaps.
  // Reject if the average gap between matched chars is too large.
  let lastIdx = -1;
  let totalGap = 0;
  qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (lastIdx >= 0) totalGap += (i - lastIdx - 1);
      lastIdx = i;
      qi++;
    }
  }
  if (qi < q.length) return 0; // no match at all
  const avgGap = q.length > 1 ? totalGap / (q.length - 1) : 0;
  if (avgGap > 5) return 0; // reject loose matches (chars scattered too far apart)
  return Math.max(1, 25 - Math.round(avgGap * 3));
}

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function recordUsage(id: string): void {
  try {
    const recent = getRecentIds().filter(r => r !== id);
    recent.unshift(id);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent.slice(0, 30)));
  } catch { /* ignore storage errors */ }
}

function downloadBlob(data: BlobPart, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getSelectionRefs(): EntityRef[] {
  const state = useViewerStore.getState();
  if (state.selectedEntitiesSet.size > 0) {
    const refs: EntityRef[] = [];
    for (const str of state.selectedEntitiesSet) {
      refs.push(stringToEntityRef(str));
    }
    return refs;
  }
  if (state.selectedEntity) return [state.selectedEntity];
  return [];
}

function clearMultiSelect(): void {
  const state = useViewerStore.getState();
  if (state.selectedEntitiesSet.size > 0) {
    useViewerStore.setState({ selectedEntitiesSet: new Set(), selectedEntityIds: new Set() });
  }
}

// ── Component ──────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigatedByKeyboard = useRef(false);

  const { execute } = useSandbox();

  // Load recent IDs when palette opens
  useEffect(() => {
    if (open) {
      setRecentIds(getRecentIds());
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Build ALL commands ──
  // Only depends on `execute` from useSandbox — all other store access
  // happens at execution time via getState() to avoid reactive subscriptions.
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // ── Scripts ──
    for (const template of SCRIPT_TEMPLATES) {
      cmds.push({
        id: `script:${template.name}`,
        label: template.name,
        description: template.description,
        category: 'Scripts',
        icon: Play,
        action: () => {
          const s = useViewerStore.getState();
          s.setScriptPanelVisible(true);
          s.setScriptEditorContent(template.code);
          execute(template.code);
        },
      });
    }

    // ── Tools ──
    const toolDefs = [
      { id: 'tool:select', label: 'Select Tool', desc: 'Click to select entities', icon: MousePointer2, tool: 'select', shortcut: 'V' },
      { id: 'tool:pan', label: 'Pan Tool', desc: 'Click and drag to pan the view', icon: Hand, tool: 'pan', shortcut: 'P' },
      { id: 'tool:orbit', label: 'Orbit Tool', desc: 'Rotate the 3D view', icon: Rotate3d, tool: 'orbit', shortcut: 'O' },
      { id: 'tool:walk', label: 'Walk Mode', desc: 'First-person navigation', icon: PersonStanding, tool: 'walk', shortcut: 'C' },
      { id: 'tool:measure', label: 'Measure Tool', desc: 'Measure distances between points', icon: Ruler, tool: 'measure', shortcut: 'M' },
      { id: 'tool:section', label: 'Section Tool', desc: 'Create section planes', icon: Scissors, tool: 'section', shortcut: 'X' },
    ] as const;
    for (const t of toolDefs) {
      cmds.push({
        id: t.id, label: t.label, description: t.desc,
        category: 'Tools', icon: t.icon, shortcut: t.shortcut,
        action: () => { useViewerStore.getState().setActiveTool(t.tool); },
      });
    }

    // ── Camera ──
    cmds.push({
      id: 'camera:home', label: 'Home (Isometric)', description: 'Reset camera to isometric view',
      category: 'Camera', icon: Home, shortcut: 'H',
      action: () => { useViewerStore.getState().cameraCallbacks.home?.(); },
    });
    cmds.push({
      id: 'camera:fit-all', label: 'Fit All', description: 'Zoom to fit all objects',
      category: 'Camera', icon: Maximize2, shortcut: 'Z',
      action: () => { useViewerStore.getState().cameraCallbacks.fitAll?.(); },
    });
    cmds.push({
      id: 'camera:frame', label: 'Frame Selection', description: 'Zoom to fit selected entity',
      category: 'Camera', icon: Crosshair, shortcut: 'F',
      action: () => { useViewerStore.getState().cameraCallbacks.frameSelection?.(); },
    });
    cmds.push({
      id: 'camera:projection', label: 'Toggle Projection', description: 'Switch between perspective and orthographic',
      category: 'Camera', icon: Orbit,
      action: () => { useViewerStore.getState().toggleProjectionMode(); },
    });

    const presetViews = [
      { name: 'Top', icon: ArrowUp, shortcut: '1', key: 'top' },
      { name: 'Bottom', icon: ArrowDown, shortcut: '2', key: 'bottom' },
      { name: 'Front', icon: ArrowRight, shortcut: '3', key: 'front' },
      { name: 'Back', icon: ArrowLeft, shortcut: '4', key: 'back' },
      { name: 'Left', icon: ArrowLeft, shortcut: '5', key: 'left' },
      { name: 'Right', icon: ArrowRight, shortcut: '6', key: 'right' },
    ] as const;
    for (const p of presetViews) {
      cmds.push({
        id: `camera:${p.key}`, label: `${p.name} View`, description: `Camera preset: ${p.name.toLowerCase()} view`,
        category: 'Camera', icon: p.icon, shortcut: p.shortcut,
        action: () => { useViewerStore.getState().cameraCallbacks.setPresetView?.(p.key); },
      });
    }

    // ── Visibility ──
    cmds.push({
      id: 'vis:hide', label: 'Hide Selection', description: 'Hide selected entities',
      category: 'Visibility', icon: EyeOff, shortcut: 'Del',
      action: () => {
        const s = useViewerStore.getState();
        const ids = s.selectedEntityIds.size > 0
          ? Array.from(s.selectedEntityIds)
          : s.selectedEntityId !== null ? [s.selectedEntityId] : [];
        if (ids.length > 0) { s.hideEntities(ids); s.clearSelection(); }
      },
    });
    cmds.push({
      id: 'vis:show-all', label: 'Show All', description: 'Reset visibility — show all hidden entities',
      category: 'Visibility', icon: Eye, shortcut: 'A',
      action: () => { const s = useViewerStore.getState(); s.showAll(); s.clearStoreySelection(); },
    });
    cmds.push({
      id: 'vis:set-basket', label: 'Set Basket', description: 'Isolate selection as basket',
      category: 'Visibility', icon: Equal, shortcut: 'I',
      action: () => {
        const s = useViewerStore.getState();
        if (s.pinboardEntities.size > 0 && s.selectedEntitiesSet.size === 0) {
          s.showPinboard();
        } else {
          const refs = getSelectionRefs();
          if (refs.length > 0) { s.setBasket(refs); clearMultiSelect(); }
        }
      },
    });
    cmds.push({
      id: 'vis:add-basket', label: 'Add to Basket', description: 'Add selection to isolation basket',
      category: 'Visibility', icon: Plus, shortcut: '+',
      action: () => {
        const refs = getSelectionRefs();
        if (refs.length > 0) { useViewerStore.getState().addToBasket(refs); clearMultiSelect(); }
      },
    });
    cmds.push({
      id: 'vis:remove-basket', label: 'Remove from Basket', description: 'Remove selection from basket',
      category: 'Visibility', icon: Minus, shortcut: '−',
      action: () => {
        const refs = getSelectionRefs();
        if (refs.length > 0) { useViewerStore.getState().removeFromBasket(refs); clearMultiSelect(); }
      },
    });
    cmds.push({
      id: 'vis:clear-basket', label: 'Clear Basket', description: 'Clear the isolation basket and show all',
      category: 'Visibility', icon: RotateCcw,
      action: () => { useViewerStore.getState().clearBasket(); },
    });
    cmds.push({
      id: 'vis:toggle-spaces', label: 'Toggle Spaces', description: 'Show or hide IfcSpace geometries',
      category: 'Visibility', icon: Box,
      action: () => { useViewerStore.getState().toggleTypeVisibility('spaces'); },
    });
    cmds.push({
      id: 'vis:toggle-openings', label: 'Toggle Openings', description: 'Show or hide IfcOpeningElement geometries',
      category: 'Visibility', icon: SquareX,
      action: () => { useViewerStore.getState().toggleTypeVisibility('openings'); },
    });
    cmds.push({
      id: 'vis:toggle-site', label: 'Toggle Site', description: 'Show or hide IfcSite geometries',
      category: 'Visibility', icon: Building2,
      action: () => { useViewerStore.getState().toggleTypeVisibility('site'); },
    });
    cmds.push({
      id: 'vis:reset-colors', label: 'Reset Colors', description: 'Clear all color overrides',
      category: 'Visibility', icon: Palette,
      action: () => { execute('bim.viewer.resetColors()\nconsole.log("Colors reset")'); },
    });

    // ── Panels ──
    cmds.push({
      id: 'panel:properties', label: 'Toggle Properties', description: 'Show or hide the properties panel',
      category: 'Panels', icon: Layout,
      action: () => {
        const s = useViewerStore.getState();
        s.setRightPanelCollapsed(!s.rightPanelCollapsed);
      },
    });
    cmds.push({
      id: 'panel:tree', label: 'Toggle Spatial Tree', description: 'Show or hide the spatial hierarchy tree',
      category: 'Panels', icon: TreeDeciduous,
      action: () => {
        const s = useViewerStore.getState();
        s.setLeftPanelCollapsed(!s.leftPanelCollapsed);
      },
    });
    cmds.push({
      id: 'panel:script', label: 'Toggle Script Editor', description: 'Show or hide the script editor panel',
      category: 'Panels', icon: FileCode2,
      action: () => { useViewerStore.getState().toggleScriptPanel(); },
    });
    cmds.push({
      id: 'panel:bcf', label: 'Toggle BCF Issues', description: 'Show or hide the BCF collaboration panel',
      category: 'Panels', icon: MessageSquare,
      action: () => {
        const s = useViewerStore.getState();
        if (!s.bcfPanelVisible) s.setRightPanelCollapsed(false);
        s.toggleBcfPanel();
      },
    });
    cmds.push({
      id: 'panel:ids', label: 'Toggle IDS Validation', description: 'Show or hide the IDS validation panel',
      category: 'Panels', icon: ClipboardCheck,
      action: () => {
        const s = useViewerStore.getState();
        if (!s.idsPanelVisible) s.setRightPanelCollapsed(false);
        s.toggleIdsPanel();
      },
    });
    cmds.push({
      id: 'panel:lists', label: 'Toggle Lists', description: 'Show or hide the entity lists panel',
      category: 'Panels', icon: FileSpreadsheet,
      action: () => {
        const s = useViewerStore.getState();
        if (!s.listPanelVisible) s.setRightPanelCollapsed(false);
        s.toggleListPanel();
      },
    });
    cmds.push({
      id: 'panel:lens', label: 'Toggle Lens', description: 'Show or hide lens color rules panel',
      category: 'Panels', icon: Palette,
      action: () => {
        const s = useViewerStore.getState();
        if (!s.lensPanelVisible) s.setRightPanelCollapsed(false);
        s.toggleLensPanel();
      },
    });

    // ── Export ──
    cmds.push({
      id: 'export:screenshot', label: 'Screenshot', description: 'Capture the current viewport as PNG',
      category: 'Export', icon: Camera,
      action: () => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return;
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = 'screenshot.png';
          a.click();
        } catch (err) { console.error('Screenshot failed:', err); }
      },
    });
    cmds.push({
      id: 'export:glb', label: 'Export GLB', description: 'Export 3D model as GLB file',
      category: 'Export', icon: Download,
      action: () => {
        const gr = useViewerStore.getState().geometryResult;
        if (!gr) return;
        try {
          const exporter = new GLTFExporter(gr);
          const glb = exporter.exportGLB({ includeMetadata: true });
          downloadBlob(new Uint8Array(glb), 'model.glb', 'model/gltf-binary');
        } catch (err) { console.error('GLB export failed:', err); }
      },
    });

    const csvExports = [
      { id: 'export:csv-entities', label: 'Export CSV: Entities', desc: 'Export entities with properties as CSV', type: 'entities', filename: 'entities.csv' },
      { id: 'export:csv-properties', label: 'Export CSV: Properties', desc: 'Export all property sets as CSV', type: 'properties', filename: 'properties.csv' },
      { id: 'export:csv-quantities', label: 'Export CSV: Quantities', desc: 'Export quantity sets as CSV', type: 'quantities', filename: 'quantities.csv' },
      { id: 'export:csv-spatial', label: 'Export CSV: Spatial', desc: 'Export spatial hierarchy as CSV', type: 'spatial', filename: 'spatial-hierarchy.csv' },
    ] as const;
    for (const csv of csvExports) {
      cmds.push({
        id: csv.id, label: csv.label, description: csv.desc,
        category: 'Export', icon: FileSpreadsheet,
        action: () => {
          const store = useViewerStore.getState().ifcDataStore;
          if (!store) return;
          try {
            const exporter = new CSVExporter(store);
            let data: string;
            switch (csv.type) {
              case 'entities': data = exporter.exportEntities(undefined, { includeProperties: true, flattenProperties: true }); break;
              case 'properties': data = exporter.exportProperties(); break;
              case 'quantities': data = exporter.exportQuantities(); break;
              case 'spatial': data = exporter.exportSpatialHierarchy(); break;
            }
            downloadBlob(data, csv.filename, 'text/csv');
          } catch (err) { console.error('CSV export failed:', err); }
        },
      });
    }

    cmds.push({
      id: 'export:json', label: 'Export JSON', description: 'Export all entity data as JSON',
      category: 'Export', icon: FileJson,
      action: () => {
        const store = useViewerStore.getState().ifcDataStore;
        if (!store) return;
        try {
          const entities: Record<string, unknown>[] = [];
          for (let i = 0; i < store.entities.count; i++) {
            const id = store.entities.expressId[i];
            entities.push({
              expressId: id,
              globalId: store.entities.getGlobalId(id),
              name: store.entities.getName(id),
              type: store.entities.getTypeName(id),
              properties: store.properties.getForEntity(id),
            });
          }
          downloadBlob(JSON.stringify({ entities }, null, 2), 'model-data.json', 'application/json');
        } catch (err) { console.error('JSON export failed:', err); }
      },
    });

    // ── Settings ──
    cmds.push({
      id: 'settings:theme', label: 'Toggle Theme', description: 'Switch between light and dark mode',
      category: 'Settings', icon: Sun, shortcut: 'T',
      action: () => { useViewerStore.getState().toggleTheme(); },
    });
    cmds.push({
      id: 'settings:tooltips', label: 'Toggle Hover Tooltips', description: 'Enable or disable entity tooltips on hover',
      category: 'Settings', icon: Info,
      action: () => { useViewerStore.getState().toggleHoverTooltips(); },
    });

    return cmds;
  }, [execute]);

  // Filter and rank commands by query relevance
  const filtered = useMemo(() => {
    if (!query) return commands;
    const scored = commands
      .map((cmd) => {
        // Score against label (primary), description, category
        const labelScore = matchScore(query, cmd.label);
        const descScore = matchScore(query, cmd.description);
        const catScore = matchScore(query, cmd.category);
        const best = Math.max(labelScore, descScore * 0.8, catScore * 0.6);
        return { cmd, score: best };
      })
      .filter(({ score }) => score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ cmd }) => cmd);
  }, [commands, query]);

  // Build grouped display with proper flat indices for keyboard navigation.
  // "Recent" section is shown at the top when there's no search query.
  const { grouped, flatItems } = useMemo(() => {
    const groups: { category: string; items: FlatItem[] }[] = [];
    const flat: FlatItem[] = [];
    let idx = 0;

    // Recent section (only when no query and we have history)
    if (!query && recentIds.length > 0) {
      const recentItems: FlatItem[] = [];
      for (const id of recentIds.slice(0, MAX_RECENT_DISPLAY)) {
        const cmd = commands.find(c => c.id === id);
        if (cmd) {
          const item = { cmd, flatIdx: idx++ };
          recentItems.push(item);
          flat.push(item);
        }
      }
      if (recentItems.length > 0) {
        groups.push({ category: 'Recent', items: recentItems });
      }
    }

    // Regular category groups
    for (const cat of CATEGORY_ORDER) {
      if (cat === 'Recent') continue;
      const catCmds = filtered.filter(c => c.category === cat);
      if (catCmds.length > 0) {
        const items: FlatItem[] = catCmds.map(cmd => {
          const item = { cmd, flatIdx: idx++ };
          flat.push(item);
          return item;
        });
        groups.push({ category: cat, items });
      }
    }

    return { grouped: groups, flatItems: flat };
  }, [filtered, query, commands, recentIds]);

  // Reset selection when query or open state changes
  useEffect(() => { setSelectedIndex(0); }, [query, open]);

  // Scroll selected item into view — only when keyboard navigated
  useEffect(() => {
    if (!navigatedByKeyboard.current || !listRef.current) return;
    navigatedByKeyboard.current = false;
    const item = listRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const runCommand = useCallback((cmd: Command) => {
    onOpenChange(false);
    recordUsage(cmd.id);
    requestAnimationFrame(() => cmd.action());
  }, [onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigatedByKeyboard.current = true;
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigatedByKeyboard.current = true;
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) runCommand(item.cmd);
    }
  }, [flatItems, selectedIndex, runCommand]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden" aria-label="Command palette">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-1" role="listbox">
          {flatItems.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </div>
              {group.items.map(({ cmd, flatIdx }) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={`${group.category}:${cmd.id}`}
                    role="option"
                    data-index={flatIdx}
                    aria-selected={flatIdx === selectedIndex}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors',
                      flatIdx === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                    onClick={() => runCommand(cmd)}
                    onMouseMove={() => {
                      if (selectedIndex !== flatIdx) setSelectedIndex(flatIdx);
                    }}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{cmd.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                    </div>
                    {cmd.shortcut && (
                      <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground shrink-0">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-t text-[10px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> run</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

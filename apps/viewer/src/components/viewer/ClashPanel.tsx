/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ClashPanel - Interactive clash detection results panel
 *
 * Features:
 * - View detected clashes with distance and element details
 * - Filter by clash set, type pair, or search query
 * - Sort by distance, element type, element name
 * - Click any clash to select + frame both elements in 3D
 * - Auto-colorize clashing elements (red=source, orange=target)
 * - Export results as JSON
 * - Configure detection mode, tolerance, clearance
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  X, Search, Download,
  ArrowUp, ArrowDown,
  Filter, Focus, Loader2, AlertCircle,
  Zap, Settings2, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useViewerStore } from '@/store';
import type { ClashFilterMode, ClashSortField } from '@/store/slices/clashSlice';
import { CLASH_COLORS } from '@ifc-lite/clash';
import type { ClashResult, Clash } from '@ifc-lite/clash';
import { useClash } from '@/hooks/useClash';
import { cn } from '@/lib/utils';

interface ClashPanelProps {
  onClose?: () => void;
}

function DistanceBadge({ distance }: { distance: number }) {
  if (distance < 0) {
    return (
      <Badge variant="destructive" className="text-xs font-mono">
        {distance.toFixed(3)}m
      </Badge>
    );
  }
  if (distance === 0) {
    return (
      <Badge variant="secondary" className="text-xs font-mono">
        touching
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs font-mono">
      {distance.toFixed(3)}m
    </Badge>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

export function ClashPanel({ onClose }: ClashPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typeA, setTypeA] = useState('');
  const [typeB, setTypeB] = useState('');

  // Hook for lifecycle actions
  const {
    runSelfClash,
    runCrossModelClash,
    applyClashColors: applyClashColorsHook,
    selectClashElement,
    isolateClashing,
    clearIsolation,
    clearColors,
    getAvailableTypes,
  } = useClash();

  // Store state
  const clashResult = useViewerStore((s) => s.clashResult);
  const clashLoading = useViewerStore((s) => s.clashLoading);
  const clashError = useViewerStore((s) => s.clashError);
  const clashFilterMode = useViewerStore((s) => s.clashFilterMode);
  const clashFilterValue = useViewerStore((s) => s.clashFilterValue);
  const clashSearchQuery = useViewerStore((s) => s.clashSearchQuery);
  const clashSortField = useViewerStore((s) => s.clashSortField);
  const clashSortDir = useViewerStore((s) => s.clashSortDir);
  const clashSelectedIndex = useViewerStore((s) => s.clashSelectedIndex);
  const clashMode = useViewerStore((s) => s.clashMode);
  const clashTolerance = useViewerStore((s) => s.clashTolerance);
  const clashClearance = useViewerStore((s) => s.clashClearance);

  const setClashFilterMode = useViewerStore((s) => s.setClashFilterMode);
  const setClashFilterValue = useViewerStore((s) => s.setClashFilterValue);
  const setClashSearchQuery = useViewerStore((s) => s.setClashSearchQuery);
  const setClashSortField = useViewerStore((s) => s.setClashSortField);
  const setClashSortDir = useViewerStore((s) => s.setClashSortDir);
  const setClashSelectedIndex = useViewerStore((s) => s.setClashSelectedIndex);
  const setClashMode = useViewerStore((s) => s.setClashMode);
  const setClashTolerance = useViewerStore((s) => s.setClashTolerance);
  const setClashClearance = useViewerStore((s) => s.setClashClearance);
  const clearClash = useViewerStore((s) => s.clearClash);

  // Build filter options
  const clashSetOptions = useMemo(() => {
    if (!clashResult) return [];
    return Object.keys(clashResult.summary.byClashSet);
  }, [clashResult]);

  const typePairOptions = useMemo(() => {
    if (!clashResult) return [];
    return Object.entries(clashResult.summary.byTypePair)
      .sort(([, a], [, b]) => b - a)
      .map(([pair]) => pair);
  }, [clashResult]);

  // Filter
  const filteredClashes = useMemo(() => {
    if (!clashResult) return [];
    let clashes = clashResult.clashes;

    if (clashFilterMode === 'byClashSet' && clashFilterValue) {
      clashes = clashes.filter(c => c.clashSet === clashFilterValue);
    } else if (clashFilterMode === 'byTypePair' && clashFilterValue) {
      clashes = clashes.filter(c => {
        const pair = [c.a.type, c.b.type].sort().join(' vs ');
        return pair === clashFilterValue;
      });
    }

    if (clashSearchQuery) {
      const q = clashSearchQuery.toLowerCase();
      clashes = clashes.filter(c =>
        c.a.type.toLowerCase().includes(q) ||
        c.b.type.toLowerCase().includes(q) ||
        c.a.name.toLowerCase().includes(q) ||
        c.b.name.toLowerCase().includes(q) ||
        c.a.globalId.toLowerCase().includes(q) ||
        c.b.globalId.toLowerCase().includes(q)
      );
    }

    return clashes;
  }, [clashResult, clashFilterMode, clashFilterValue, clashSearchQuery]);

  // Sort
  const sortedClashes = useMemo(() => {
    const sorted = [...filteredClashes];
    const dir = clashSortDir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (clashSortField) {
        case 'distance': return (a.distance - b.distance) * dir;
        case 'typeA': return a.a.type.localeCompare(b.a.type) * dir;
        case 'typeB': return a.b.type.localeCompare(b.b.type) * dir;
        case 'nameA': return a.a.name.localeCompare(b.a.name) * dir;
        case 'nameB': return a.b.name.localeCompare(b.b.name) * dir;
        default: return 0;
      }
    });
    return sorted;
  }, [filteredClashes, clashSortField, clashSortDir]);

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: sortedClashes.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
    overscan: 15,
  });

  // Handlers
  const handleClashClick = useCallback((clash: Clash, index: number) => {
    setClashSelectedIndex(index);
    selectClashElement(clash.a.file, clash.a.expressId);
  }, [setClashSelectedIndex, selectClashElement]);

  const handleSort = useCallback((field: ClashSortField) => {
    if (clashSortField === field) {
      setClashSortDir(clashSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setClashSortField(field);
      setClashSortDir('asc');
    }
  }, [clashSortField, clashSortDir, setClashSortField, setClashSortDir]);

  const handleApplyColors = useCallback(() => {
    applyClashColorsHook();
  }, [applyClashColorsHook]);

  const handleExportJSON = useCallback(() => {
    if (!clashResult) return;
    const json = JSON.stringify(clashResult, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clash-result.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [clashResult]);

  // Available IFC types for pickers
  const availableTypes = useMemo(() => getAvailableTypes(), [getAvailableTypes]);
  const hasModel = availableTypes.length > 0;

  const handleRunClash = useCallback(() => {
    const typesA = typeA ? typeA.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    const typesB = typeB ? typeB.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    runSelfClash(typesA, typesB);
  }, [typeA, typeB, runSelfClash]);

  // ── Empty state ──
  if (!clashResult && !clashLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <PanelHeader onClose={onClose} onSettings={() => setSettingsOpen(!settingsOpen)} />

        {/* Settings (always available in empty state) */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
          <CollapsibleContent>
            <div className="p-3 border-b bg-muted/20 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-20 text-muted-foreground">Mode:</span>
                <Select value={clashMode} onValueChange={(v) => setClashMode(v as any)}>
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="collision">Collision</SelectItem>
                    <SelectItem value="clearance">Clearance</SelectItem>
                    <SelectItem value="intersection">Intersection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 text-muted-foreground">Tolerance:</span>
                <Input
                  type="number" step="0.001" value={clashTolerance}
                  onChange={e => setClashTolerance(parseFloat(e.target.value) || 0)}
                  className="h-7 flex-1 text-xs"
                />
                <span className="text-muted-foreground">m</span>
              </div>
              {clashMode === 'clearance' && (
                <div className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">Clearance:</span>
                  <Input
                    type="number" step="0.01" value={clashClearance}
                    onChange={e => setClashClearance(parseFloat(e.target.value) || 0)}
                    className="h-7 flex-1 text-xs"
                  />
                  <span className="text-muted-foreground">m</span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
          <Zap className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-medium text-sm mb-2">Clash Detection</h3>
          {!hasModel ? (
            <p className="text-xs text-muted-foreground mb-4">Load an IFC model to run clash detection.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-4">
                Select element types to check for collisions, clearance violations, or intersections.
              </p>
              <div className="w-full max-w-xs space-y-2 mb-4">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted-foreground text-right">Group A:</span>
                  <Input
                    placeholder="e.g. IfcBeam (or leave empty for all)"
                    value={typeA}
                    onChange={e => setTypeA(e.target.value)}
                    className="h-7 text-xs flex-1"
                    list="clash-types-a"
                  />
                  <datalist id="clash-types-a">
                    {availableTypes.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted-foreground text-right">Group B:</span>
                  <Input
                    placeholder="e.g. IfcPipeSegment (optional)"
                    value={typeB}
                    onChange={e => setTypeB(e.target.value)}
                    className="h-7 text-xs flex-1"
                    list="clash-types-b"
                  />
                  <datalist id="clash-types-b">
                    {availableTypes.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              </div>
              <Button onClick={handleRunClash}>
                <Zap className="h-4 w-4 mr-2" />
                Run Clash Detection
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (clashLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <PanelHeader onClose={onClose} />
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <span className="text-sm text-muted-foreground">Running clash detection...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <PanelHeader
        onClose={onClose}
        onClear={clearClash}
        onSettings={() => setSettingsOpen(!settingsOpen)}
        hasResult={!!clashResult}
      />

      {/* Error */}
      {clashError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{clashError}</span>
          </div>
        </div>
      )}

      {/* Settings Collapsible */}
      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
        <CollapsibleContent>
          <div className="p-3 border-b bg-muted/20 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-20 text-muted-foreground">Mode:</span>
              <Select value={clashMode} onValueChange={(v) => setClashMode(v as any)}>
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collision">Collision</SelectItem>
                  <SelectItem value="clearance">Clearance</SelectItem>
                  <SelectItem value="intersection">Intersection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-muted-foreground">Tolerance:</span>
              <Input
                type="number"
                step="0.001"
                value={clashTolerance}
                onChange={e => setClashTolerance(parseFloat(e.target.value) || 0)}
                className="h-7 flex-1 text-xs"
              />
              <span className="text-muted-foreground">m</span>
            </div>
            {clashMode === 'clearance' && (
              <div className="flex items-center gap-2">
                <span className="w-20 text-muted-foreground">Clearance:</span>
                <Input
                  type="number"
                  step="0.01"
                  value={clashClearance}
                  onChange={e => setClashClearance(parseFloat(e.target.value) || 0)}
                  className="h-7 flex-1 text-xs"
                />
                <span className="text-muted-foreground">m</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Summary */}
      {clashResult && (
        <div className="p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 mb-2 text-sm">
            <Zap className="h-4 w-4" />
            <span className="font-medium">
              {clashResult.summary.totalClashes} Clash{clashResult.summary.totalClashes !== 1 ? 'es' : ''} Detected
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Badge variant="outline" className="text-xs">{clashResult.settings.mode}</Badge>
            <span>tolerance: {clashResult.settings.tolerance}m</span>
            {clashResult.settings.mode === 'clearance' && (
              <span>clearance: {clashResult.settings.clearance}m</span>
            )}
          </div>

          {/* Type pair breakdown */}
          {Object.keys(clashResult.summary.byTypePair).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(clashResult.summary.byTypePair)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([pair, count]) => (
                  <Badge key={pair} variant="secondary" className="text-xs cursor-pointer hover:bg-accent"
                    onClick={() => {
                      setClashFilterMode('byTypePair');
                      setClashFilterValue(pair);
                    }}
                  >
                    {pair}: {count}
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Filter & Actions Bar */}
      <div className="p-2 border-b flex items-center gap-1.5 flex-wrap">
        <Select
          value={clashFilterMode === 'all' ? 'all' : `${clashFilterMode}:${clashFilterValue ?? ''}`}
          onValueChange={(v) => {
            if (v === 'all') {
              setClashFilterMode('all');
              setClashFilterValue(null);
            } else {
              const [mode, ...rest] = v.split(':');
              setClashFilterMode(mode as ClashFilterMode);
              setClashFilterValue(rest.join(':'));
            }
          }}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {clashSetOptions.length > 1 && clashSetOptions.map(name => (
              <SelectItem key={`cs:${name}`} value={`byClashSet:${name}`}>
                Set: {name.slice(0, 20)}
              </SelectItem>
            ))}
            {typePairOptions.map(pair => (
              <SelectItem key={`tp:${pair}`} value={`byTypePair:${pair}`}>
                {pair}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              placeholder="Filter..."
              value={clashSearchQuery}
              onChange={e => setClashSearchQuery(e.target.value)}
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
        </div>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {sortedClashes.length}{sortedClashes.length !== (clashResult?.clashes.length ?? 0) ? ` / ${clashResult?.clashes.length}` : ''}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={handleApplyColors}>
              <div className="h-3 w-3 rounded-full" style={{ background: 'linear-gradient(135deg, #e74c3c 50%, #e67e22 100%)' }} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Apply clash colors to 3D view</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={isolateClashing}>
              <Focus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Isolate clashing elements</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={handleExportJSON}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export JSON</TooltipContent>
        </Tooltip>
      </div>

      {/* Sort header */}
      <div className="flex items-center border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        <div className="w-8 shrink-0 px-2 py-1.5 text-center">#</div>
        <SortHeader label="Element A" field="typeA" flex currentField={clashSortField} currentDir={clashSortDir} onSort={handleSort} />
        <SortHeader label="Element B" field="typeB" flex currentField={clashSortField} currentDir={clashSortDir} onSort={handleSort} />
        <SortHeader label="Distance" field="distance" width={90} currentField={clashSortField} currentDir={clashSortDir} onSort={handleSort} />
      </div>

      {/* Virtualized results */}
      <div ref={listRef} className="flex-1 overflow-auto min-h-0">
        {sortedClashes.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {clashResult?.clashes.length === 0
              ? 'No clashes detected.'
              : 'No clashes match the current filter.'}
          </div>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => {
              const clash = sortedClashes[virtualRow.index];
              const isSelected = clashSelectedIndex === virtualRow.index;

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'absolute top-0 left-0 w-full border-b border-border/30 cursor-pointer hover:bg-muted/40 transition-colors',
                    isSelected && 'bg-primary/10 border-primary/30',
                  )}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={() => handleClashClick(clash, virtualRow.index)}
                >
                  <div className="flex items-center px-2 py-1.5">
                    <div className="w-8 shrink-0 text-xs text-muted-foreground text-center">
                      {virtualRow.index + 1}
                    </div>
                    <div className="flex-1 min-w-0 px-1">
                      <div className="text-xs truncate">
                        <span className="font-medium" style={{ color: 'rgb(230, 76, 60)' }}>{clash.a.type}</span>
                        {' '}
                        <span className="text-muted-foreground">{clash.a.name || clash.a.globalId.slice(0, 8)}</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 px-1">
                      <div className="text-xs truncate">
                        <span className="font-medium" style={{ color: 'rgb(230, 126, 34)' }}>{clash.b.type}</span>
                        {' '}
                        <span className="text-muted-foreground">{clash.b.name || clash.b.globalId.slice(0, 8)}</span>
                      </div>
                    </div>
                    <div className="w-[90px] shrink-0 flex justify-end">
                      <DistanceBadge distance={clash.distance} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Panel Header
// ============================================================================

function PanelHeader({ onClose, onClear, onSettings, hasResult }: {
  onClose?: () => void;
  onClear?: () => void;
  onSettings?: () => void;
  hasResult?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 border-b">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4" />
        <span className="font-medium text-sm">Clash Detection</span>
      </div>
      <div className="flex items-center gap-1">
        {onSettings && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onSettings}>
                <Settings2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        )}
        {hasResult && onClear && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClear}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear Results</TooltipContent>
          </Tooltip>
        )}
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sort Header
// ============================================================================

function SortHeader({ label, field, width, flex, currentField, currentDir, onSort }: {
  label: string;
  field: ClashSortField;
  width?: number;
  flex?: boolean;
  currentField: ClashSortField;
  currentDir: string;
  onSort: (field: ClashSortField) => void;
}) {
  const isActive = currentField === field;
  return (
    <button
      className={cn(
        'flex items-center gap-0.5 px-2 py-1.5 hover:text-foreground transition-colors',
        flex ? 'flex-1 min-w-0' : 'shrink-0',
        isActive && 'text-foreground',
      )}
      style={width ? { width } : undefined}
      onClick={() => onSort(field)}
    >
      <span className="truncate">{label}</span>
      {isActive && (
        currentDir === 'asc'
          ? <ArrowUp className="h-3 w-3 shrink-0" />
          : <ArrowDown className="h-3 w-3 shrink-0" />
      )}
    </button>
  );
}

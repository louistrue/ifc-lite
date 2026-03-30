/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DiffPanel - Interactive IFC model comparison panel
 *
 * Features:
 * - Load a second IFC file to compare against the active model
 * - View added/deleted/changed elements with color coding
 * - Sort and filter results by type, name, change category
 * - Click any row to select + frame the element in the 3D viewer
 * - Auto-colorize: green=added, orange=changed, red ghosted=deleted
 * - Export diff results as JSON
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  X, Upload, Play, Search, Download,
  ArrowUp, ArrowDown, ChevronDown, ChevronRight,
  Plus, Minus, Pencil, Filter,
  Focus, Loader2, FileText, AlertCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useViewerStore } from '@/store';
import type { DiffFilterMode, DiffSortField } from '@/store/slices/diffSlice';
import { toGlobalIdFromModels } from '@/store/globalId';
import { DIFF_COLORS } from '@ifc-lite/diff';
import type { DiffResult, EntityChange } from '@ifc-lite/diff';
import { cn } from '@/lib/utils';

interface DiffPanelProps {
  onClose?: () => void;
}

/**
 * Unified row type for the results list.
 *
 * Federation-aware: carries both expressId (for property lookup) and modelId
 * (to resolve the correct renderer globalId via toGlobalIdFromModels).
 *
 * - added: exists only in new model (modelId = diffNewModelId)
 * - deleted: exists only in old model (modelId = diffOldModelId)
 * - changed: exists in both; expressId1 is old, expressId2 is new
 */
interface DiffRow {
  ifcGlobalId: string;
  /** expressId in the model this row targets for selection */
  expressId: number;
  /** expressId in old model (for deleted/changed rows) */
  expressId1?: number;
  /** expressId in new model (for added/changed rows) */
  expressId2?: number;
  /** Which loaded model this row belongs to for selection */
  modelId: string;
  type: string;
  name: string;
  category: 'added' | 'deleted' | 'changed';
  change?: EntityChange;
}

function CategoryIcon({ category }: { category: DiffRow['category'] }) {
  switch (category) {
    case 'added':
      return <Plus className="h-3.5 w-3.5 text-green-500" />;
    case 'deleted':
      return <Minus className="h-3.5 w-3.5 text-red-500" />;
    case 'changed':
      return <Pencil className="h-3.5 w-3.5 text-orange-500" />;
  }
}

function CategoryBadge({ category }: { category: DiffRow['category'] }) {
  const variants: Record<string, 'default' | 'destructive' | 'secondary'> = {
    added: 'default',
    deleted: 'destructive',
    changed: 'secondary',
  };
  return (
    <Badge variant={variants[category]} className="text-xs capitalize">
      {category}
    </Badge>
  );
}

// ============================================================================
// Change Detail Row
// ============================================================================

function ChangeDetailSection({ change }: { change: EntityChange }) {
  const [expanded, setExpanded] = useState(false);

  const totalChanges =
    change.attributeChanges.length +
    change.propertyChanges.length +
    change.quantityChanges.length;

  if (totalChanges === 0) return null;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-6 mt-0.5">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {totalChanges} change{totalChanges !== 1 ? 's' : ''}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-8 mt-1 space-y-0.5 text-xs">
          {change.attributeChanges.map((ac, i) => (
            <div key={`a-${i}`} className="flex gap-2 text-muted-foreground">
              <span className="font-medium text-foreground">{ac.attribute}:</span>
              <span className="text-red-500 line-through">{ac.oldValue || '(empty)'}</span>
              <span className="text-green-600">{ac.newValue || '(empty)'}</span>
            </div>
          ))}
          {change.propertyChanges.map((pc, i) => (
            <div key={`p-${i}`} className="flex gap-2 text-muted-foreground">
              <span className="font-medium text-foreground">{pc.psetName}.{pc.propName}:</span>
              <span className="text-red-500 line-through">{String(pc.oldValue ?? '(none)')}</span>
              <span className="text-green-600">{String(pc.newValue ?? '(none)')}</span>
            </div>
          ))}
          {change.quantityChanges.map((qc, i) => (
            <div key={`q-${i}`} className="flex gap-2 text-muted-foreground">
              <span className="font-medium text-foreground">{qc.qsetName}.{qc.quantityName}:</span>
              <span className="text-red-500">{qc.oldValue}</span>
              <span className="text-green-600">{qc.newValue}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

export function DiffPanel({ onClose }: DiffPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Store state
  const diffResult = useViewerStore((s) => s.diffResult);
  const diffLoading = useViewerStore((s) => s.diffLoading);
  const diffError = useViewerStore((s) => s.diffError);
  const diffFilterMode = useViewerStore((s) => s.diffFilterMode);
  const diffSearchQuery = useViewerStore((s) => s.diffSearchQuery);
  const diffSortField = useViewerStore((s) => s.diffSortField);
  const diffSortDir = useViewerStore((s) => s.diffSortDir);
  const diffSelectedGlobalId = useViewerStore((s) => s.diffSelectedGlobalId);
  const diffFile1Name = useViewerStore((s) => s.diffFile1Name);
  const diffFile2Name = useViewerStore((s) => s.diffFile2Name);

  const setDiffFilterMode = useViewerStore((s) => s.setDiffFilterMode);
  const setDiffSearchQuery = useViewerStore((s) => s.setDiffSearchQuery);
  const setDiffSortField = useViewerStore((s) => s.setDiffSortField);
  const setDiffSortDir = useViewerStore((s) => s.setDiffSortDir);
  const setDiffSelectedGlobalId = useViewerStore((s) => s.setDiffSelectedGlobalId);
  const clearDiff = useViewerStore((s) => s.clearDiff);
  const diffOldModelId = useViewerStore((s) => s.diffOldModelId);
  const diffNewModelId = useViewerStore((s) => s.diffNewModelId);

  // Viewer interaction (federation-aware)
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const setPendingColorUpdates = useViewerStore((s) => s.setPendingColorUpdates);
  const models = useViewerStore((s) => s.models);

  // Resolve which model IDs to use (fallback to 'legacy' for single-model)
  const oldModelId = diffOldModelId ?? 'legacy';
  const newModelId = diffNewModelId ?? 'legacy';

  // Build unified row list with federation context
  const allRows = useMemo((): DiffRow[] => {
    if (!diffResult) return [];
    const rows: DiffRow[] = [];
    for (const e of diffResult.added) {
      rows.push({
        ifcGlobalId: e.globalId, expressId: e.expressId, expressId2: e.expressId,
        modelId: newModelId, type: e.type, name: e.name, category: 'added',
      });
    }
    for (const e of diffResult.deleted) {
      rows.push({
        ifcGlobalId: e.globalId, expressId: e.expressId, expressId1: e.expressId,
        modelId: oldModelId, type: e.type, name: e.name, category: 'deleted',
      });
    }
    for (const e of diffResult.changed) {
      // Changed elements: select in new model for viewing, but carry both IDs
      rows.push({
        ifcGlobalId: e.globalId, expressId: e.expressId2,
        expressId1: e.expressId1, expressId2: e.expressId2,
        modelId: newModelId, type: e.type, name: e.name, category: 'changed', change: e,
      });
    }
    return rows;
  }, [diffResult, oldModelId, newModelId]);

  // Filter
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (diffFilterMode !== 'all') {
      rows = rows.filter(r => r.category === diffFilterMode);
    }
    if (diffSearchQuery) {
      const q = diffSearchQuery.toLowerCase();
      rows = rows.filter(r =>
        r.type.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.ifcGlobalId.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allRows, diffFilterMode, diffSearchQuery]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    const dir = diffSortDir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (diffSortField) {
        case 'type': return a.type.localeCompare(b.type) * dir;
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'globalId': return a.ifcGlobalId.localeCompare(b.ifcGlobalId) * dir;
        case 'changes': {
          const ca = a.change
            ? a.change.attributeChanges.length + a.change.propertyChanges.length + a.change.quantityChanges.length
            : a.category === 'added' ? -1 : -2;
          const cb = b.change
            ? b.change.attributeChanges.length + b.change.propertyChanges.length + b.change.quantityChanges.length
            : b.category === 'added' ? -1 : -2;
          return (ca - cb) * dir;
        }
        default: return 0;
      }
    });
    return sorted;
  }, [filteredRows, diffSortField, diffSortDir]);

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    overscan: 15,
  });

  // Handlers
  const handleRowClick = useCallback((row: DiffRow) => {
    setDiffSelectedGlobalId(row.ifcGlobalId);
    // Federation-aware selection: convert to renderer globalId
    const rendererGlobalId = toGlobalIdFromModels(models, row.modelId, row.expressId);
    setSelectedEntityId(rendererGlobalId);
    setSelectedEntity({ modelId: row.modelId, expressId: row.expressId });
    // Frame the element
    requestAnimationFrame(() => {
      cameraCallbacks.frameSelection?.();
    });
  }, [setDiffSelectedGlobalId, setSelectedEntityId, setSelectedEntity, cameraCallbacks, models]);

  const handleSort = useCallback((field: DiffSortField) => {
    if (diffSortField === field) {
      setDiffSortDir(diffSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setDiffSortField(field);
      setDiffSortDir('asc');
    }
  }, [diffSortField, diffSortDir, setDiffSortField, setDiffSortDir]);

  const handleApplyColors = useCallback(() => {
    if (!diffResult) return;
    // Map keyed by renderer globalId (expressId + model idOffset)
    const colorMap = new Map<number, [number, number, number, number]>();
    for (const e of diffResult.added) {
      const gid = toGlobalIdFromModels(models, newModelId, e.expressId);
      colorMap.set(gid, DIFF_COLORS.added as [number, number, number, number]);
    }
    for (const e of diffResult.deleted) {
      const gid = toGlobalIdFromModels(models, oldModelId, e.expressId);
      colorMap.set(gid, DIFF_COLORS.deleted as [number, number, number, number]);
    }
    for (const e of diffResult.changed) {
      const gid = toGlobalIdFromModels(models, newModelId, e.expressId2);
      colorMap.set(gid, DIFF_COLORS.changed as [number, number, number, number]);
    }
    setPendingColorUpdates(colorMap);
  }, [diffResult, setPendingColorUpdates, models, oldModelId, newModelId]);

  const handleExportJSON = useCallback(() => {
    if (!diffResult) return;
    const json = JSON.stringify(diffResult, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diff-result.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [diffResult]);

  // ── Empty state ──
  if (!diffResult && !diffLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <PanelHeader onClose={onClose} />
        <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-medium text-sm mb-2">No Diff Loaded</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Load a second IFC file to compare against the active model.
            Differences in attributes, properties, and quantities will be detected.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Use <code className="bg-muted px-1 rounded">ifc-lite diff</code> from the CLI
            or load a comparison file via the toolbar.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (diffLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <PanelHeader onClose={onClose} />
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <span className="text-sm text-muted-foreground">Computing diff...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <PanelHeader
        onClose={onClose}
        onClear={clearDiff}
        hasResult={!!diffResult}
      />

      {/* Error */}
      {diffError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{diffError}</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {diffResult && (
        <div className="p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-medium">Model Comparison</span>
          </div>
          {diffFile1Name && diffFile2Name && (
            <div className="text-xs text-muted-foreground mb-2">
              {diffFile1Name} vs {diffFile2Name}
            </div>
          )}
          <div className="grid grid-cols-4 gap-2 text-xs text-center">
            <div className="bg-background rounded p-2">
              <div className="font-medium text-green-600">{diffResult.summary.totalAdded}</div>
              <div className="text-muted-foreground">Added</div>
            </div>
            <div className="bg-background rounded p-2">
              <div className="font-medium text-red-600">{diffResult.summary.totalDeleted}</div>
              <div className="text-muted-foreground">Deleted</div>
            </div>
            <div className="bg-background rounded p-2">
              <div className="font-medium text-orange-600">{diffResult.summary.totalChanged}</div>
              <div className="text-muted-foreground">Changed</div>
            </div>
            <div className="bg-background rounded p-2">
              <div className="font-medium">{diffResult.summary.totalUnchanged}</div>
              <div className="text-muted-foreground">Same</div>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Actions Bar */}
      <div className="p-2 border-b flex items-center gap-1.5 flex-wrap">
        <Select value={diffFilterMode} onValueChange={(v) => setDiffFilterMode(v as DiffFilterMode)}>
          <SelectTrigger className="h-7 w-24 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="added">Added</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
            <SelectItem value="changed">Changed</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              placeholder="Filter..."
              value={diffSearchQuery}
              onChange={e => setDiffSearchQuery(e.target.value)}
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
        </div>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {sortedRows.length}{sortedRows.length !== allRows.length ? ` / ${allRows.length}` : ''}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={handleApplyColors}>
              <div className="h-3 w-3 rounded-full" style={{ background: 'linear-gradient(135deg, #2ecc71 33%, #e67e22 66%, #e74c3c 100%)' }} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Apply diff colors to 3D view</TooltipContent>
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
        <SortHeader label="" field="changes" width={28} currentField={diffSortField} currentDir={diffSortDir} onSort={handleSort} />
        <SortHeader label="Type" field="type" width={120} currentField={diffSortField} currentDir={diffSortDir} onSort={handleSort} />
        <SortHeader label="Name" field="name" flex currentField={diffSortField} currentDir={diffSortDir} onSort={handleSort} />
        <SortHeader label="GlobalId" field="globalId" width={90} currentField={diffSortField} currentDir={diffSortDir} onSort={handleSort} />
      </div>

      {/* Virtualized results */}
      <div ref={listRef} className="flex-1 overflow-auto min-h-0">
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map(virtualRow => {
            const row = sortedRows[virtualRow.index];
            const isSelected = row.ifcGlobalId === diffSelectedGlobalId;

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
                onClick={() => handleRowClick(row)}
              >
                <div className="flex items-center px-2 py-1.5">
                  <div className="w-7 shrink-0 flex justify-center">
                    <CategoryIcon category={row.category} />
                  </div>
                  <div className="w-[120px] shrink-0 text-xs truncate">{row.type}</div>
                  <div className="flex-1 min-w-0 text-xs truncate">{row.name || '(unnamed)'}</div>
                  <div className="w-[90px] shrink-0 text-xs text-muted-foreground truncate font-mono">
                    {row.ifcGlobalId.slice(0, 8)}...
                  </div>
                </div>
                {row.change && <ChangeDetailSection change={row.change} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Panel Header
// ============================================================================

function PanelHeader({ onClose, onClear, hasResult }: {
  onClose?: () => void;
  onClear?: () => void;
  hasResult?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 border-b">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        <span className="font-medium text-sm">Diff</span>
      </div>
      <div className="flex items-center gap-1">
        {hasResult && onClear && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClear}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear Diff</TooltipContent>
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
  field: DiffSortField;
  width?: number;
  flex?: boolean;
  currentField: DiffSortField;
  currentDir: string;
  onSort: (field: DiffSortField) => void;
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

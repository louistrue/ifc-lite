/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ListResultsTable - Virtualized table displaying list execution results
 *
 * PERF: Uses @tanstack/react-virtual for efficient rendering of large result sets.
 * Only renders visible rows, supports 100K+ rows smoothly.
 * Clicking a row selects the entity in the 3D viewer.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useViewerStore } from '@/store';
import type { ListResult, ListRow, CellValue } from '@ifc-lite/lists';
import { cn } from '@/lib/utils';

interface ListResultsTableProps {
  result: ListResult;
}

export function ListResultsTable({ result }: ListResultsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);

  // Filter rows by search query
  const filteredRows = useMemo(() => {
    if (!searchQuery) return result.rows;
    const q = searchQuery.toLowerCase();
    return result.rows.filter(row =>
      row.values.some(v => v !== null && String(v).toLowerCase().includes(q))
    );
  }, [result.rows, searchQuery]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      const va = a.values[sortCol];
      const vb = b.values[sortCol];
      return compareCells(va, vb) * (sortDir === 'asc' ? 1 : -1);
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleHeaderClick = useCallback((colIndex: number) => {
    if (sortCol === colIndex) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colIndex);
      setSortDir('asc');
    }
  }, [sortCol]);

  const handleRowClick = useCallback((row: ListRow) => {
    setSelectedEntity({ modelId: row.modelId, expressId: row.entityId });
    // For single-model, selectedEntityId is the expressId
    // For multi-model, we'd need the global ID, but we set expressId for now
    setSelectedEntityId(row.entityId);
  }, [setSelectedEntity, setSelectedEntityId]);

  // Column widths
  const columnWidths = useMemo(() => {
    return result.columns.map(col => {
      const label = col.label ?? col.propertyName;
      // Estimate width: min 80px, max 250px, based on header + content
      return Math.max(80, Math.min(250, label.length * 8 + 40));
    });
  }, [result.columns]);

  const totalWidth = useMemo(() => columnWidths.reduce((a, b) => a + b, 0), [columnWidths]);

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter results..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {sortedRows.length}{searchQuery ? ` / ${result.rows.length}` : ''} rows
        </span>
      </div>

      {/* Table */}
      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 bg-muted/80 backdrop-blur-sm border-b z-10">
            {result.columns.map((col, colIdx) => (
              <button
                key={col.id}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border-r border-border/50 shrink-0"
                style={{ width: columnWidths[colIdx] }}
                onClick={() => handleHeaderClick(colIdx)}
              >
                <span className="truncate">
                  {col.label ?? col.propertyName}
                </span>
                {sortCol === colIdx && (
                  sortDir === 'asc'
                    ? <ArrowUp className="h-3 w-3 shrink-0" />
                    : <ArrowDown className="h-3 w-3 shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Virtualized rows */}
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => {
              const row = sortedRows[virtualRow.index];
              const isSelected = row.entityId === selectedEntityId;

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'flex absolute top-0 left-0 w-full border-b border-border/30 cursor-pointer hover:bg-muted/40',
                    isSelected && 'bg-primary/10'
                  )}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => handleRowClick(row)}
                >
                  {row.values.map((value, colIdx) => (
                    <div
                      key={colIdx}
                      className="px-2 py-1 text-xs truncate border-r border-border/20 shrink-0"
                      style={{ width: columnWidths[colIdx] }}
                      title={value !== null ? String(value) : ''}
                    >
                      {formatCellValue(value)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Format numbers: integers as-is, decimals with up to 4 decimal places
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4).replace(/\.?0+$/, '');
  }
  return String(value);
}

function compareCells(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

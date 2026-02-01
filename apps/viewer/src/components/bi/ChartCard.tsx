/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chart card component - wraps a chart with title, actions, and edit controls
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { X, Settings, GripVertical, Filter, FilterX } from 'lucide-react';
import type { ChartConfig, AggregatedDataPoint, ChartInteractionEvent } from '@ifc-lite/bi';
import { ChartRenderer } from './ChartRenderer.js';
import { Button } from '../ui/button.js';

/** Container dimensions for responsive chart sizing */
export interface ChartDimensions {
  width: number;
  height: number;
}

interface ChartCardProps {
  config: ChartConfig;
  data: AggregatedDataPoint[];
  selectedKeys: Set<string>;
  highlightedKeys: Set<string>;
  onInteraction: (event: ChartInteractionEvent) => void;
  onRemove: (chartId: string) => void;
  onEdit: (chartId: string) => void;
  onClearFilter: (chartId: string) => void;
  isEditMode: boolean;
  hasFilter: boolean;
}

export function ChartCard({
  config,
  data,
  selectedKeys,
  highlightedKeys,
  onInteraction,
  onRemove,
  onEdit,
  onClearFilter,
  isEditMode,
  hasFilter,
}: ChartCardProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<ChartDimensions>({ width: 300, height: 200 });

  // Track container size with ResizeObserver
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        // Only update if dimensions actually changed to avoid unnecessary re-renders
        setDimensions((prev) => {
          if (Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1) {
            return { width, height };
          }
          return prev;
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const handleRemove = useCallback(() => {
    onRemove(config.id);
  }, [config.id, onRemove]);

  const handleEdit = useCallback(() => {
    onEdit(config.id);
  }, [config.id, onEdit]);

  const handleClearFilter = useCallback(() => {
    onClearFilter(config.id);
  }, [config.id, onClearFilter]);

  return (
    <div className="h-full w-full bg-background border rounded-lg shadow-sm flex flex-col relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isEditMode && (
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-move shrink-0" />
          )}
          <h3 className="text-sm font-medium truncate">{config.title}</h3>
          {hasFilter && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs shrink-0">
              <Filter className="h-3 w-3" />
              Filtered
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasFilter && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleClearFilter}
              title="Clear filter"
            >
              <FilterX className="h-3.5 w-3.5" />
            </Button>
          )}
          {isEditMode && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleEdit}
                title="Configure chart"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleRemove}
                title="Remove chart"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} className="flex-1 p-2 min-h-0 overflow-hidden">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No data available
          </div>
        ) : (
          <ChartRenderer
            config={config}
            data={data}
            selectedKeys={selectedKeys}
            highlightedKeys={highlightedKeys}
            onInteraction={onInteraction}
            dimensions={dimensions}
          />
        )}
      </div>

      {/* Resize indicator in edit mode */}
      {isEditMode && (
        <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-50 hover:opacity-100 transition-opacity">
          <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground">
            <path d="M14 14H10M14 14V10M14 14L10 10M14 10V6M14 10L10 6M10 14H6M10 14L6 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default ChartCard;

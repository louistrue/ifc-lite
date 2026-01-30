/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chart card component - wraps a chart with title, actions, and edit controls
 */

import React, { useCallback } from 'react';
import { X, Settings, GripVertical, Filter, FilterX } from 'lucide-react';
import type { ChartConfig, AggregatedDataPoint, ChartInteractionEvent } from '@ifc-lite/bi';
import { ChartRenderer } from './ChartRenderer.js';
import { Button } from '../ui/button.js';

interface ChartCardProps {
  config: ChartConfig;
  data: AggregatedDataPoint[];
  selectedKeys: Set<string>;
  highlightedKeys: Set<string>;
  onInteraction: (event: ChartInteractionEvent) => void;
  onRemove: (chartId: string) => void;
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
  onClearFilter,
  isEditMode,
  hasFilter,
}: ChartCardProps) {
  const handleRemove = useCallback(() => {
    onRemove(config.id);
  }, [config.id, onRemove]);

  const handleClearFilter = useCallback(() => {
    onClearFilter(config.id);
  }, [config.id, onClearFilter]);

  return (
    <div className="h-full w-full bg-background border rounded-lg shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          {isEditMode && (
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
          )}
          <h3 className="text-sm font-medium truncate">{config.title}</h3>
          {hasFilter && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs">
              <Filter className="h-3 w-3" />
              Filtered
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
      <div className="flex-1 p-2 min-h-0">
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
          />
        )}
      </div>
    </div>
  );
}

export default ChartCard;

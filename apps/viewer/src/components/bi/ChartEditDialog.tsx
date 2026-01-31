/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chart Edit Dialog - allows editing chart configuration
 */

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import type { ChartConfig, ChartType, GroupByDimension, QuantityField, AggregateMetric } from '@ifc-lite/bi';
import { Button } from '../ui/button.js';

interface ChartEditDialogProps {
  config: ChartConfig;
  onSave: (updates: Partial<ChartConfig>) => void;
  onClose: () => void;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'pie', label: 'Pie Chart' },
  { value: 'donut', label: 'Donut Chart' },
  { value: 'bar', label: 'Bar Chart (Vertical)' },
  { value: 'barHorizontal', label: 'Bar Chart (Horizontal)' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'sunburst', label: 'Sunburst' },
];

const GROUP_BY_OPTIONS: { value: GroupByDimension; label: string }[] = [
  { value: 'ifcType', label: 'IFC Type' },
  { value: 'storey', label: 'Building Storey' },
  { value: 'building', label: 'Building' },
  { value: 'material', label: 'Material' },
  { value: 'classification', label: 'Classification' },
];

const METRIC_OPTIONS: { value: AggregateMetric; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
];

const QUANTITY_FIELDS: { value: QuantityField; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'area', label: 'Area' },
  { value: 'volume', label: 'Volume' },
  { value: 'length', label: 'Length' },
  { value: 'weight', label: 'Weight' },
];

const COLOR_SCHEMES = [
  { value: 'default', label: 'Default' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'categorical', label: 'Categorical' },
];

export function ChartEditDialog({ config, onSave, onClose }: ChartEditDialogProps) {
  const [title, setTitle] = useState(config.title);
  const [chartType, setChartType] = useState<ChartType>(config.type);
  const [groupBy, setGroupBy] = useState<GroupByDimension>(config.aggregation.groupBy);
  const [metric, setMetric] = useState<AggregateMetric>(config.aggregation.metric);
  const [quantityField, setQuantityField] = useState<QuantityField>(config.aggregation.quantityField ?? 'count');
  const [colorScheme, setColorScheme] = useState<'default' | 'warm' | 'cool' | 'categorical'>(
    config.options?.colorScheme ?? 'default'
  );
  const [showLegend, setShowLegend] = useState(config.options?.showLegend ?? true);

  const handleSave = useCallback(() => {
    onSave({
      title,
      type: chartType,
      aggregation: {
        ...config.aggregation,
        groupBy,
        metric,
        quantityField: metric !== 'count' ? quantityField : undefined,
      },
      options: {
        ...config.options,
        colorScheme: colorScheme as 'default' | 'warm' | 'cool' | 'categorical',
        showLegend,
      },
    });
    onClose();
  }, [title, chartType, groupBy, metric, quantityField, colorScheme, showLegend, config, onSave, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold">Edit Chart</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1">Chart Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Chart Type */}
          <div>
            <label className="block text-sm font-medium mb-1">Chart Type</label>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartType)}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CHART_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Group By */}
          <div>
            <label className="block text-sm font-medium mb-1">Group By</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupByDimension)}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GROUP_BY_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          {/* Metric */}
          <div>
            <label className="block text-sm font-medium mb-1">Metric</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as AggregateMetric)}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Quantity Field (only for non-count metrics) */}
          {metric !== 'count' && (
            <div>
              <label className="block text-sm font-medium mb-1">Quantity Field</label>
              <select
                value={quantityField}
                onChange={(e) => setQuantityField(e.target.value as QuantityField)}
                className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {QUANTITY_FIELDS.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Color Scheme */}
          <div>
            <label className="block text-sm font-medium mb-1">Color Scheme</label>
            <select
              value={colorScheme}
              onChange={(e) => setColorScheme(e.target.value as 'default' | 'warm' | 'cool' | 'categorical')}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {COLOR_SCHEMES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Show Legend */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showLegend"
              checked={showLegend}
              onChange={(e) => setShowLegend(e.target.checked)}
              className="rounded border-gray-300"
            />
            <label htmlFor="showLegend" className="text-sm">Show Legend</label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ChartEditDialog;

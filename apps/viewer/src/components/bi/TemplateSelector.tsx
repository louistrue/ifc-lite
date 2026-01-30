/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Dashboard template selector for quick-start presets
 */

import React from 'react';
import { Calculator, Building2, Layers, LayoutGrid } from 'lucide-react';
import { DASHBOARD_PRESETS } from '@ifc-lite/bi';
import { useViewerStore } from '../../store/index.js';

// Map icon names to Lucide components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Calculator,
  Building2,
  Layers,
  LayoutGrid,
};

export function TemplateSelector() {
  const loadPreset = useViewerStore((state) => state.loadPreset);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-2">Quick Start</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose a preset dashboard template to get started quickly
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {DASHBOARD_PRESETS.map((preset) => {
          const Icon = iconMap[preset.icon] ?? LayoutGrid;
          return (
            <button
              key={preset.id}
              onClick={() => loadPreset(preset.id)}
              className="flex flex-col items-start gap-3 p-4 border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">{preset.name}</h4>
                <p className="text-sm text-muted-foreground">{preset.description}</p>
              </div>
              <div className="text-xs text-muted-foreground">
                {preset.charts.length} charts
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-4 border-t">
        <p className="text-sm text-muted-foreground">
          Tip: Click on chart segments to select entities in 3D. Use Shift+click to add to
          selection, Alt+click to isolate.
        </p>
      </div>
    </div>
  );
}

export default TemplateSelector;

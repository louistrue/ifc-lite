/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Settings dialog for configuring Cesium 3D overlay options:
 * - Data source selection (OSM Buildings, Bing Aerial, Google Photorealistic)
 * - Terrain toggle
 * - Advanced: custom Cesium ion token override (optional — default is bundled)
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useViewerStore } from '@/store';
import type { CesiumDataSource } from '@/store/slices/cesiumSlice';
import { Settings2 } from 'lucide-react';

const DATA_SOURCE_OPTIONS: { value: CesiumDataSource; label: string; description: string }[] = [
  { value: 'osm-buildings', label: 'OSM Buildings', description: 'OpenStreetMap 3D buildings worldwide' },
  { value: 'bing-aerial', label: 'Bing Aerial', description: 'Satellite imagery draped on terrain' },
  { value: 'google-photorealistic', label: 'Google Photorealistic', description: 'High-fidelity 3D photogrammetry (where available)' },
];

export function CesiumSettingsDialog() {
  const dataSource = useViewerStore((s) => s.cesiumDataSource);
  const setCesiumDataSource = useViewerStore((s) => s.setCesiumDataSource);
  const terrainEnabled = useViewerStore((s) => s.cesiumTerrainEnabled);
  const setCesiumTerrainEnabled = useViewerStore((s) => s.setCesiumTerrainEnabled);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="h-6 w-6">
          <Settings2 className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">3D World Context</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Data Source */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">3D Data Source</Label>
            <div className="space-y-1">
              {DATA_SOURCE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                    dataSource === opt.value
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="cesium-data-source"
                    checked={dataSource === opt.value}
                    onChange={() => setCesiumDataSource(opt.value)}
                    className="mt-0.5 accent-teal-500"
                  />
                  <div>
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="text-[10px] text-zinc-400">{opt.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Terrain Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={terrainEnabled}
              onChange={(e) => setCesiumTerrainEnabled(e.target.checked)}
              className="accent-teal-500"
            />
            <span className="text-xs">Enable 3D terrain (Cesium World Terrain)</span>
          </label>

          <p className="text-[10px] text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3">
            Powered by Cesium ion. Real-world 3D tiles are overlaid on your georeferenced
            IFC model. Only available when the model contains IfcMapConversion data.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

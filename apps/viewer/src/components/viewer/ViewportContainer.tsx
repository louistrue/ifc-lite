/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { Viewport } from './Viewport';
import { ViewportOverlays } from './ViewportOverlays';
import { ToolOverlays } from './ToolOverlays';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

export function ViewportContainer() {
  const { geometryResult, ifcDataStore } = useIfc();
  const selectedStorey = useViewerStore((s) => s.selectedStorey);

  // Filter geometry based on selected storey
  const filteredGeometry = useMemo(() => {
    if (!geometryResult?.meshes || !ifcDataStore?.spatialHierarchy) {
      return geometryResult?.meshes || null;
    }

    if (selectedStorey === null) {
      return geometryResult.meshes;
    }

    const hierarchy = ifcDataStore.spatialHierarchy;
    const storeyElementIds = hierarchy.byStorey.get(selectedStorey);

    if (!storeyElementIds || storeyElementIds.length === 0) {
      return geometryResult.meshes;
    }

    const storeyElementIdSet = new Set(storeyElementIds);
    return geometryResult.meshes.filter(mesh =>
      storeyElementIdSet.has(mesh.expressId)
    );
  }, [geometryResult, ifcDataStore, selectedStorey]);

  return (
    <div className="relative h-full w-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800">
      <Viewport
        geometry={filteredGeometry}
        coordinateInfo={geometryResult?.coordinateInfo}
      />
      <ViewportOverlays />
      <ToolOverlays />
    </div>
  );
}

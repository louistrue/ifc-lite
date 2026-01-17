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
  const typeVisibility = useViewerStore((s) => s.typeVisibility);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);

  // Filter geometry based on type visibility only
  // PERFORMANCE FIX: Don't filter by storey or hiddenEntities here
  // Instead, let the renderer handle visibility filtering at the batch level
  // This avoids expensive batch rebuilding when visibility changes
  const filteredGeometry = useMemo(() => {
    if (!geometryResult?.meshes) {
      return null;
    }

    let meshes = geometryResult.meshes;

    // Filter by type visibility (spatial elements)
    meshes = meshes.filter(mesh => {
      const ifcType = mesh.ifcType;

      // Check type visibility
      if (ifcType === 'IfcSpace' && !typeVisibility.spaces) {
        return false;
      }
      if (ifcType === 'IfcOpeningElement' && !typeVisibility.openings) {
        return false;
      }
      if (ifcType === 'IfcSite' && !typeVisibility.site) {
        return false;
      }

      return true;
    });

    // Apply transparency for spatial elements
    meshes = meshes.map(mesh => {
      const ifcType = mesh.ifcType;
      const isSpace = ifcType === 'IfcSpace';
      const isOpening = ifcType === 'IfcOpeningElement';

      if (isSpace || isOpening) {
        // Create a new color array with reduced opacity
        const newColor: [number, number, number, number] = [
          mesh.color[0],
          mesh.color[1],
          mesh.color[2],
          Math.min(mesh.color[3] * 0.3, 0.3), // Semi-transparent (30% opacity max)
        ];
        return { ...mesh, color: newColor };
      }

      return mesh;
    });

    return meshes;
  }, [geometryResult, typeVisibility]);

  // Compute combined isolation set (storey + manual isolation)
  // This is passed to the renderer for batch-level visibility filtering
  const computedIsolatedIds = useMemo(() => {
    // If manual isolation is active, use that
    if (isolatedEntities !== null) {
      return isolatedEntities;
    }

    // If storey is selected, compute storey element IDs
    if (ifcDataStore?.spatialHierarchy && selectedStorey !== null) {
      const hierarchy = ifcDataStore.spatialHierarchy;
      const storeyElementIds = hierarchy.byStorey.get(selectedStorey);

      if (storeyElementIds && storeyElementIds.length > 0) {
        return new Set(storeyElementIds);
      }
    }

    // No isolation active
    return null;
  }, [ifcDataStore, selectedStorey, isolatedEntities]);

  return (
    <div className="relative h-full w-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800">
      <Viewport
        geometry={filteredGeometry}
        coordinateInfo={geometryResult?.coordinateInfo}
        computedIsolatedIds={computedIsolatedIds}
      />
      <ViewportOverlays />
      <ToolOverlays />
    </div>
  );
}

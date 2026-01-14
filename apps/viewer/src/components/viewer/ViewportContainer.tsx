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

  // Filter geometry based on selected storey and type visibility
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

    // Filter by selected storey (if applicable)
    if (ifcDataStore?.spatialHierarchy && selectedStorey !== null) {
      const hierarchy = ifcDataStore.spatialHierarchy;
      const storeyElementIds = hierarchy.byStorey.get(selectedStorey);

      if (storeyElementIds && storeyElementIds.length > 0) {
        const storeyElementIdSet = new Set(storeyElementIds);
        meshes = meshes.filter(mesh =>
          storeyElementIdSet.has(mesh.expressId)
        );
      }
    }

    return meshes;
  }, [geometryResult, ifcDataStore, selectedStorey, typeVisibility]);

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

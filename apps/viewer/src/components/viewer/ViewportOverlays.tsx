/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Home,
  ZoomIn,
  ZoomOut,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { ViewCube, type ViewCubeRef } from './ViewCube';
import { AxisHelper } from './AxisHelper';

export function ViewportOverlays() {
  const selectedStorey = useViewerStore((s) => s.selectedStorey);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const setOnCameraRotationChange = useViewerStore((s) => s.setOnCameraRotationChange);
  const setOnScaleChange = useViewerStore((s) => s.setOnScaleChange);
  const { ifcDataStore, geometryResult } = useIfc();

  // Use refs for rotation to avoid re-renders - ViewCube updates itself directly
  const cameraRotationRef = useRef({ azimuth: 45, elevation: 25 });
  const viewCubeRef = useRef<ViewCubeRef | null>(null);

  // Local state for scale - updated via callback, no global re-renders
  const [scale, setScale] = useState(10);

  // Register callback for real-time rotation updates - updates ViewCube directly
  useEffect(() => {
    const handleRotationChange = (rotation: { azimuth: number; elevation: number }) => {
      cameraRotationRef.current = rotation;
      // Update ViewCube directly via ref (no React re-render)
      if (viewCubeRef.current) {
        const viewCubeRotationX = -rotation.elevation;
        const viewCubeRotationY = -rotation.azimuth;
        viewCubeRef.current.updateRotation(viewCubeRotationX, viewCubeRotationY);
      }
    };
    setOnCameraRotationChange(handleRotationChange);
    return () => setOnCameraRotationChange(null);
  }, [setOnCameraRotationChange]);

  // Register callback for real-time scale updates
  useEffect(() => {
    setOnScaleChange(setScale);
    return () => setOnScaleChange(null);
  }, [setOnScaleChange]);

  const storeyName = selectedStorey && ifcDataStore
    ? ifcDataStore.entities.getName(selectedStorey) || `Storey #${selectedStorey}`
    : null;

  // Calculate visible count considering visibility filters
  const totalCount = geometryResult?.meshes?.length ?? 0;
  let visibleCount = totalCount;
  if (isolatedEntities !== null) {
    visibleCount = isolatedEntities.size;
  } else if (hiddenEntities.size > 0) {
    visibleCount = totalCount - hiddenEntities.size;
  }

  // Initial rotation values (ViewCube will update itself via ref)
  const initialRotationX = -cameraRotationRef.current.elevation;
  const initialRotationY = -cameraRotationRef.current.azimuth;

  const handleViewChange = useCallback((view: string) => {
    const viewMap: Record<string, 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'> = {
      top: 'top',
      bottom: 'bottom',
      front: 'front',
      back: 'back',
      left: 'left',
      right: 'right',
    };
    const mappedView = viewMap[view];
    if (mappedView && cameraCallbacks.setPresetView) {
      cameraCallbacks.setPresetView(mappedView);
    }
  }, [cameraCallbacks]);

  const handleHome = useCallback(() => {
    cameraCallbacks.home?.();
  }, [cameraCallbacks]);

  const handleFitAll = useCallback(() => {
    cameraCallbacks.fitAll?.();
  }, [cameraCallbacks]);

  const handleZoomIn = useCallback(() => {
    cameraCallbacks.zoomIn?.();
  }, [cameraCallbacks]);

  const handleZoomOut = useCallback(() => {
    cameraCallbacks.zoomOut?.();
  }, [cameraCallbacks]);

  // Format scale value for display
  const formatScale = (worldSize: number): string => {
    if (worldSize >= 1000) {
      return `${(worldSize / 1000).toFixed(1)}km`;
    } else if (worldSize >= 1) {
      return `${worldSize.toFixed(1)}m`;
    } else if (worldSize >= 0.1) {
      return `${(worldSize * 100).toFixed(0)}cm`;
    } else {
      return `${(worldSize * 1000).toFixed(0)}mm`;
    }
  };

  return (
    <>
      {/* Navigation Controls (bottom-right) */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg border shadow-sm p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleHome}>
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Home (H)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleZoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom In (+)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleZoomOut}>
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom Out (-)</TooltipContent>
        </Tooltip>
      </div>

      {/* Context Info (bottom-center) - Storey name only */}
      {storeyName && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-background/80 backdrop-blur-sm rounded-full border shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-medium">{storeyName}</span>
          </div>
        </div>
      )}

      {/* ViewCube (top-right) */}
      <div className="absolute top-6 right-6">
        <ViewCube
          ref={viewCubeRef}
          onViewChange={handleViewChange}
          onDrag={(deltaX, deltaY) => cameraCallbacks.orbit?.(deltaX, deltaY)}
          rotationX={initialRotationX}
          rotationY={initialRotationY}
        />
      </div>

      {/* Axis Helper (bottom-left, above scale bar) - IFC Z-up convention */}
      <div className="absolute bottom-16 left-4">
        <AxisHelper
          rotationX={initialRotationX}
          rotationY={initialRotationY}
        />
      </div>

      {/* Scale Bar (bottom-left) */}
      <div className="absolute bottom-4 left-4 flex flex-col items-start gap-1">
        <div className="h-1 w-24 bg-foreground/80 rounded-full" />
        <span className="text-xs text-foreground/80">{formatScale(scale)}</span>
      </div>
    </>
  );
}

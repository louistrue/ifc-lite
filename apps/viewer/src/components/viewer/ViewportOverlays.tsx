import { useCallback, useEffect, useState } from 'react';
import {
  Home,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { ViewCube } from './ViewCube';

export function ViewportOverlays() {
  const selectedStorey = useViewerStore((s) => s.selectedStorey);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const setOnCameraRotationChange = useViewerStore((s) => s.setOnCameraRotationChange);
  const { ifcDataStore, geometryResult } = useIfc();
  
  // Local state for camera rotation - updated via callback, no global re-renders
  const [cameraRotation, setCameraRotation] = useState({ azimuth: 45, elevation: 25 });
  
  // Register callback for real-time rotation updates
  useEffect(() => {
    setOnCameraRotationChange(setCameraRotation);
    return () => setOnCameraRotationChange(null);
  }, [setOnCameraRotationChange]);

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

  // Convert camera azimuth/elevation to ViewCube rotation
  // ViewCube rotationX = elevation (positive = looking down)
  // ViewCube rotationY = -azimuth (inverted)
  const viewCubeRotationX = -cameraRotation.elevation;
  const viewCubeRotationY = -cameraRotation.azimuth;

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

  const handleFitAll = useCallback(() => {
    cameraCallbacks.fitAll?.();
  }, [cameraCallbacks]);

  const handleZoomIn = useCallback(() => {
    cameraCallbacks.zoomIn?.();
  }, [cameraCallbacks]);

  const handleZoomOut = useCallback(() => {
    cameraCallbacks.zoomOut?.();
  }, [cameraCallbacks]);

  return (
    <>
      {/* Navigation Controls (bottom-right) */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg border shadow-sm p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleFitAll}>
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Fit All (F)</TooltipContent>
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleFitAll}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Reset View (R)</TooltipContent>
        </Tooltip>
      </div>

      {/* Context Info (bottom-center) */}
      {(storeyName || visibleCount > 0) && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-background/80 backdrop-blur-sm rounded-full border shadow-sm">
          <div className="flex items-center gap-3 text-sm">
            {storeyName && (
              <>
                <Layers className="h-4 w-4 text-primary" />
                <span className="font-medium">{storeyName}</span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            <span className="text-muted-foreground">
              {visibleCount.toLocaleString()} objects visible
            </span>
          </div>
        </div>
      )}

      {/* ViewCube (top-right) */}
      <div className="absolute top-4 right-4 p-2 bg-background/60 backdrop-blur-sm rounded-lg border shadow-sm">
        <ViewCube
          onViewChange={handleViewChange}
          rotationX={viewCubeRotationX}
          rotationY={viewCubeRotationY}
        />
      </div>

      {/* Scale Bar (bottom-left) */}
      <div className="absolute bottom-4 left-4 flex flex-col items-start gap-1">
        <div className="h-1 w-24 bg-foreground/80 rounded-full" />
        <span className="text-xs text-foreground/80">~10m</span>
      </div>
    </>
  );
}

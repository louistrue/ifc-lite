import { useCallback } from 'react';
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

interface ViewportOverlaysProps {
  onViewChange?: (view: string) => void;
  onFitAll?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
}

export function ViewportOverlays({
  onViewChange,
  onFitAll,
  onZoomIn,
  onZoomOut,
  onResetView,
}: ViewportOverlaysProps) {
  const selectedStorey = useViewerStore((s) => s.selectedStorey);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const { ifcDataStore, geometryResult } = useIfc();

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

  const handleViewChange = useCallback((view: string) => {
    onViewChange?.(view);
  }, [onViewChange]);

  return (
    <>
      {/* Navigation Controls (bottom-right) */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg border shadow-sm p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onFitAll}>
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Fit All (F)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onZoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom In (+)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onZoomOut}>
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom Out (-)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onResetView}>
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
        <ViewCube onViewChange={handleViewChange} />
      </div>

      {/* Scale Bar (bottom-left) */}
      <div className="absolute bottom-4 left-4 flex flex-col items-start gap-1">
        <div className="h-1 w-24 bg-foreground/80 rounded-full" />
        <span className="text-xs text-foreground/80">~10m</span>
      </div>
    </>
  );
}

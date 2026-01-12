/**
 * Tool-specific overlays for measure and section tools
 */

import { useCallback, useState } from 'react';
import { X, Trash2, Ruler, Slice } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';

interface MeasurePoint {
  x: number;
  y: number;
  z: number;
  screenX: number;
  screenY: number;
}

interface Measurement {
  id: string;
  start: MeasurePoint;
  end: MeasurePoint;
  distance: number;
}

export function ToolOverlays() {
  const activeTool = useViewerStore((s) => s.activeTool);

  if (activeTool === 'measure') {
    return <MeasureOverlay />;
  }

  if (activeTool === 'section') {
    return <SectionOverlay />;
  }

  return null;
}

function MeasureOverlay() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isPlacingPoint, setIsPlacingPoint] = useState(false);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  const handleClear = useCallback(() => {
    setMeasurements([]);
    setIsPlacingPoint(false);
  }, []);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleDeleteMeasurement = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // Calculate total distance
  const totalDistance = measurements.reduce((sum, m) => sum + m.distance, 0);

  return (
    <>
      {/* Measure Tool Panel */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg p-3 min-w-64">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Measure Tool</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear all">
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-3">
          Click on the model to place measurement points
        </div>

        {measurements.length > 0 ? (
          <div className="space-y-2">
            {measurements.map((m, i) => (
              <div
                key={m.id}
                className="flex items-center justify-between bg-muted/50 rounded px-2 py-1 text-sm"
              >
                <span className="text-muted-foreground">#{i + 1}</span>
                <span className="font-mono">{formatDistance(m.distance)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-5 w-5"
                  onClick={() => handleDeleteMeasurement(m.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {measurements.length > 1 && (
              <div className="flex items-center justify-between border-t pt-2 mt-2 text-sm font-medium">
                <span>Total</span>
                <span className="font-mono">{formatDistance(totalDistance)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground text-sm">
            No measurements yet
          </div>
        )}
      </div>

      {/* Instruction hint */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm shadow-lg">
        {isPlacingPoint
          ? 'Click to set end point'
          : 'Click on model to set start point'}
      </div>
    </>
  );
}

function SectionOverlay() {
  const [sectionPlane, setSectionPlane] = useState<{
    axis: 'x' | 'y' | 'z';
    position: number;
    enabled: boolean;
  }>({
    axis: 'y',
    position: 50,
    enabled: true,
  });
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  const handleClose = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const handleAxisChange = useCallback((axis: 'x' | 'y' | 'z') => {
    setSectionPlane((prev) => ({ ...prev, axis }));
  }, []);

  const handlePositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSectionPlane((prev) => ({ ...prev, position: Number(e.target.value) }));
  }, []);

  const handleToggle = useCallback(() => {
    setSectionPlane((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const handleFlip = useCallback(() => {
    setSectionPlane((prev) => ({ ...prev, position: 100 - prev.position }));
  }, []);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg p-3 min-w-72">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Slice className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Section Plane</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Axis Selection */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Axis</label>
          <div className="flex gap-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <Button
                key={axis}
                variant={sectionPlane.axis === axis ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => handleAxisChange(axis)}
              >
                {axis.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* Position Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Position</label>
            <span className="text-xs font-mono">{sectionPlane.position}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={sectionPlane.position}
            onChange={handlePositionChange}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant={sectionPlane.enabled ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={handleToggle}
          >
            {sectionPlane.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleFlip}>
            Flip
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          Section plane cuts the model along the selected axis
        </div>
      </div>
    </div>
  );
}

function formatDistance(meters: number): string {
  if (meters < 0.01) {
    return `${(meters * 1000).toFixed(1)} mm`;
  } else if (meters < 1) {
    return `${(meters * 100).toFixed(1)} cm`;
  } else if (meters < 1000) {
    return `${meters.toFixed(2)} m`;
  } else {
    return `${(meters / 1000).toFixed(2)} km`;
  }
}

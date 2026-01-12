/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useEffect } from 'react';
import { Boxes, Triangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { formatNumber, formatBytes } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

export function StatusBar() {
  const { loading, geometryResult, ifcDataStore } = useIfc();
  const progress = useViewerStore((s) => s.progress);
  const error = useViewerStore((s) => s.error);
  const selectedStorey = useViewerStore((s) => s.selectedStorey);

  const [fps, setFps] = useState(60);
  const [memory, setMemory] = useState(0);
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);

  // Check WebGPU support
  useEffect(() => {
    setWebgpuSupported('gpu' in navigator);
  }, []);

  // FPS counter (simplified)
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animationId: number;

    const measureFps = () => {
      frameCount++;
      const currentTime = performance.now();

      if (currentTime - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = currentTime;
      }

      animationId = requestAnimationFrame(measureFps);
    };

    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
  }, []);

  // Memory usage (if available)
  useEffect(() => {
    const updateMemory = () => {
      if ((performance as any).memory) {
        setMemory((performance as any).memory.usedJSHeapSize);
      }
    };

    updateMemory();
    const interval = setInterval(updateMemory, 2000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    if (!geometryResult) {
      return { elements: 0, triangles: 0 };
    }
    return {
      elements: geometryResult.meshes?.length ?? 0,
      triangles: geometryResult.totalTriangles ?? 0,
    };
  }, [geometryResult]);

  const visibleElements = useMemo(() => {
    if (!selectedStorey || !ifcDataStore?.spatialHierarchy) {
      return stats.elements;
    }
    const storeyElements = ifcDataStore.spatialHierarchy.byStorey.get(selectedStorey);
    return (storeyElements as number[] | undefined)?.length ?? stats.elements;
  }, [selectedStorey, ifcDataStore, stats.elements]);

  return (
    <div className="h-7 px-3 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        {loading ? (
          <span className="text-primary">{progress?.phase || 'Loading...'}</span>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <span>Ready</span>
        )}
      </div>

      {/* Center: Model Stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Boxes className="h-3.5 w-3.5" />
          <span>
            {formatNumber(visibleElements)}
            {selectedStorey && stats.elements !== visibleElements && (
              <span className="opacity-60"> / {formatNumber(stats.elements)}</span>
            )}
            {' '}elements
          </span>
        </div>

        <Separator orientation="vertical" className="h-3.5" />

        <div className="flex items-center gap-1.5">
          <Triangle className="h-3.5 w-3.5" />
          <span>{formatNumber(stats.triangles)} tris</span>
        </div>
      </div>

      {/* Right: Performance */}
      <div className="flex items-center gap-3">
        <span className={fps < 30 ? 'text-destructive' : fps < 50 ? 'text-yellow-500' : ''}>
          {fps} FPS
        </span>

        {memory > 0 && (
          <>
            <Separator orientation="vertical" className="h-3.5" />
            <span>{formatBytes(memory)}</span>
          </>
        )}

        <Separator orientation="vertical" className="h-3.5" />

        <div className="flex items-center gap-1">
          {webgpuSupported ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
          )}
          <span>{webgpuSupported ? 'WebGPU' : 'WebGL'}</span>
        </div>
      </div>
    </div>
  );
}

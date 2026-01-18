/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useRef, useState, useCallback } from 'react';
import { Viewport } from './Viewport';
import { ViewportOverlays } from './ViewportOverlays';
import { ToolOverlays } from './ToolOverlays';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { useWebGPU } from '@/hooks/useWebGPU';
import { Upload, MousePointer, Layers, Info, Command, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react';

export function ViewportContainer() {
  const { geometryResult, ifcDataStore, loadFile, loading } = useIfc();
  const selectedStoreys = useViewerStore((s) => s.selectedStoreys);
  const typeVisibility = useViewerStore((s) => s.typeVisibility);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const webgpu = useWebGPU();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only show drag state if WebGPU is supported
    if (webgpu.supported) {
      setIsDragging(true);
    }
  }, [webgpu.supported]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Block file loading if WebGPU not supported
    if (!webgpu.supported) {
      return;
    }

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.ifc') || file.name.endsWith('.ifcx'))) {
      loadFile(file);
    }
  }, [loadFile, webgpu.supported]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Block file loading if WebGPU not supported
    if (!webgpu.supported) {
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  }, [loadFile, webgpu.supported]);

  const hasGeometry = geometryResult?.meshes && geometryResult.meshes.length > 0;

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

  // Compute combined isolation set (storeys + manual isolation)
  // This is passed to the renderer for batch-level visibility filtering
  const computedIsolatedIds = useMemo(() => {
    // If manual isolation is active, use that
    if (isolatedEntities !== null) {
      return isolatedEntities;
    }

    // If storeys are selected, compute combined element IDs from all selected storeys
    if (ifcDataStore?.spatialHierarchy && selectedStoreys.size > 0) {
      const hierarchy = ifcDataStore.spatialHierarchy;
      const combinedIds = new Set<number>();

      for (const storeyId of selectedStoreys) {
        const storeyElementIds = hierarchy.byStorey.get(storeyId);
        if (storeyElementIds) {
          for (const id of storeyElementIds) {
            combinedIds.add(id);
          }
        }
      }

      if (combinedIds.size > 0) {
        return combinedIds;
      }
    }

    // No isolation active
    return null;
  }, [ifcDataStore, selectedStoreys, isolatedEntities]);

  // Grid Pattern
  const GridPattern = () => (
    <>
      {/* Light mode grid - subtle gray */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.06] dark:hidden"
        style={{
          backgroundImage: `linear-gradient(#3b4261 1px, transparent 1px), linear-gradient(90deg, #3b4261 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
          backgroundPosition: '-1px -1px'
        }}
      />
      {/* Dark mode grid - subtle blue/cyan tint */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.12] hidden dark:block"
        style={{
          backgroundImage: `linear-gradient(#3b4261 1px, transparent 1px), linear-gradient(90deg, #3b4261 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
          backgroundPosition: '-1px -1px'
        }}
      />
    </>
  );

  // Empty state when no file is loaded
  if (!hasGeometry && !loading) {
    return (
      <div
        className="relative h-full w-full bg-white dark:bg-black text-zinc-900 dark:text-zinc-50 overflow-hidden"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <GridPattern />

        <input
          ref={fileInputRef}
          type="file"
          accept=".ifc,.ifcx"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-[2px] flex items-center justify-center p-8">
            <div className="border-4 border-dashed border-primary bg-white/90 dark:bg-black/90 p-12 max-w-2xl w-full text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] transition-all">
              <Upload className="h-20 w-20 mx-auto text-primary mb-6" />
              <p className="text-3xl font-black uppercase tracking-tight text-primary">Drop File to Load</p>
            </div>
          </div>
        )}

        {/* WebGPU Not Supported Banner */}
        {!webgpu.checking && !webgpu.supported && (
          <div className="absolute top-0 left-0 right-0 z-40">
            {/* Hazard stripes background */}
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  -45deg,
                  transparent,
                  transparent 10px,
                  #f7768e 10px,
                  #f7768e 20px
                )`
              }}
            />
            <div className="relative border-b-4 border-[#f7768e] bg-[#1a1b26] dark:bg-[#1a1b26] px-4 py-5">
              <div className="max-w-3xl mx-auto flex items-start gap-4">
                {/* Icon container with brutalist frame */}
                <div className="flex-shrink-0 border-2 border-[#f7768e] p-2 bg-[#f7768e]/10">
                  <AlertTriangle className="h-6 w-6 text-[#f7768e]" />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-lg uppercase tracking-wider text-[#f7768e] mb-1">
                    WebGPU Not Available
                  </h3>
                  <p className="font-mono text-sm text-[#a9b1d6] leading-relaxed">
                    This viewer requires WebGPU which is not supported by your browser or device.
                    {webgpu.reason && (
                      <span className="block mt-1 text-[#565f89]">
                        {webgpu.reason}
                      </span>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href="https://caniuse.com/webgpu"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono uppercase tracking-wide border border-[#3b4261] text-[#7aa2f7] hover:border-[#7aa2f7] hover:bg-[#7aa2f7]/10 transition-colors"
                    >
                      Check Browser Support
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <span className="inline-flex items-center px-3 py-1 text-xs font-mono text-[#565f89] border border-[#3b4261]">
                      Chrome 113+ / Edge 113+ / Firefox 141+ / Safari 18+
                    </span>
                  </div>

                  {/* Troubleshooting Section */}
                  <button
                    onClick={() => setShowTroubleshooting(!showTroubleshooting)}
                    className="mt-4 flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[#ff9e64] hover:text-[#e0af68] transition-colors"
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform ${showTroubleshooting ? 'rotate-180' : ''}`} />
                    {showTroubleshooting ? 'Hide' : 'Show'} Troubleshooting
                  </button>

                  {showTroubleshooting && (
                    <div className="mt-4 p-4 bg-[#1f2335] border border-[#3b4261] text-xs font-mono space-y-4">
                      <div>
                        <h4 className="font-bold text-[#ff9e64] uppercase tracking-wide mb-2">Blocklist Override</h4>
                        <p className="text-[#a9b1d6] mb-2">
                          WebGPU may be disabled due to GPU/driver blocklist. Try these flags:
                        </p>
                        <div className="space-y-1 text-[#7dcfff]">
                          <p><code className="bg-[#16161e] px-1.5 py-0.5">chrome://flags/#enable-unsafe-webgpu</code> → Enable</p>
                          <p><code className="bg-[#16161e] px-1.5 py-0.5">chrome://flags/#ignore-gpu-blocklist</code> → Enable</p>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-bold text-[#bb9af7] uppercase tracking-wide mb-2">Firefox</h4>
                        <p className="text-[#a9b1d6] mb-2">
                          WebGPU enabled by default in Firefox 141+. For older versions:
                        </p>
                        <p className="text-[#7dcfff]">
                          <code className="bg-[#16161e] px-1.5 py-0.5">about:config</code> → <code className="bg-[#16161e] px-1.5 py-0.5">dom.webgpu.enabled</code> → true
                        </p>
                      </div>

                      <div>
                        <h4 className="font-bold text-[#9ece6a] uppercase tracking-wide mb-2">Safari</h4>
                        <p className="text-[#a9b1d6]">
                          Safari → Settings → Feature Flags → Enable "WebGPU"
                        </p>
                      </div>

                      <div>
                        <h4 className="font-bold text-[#7aa2f7] uppercase tracking-wide mb-2">Verify Status</h4>
                        <p className="text-[#a9b1d6] mb-2">Check your GPU status page:</p>
                        <div className="space-y-1 text-[#7dcfff]">
                          <p>Chrome/Edge: <code className="bg-[#16161e] px-1.5 py-0.5">chrome://gpu</code></p>
                          <p>Firefox: <code className="bg-[#16161e] px-1.5 py-0.5">about:support</code></p>
                        </div>
                      </div>

                      <a
                        href="https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[#7aa2f7] hover:underline"
                      >
                        Full Troubleshooting Guide
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10">

          {/* Main Card */}
          <div className="max-w-md w-full bg-white dark:bg-[#16161e] border border-zinc-300 dark:border-[#3b4261] p-8 flex flex-col items-center transition-transform hover:-translate-y-1 duration-200 shadow-lg">
            
            <style>{`
              @keyframes float-slow {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-6px) rotate(1deg); }
              }
              .animate-float-slow {
                animation: float-slow 5s ease-in-out infinite;
              }
            `}</style>

            {/* Logo Section */}
            <div className="mb-10 relative group/logo cursor-pointer">
              {/* Back Layer */}
              <div className="absolute -inset-6 bg-zinc-100 dark:bg-[#1f2335] -rotate-3 z-0 border border-zinc-300 dark:border-[#3b4261] transition-all duration-500 group-hover/logo:rotate-0 group-hover/logo:scale-110" />
              
              {/* Middle Layer - accent on hover */}
              <div className="absolute -inset-6 border border-primary z-0 opacity-0 scale-95 rotate-3 transition-all duration-500 delay-75 group-hover/logo:opacity-40 group-hover/logo:rotate-6 group-hover/logo:scale-105" />

              {/* Logo Container */}
              <div className="relative z-10 animate-float-slow transition-transform duration-300 group-hover/logo:scale-110">
                <img 
                  src="/logo.png" 
                  alt="IFClite Logo" 
                  className="h-28 w-auto drop-shadow-lg"
                />
              </div>
            </div>

            <h2 className="text-3xl font-black tracking-tighter text-center mb-2 text-zinc-900 dark:text-[#a9b1d6]">
              IFClite
            </h2>
            <p className="text-zinc-500 dark:text-[#565f89] font-mono text-sm text-center mb-8 border-b border-zinc-200 dark:border-[#3b4261] pb-4 w-full">
              High-performance web viewer demo
            </p>

            {/* Action */}
            <button
              onClick={() => webgpu.supported && fileInputRef.current?.click()}
              disabled={!webgpu.supported || webgpu.checking}
              className={`group w-full flex items-center justify-center gap-3 px-6 py-3 font-mono text-sm border transition-all ${
                !webgpu.supported || webgpu.checking
                  ? 'border-zinc-200 dark:border-[#3b4261]/50 text-zinc-300 dark:text-[#565f89]/50 cursor-not-allowed'
                  : 'border-zinc-300 dark:border-[#3b4261] text-zinc-600 dark:text-[#a9b1d6] hover:border-primary hover:text-primary cursor-pointer'
              }`}
            >
              <Upload className={`h-4 w-4 transition-transform ${webgpu.supported ? 'group-hover:-translate-y-0.5' : ''}`} />
              <span>{webgpu.checking ? 'Checking WebGPU...' : webgpu.supported ? 'Open .ifc file' : 'WebGPU Required'}</span>
            </button>

            <p className="mt-3 text-xs font-mono text-zinc-400 dark:text-[#565f89]">
              {webgpu.supported ? 'or drag & drop anywhere' : 'file upload disabled'}
            </p>
          </div>

          {/* Feature Grid */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl w-full">
            {[
              { icon: MousePointer, label: "Select", desc: "Inspect elements", accentClass: 'text-blue-500 dark:text-[#7aa2f7]' },
              { icon: Layers, label: "Filter", desc: "Isolate storeys", accentClass: 'text-purple-500 dark:text-[#bb9af7]' },
              { icon: Info, label: "Analyze", desc: "View properties", accentClass: 'text-cyan-500 dark:text-[#7dcfff]' }
            ].map((feature, i) => (
              <div 
                key={i} 
                className="p-4 flex items-center gap-4 bg-zinc-100 dark:bg-[#1f2335] border border-zinc-300 dark:border-[#3b4261]"
              >
                <div className={`p-2 bg-white dark:bg-[#16161e] border border-zinc-300 dark:border-[#3b4261] ${feature.accentClass}`}>
                  <feature.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold uppercase text-sm tracking-wide text-zinc-900 dark:text-[#a9b1d6]">{feature.label}</h3>
                  <p className="text-xs font-mono text-zinc-500 dark:text-[#565f89]">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="absolute bottom-8 right-8 hidden md:block">
            <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 bg-zinc-100 dark:bg-[#1f2335] border border-zinc-300 dark:border-[#3b4261] text-zinc-500 dark:text-[#565f89]">
              <Command className="h-3 w-3" />
              <span>SHORTCUTS</span>
              <span className="px-1.5 ml-1 font-bold text-primary bg-primary/20">?</span>
            </div>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full bg-zinc-50 dark:bg-black"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay for when a file is already loaded */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-white dark:bg-zinc-900 border-4 border-dashed border-primary p-8 shadow-2xl">
            <div className="text-center">
              <Upload className="h-12 w-12 mx-auto text-primary mb-4" />
              <p className="text-xl font-bold uppercase text-primary">Replace current file</p>
            </div>
          </div>
        </div>
      )}

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

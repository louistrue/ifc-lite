/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useRef, useCallback, useMemo } from 'react';
import {
  FolderOpen,
  Download,
  MousePointer2,
  Hand,
  Rotate3d,
  PersonStanding,
  Ruler,
  Scissors,
  Eye,
  EyeOff,
  Focus,
  Home,
  Maximize2,
  Grid3x3,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  Sun,
  Moon,
  HelpCircle,
  Loader2,
  Camera,
  Info,
  Layers,
  SquareX,
  Building2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useViewerStore, isIfcxDataStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { cn } from '@/lib/utils';
import { GLTFExporter, CSVExporter } from '@ifc-lite/export';
import { FileSpreadsheet, FileJson } from 'lucide-react';

type Tool = 'select' | 'pan' | 'orbit' | 'walk' | 'measure' | 'section';

// #region FIX: Move ToolButton OUTSIDE MainToolbar to prevent recreation on every render
// This fixes Radix UI Tooltip's asChild prop becoming stale during re-renders
interface ToolButtonProps {
  tool: Tool;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  activeTool: string;
  onToolChange: (tool: Tool) => void;
}

function ToolButton({ tool, icon: Icon, label, shortcut, activeTool, onToolChange }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={activeTool === tool ? 'default' : 'ghost'}
          size="icon-sm"
          onClick={(e) => {
            // Blur button to close tooltip after click
            (e.currentTarget as HTMLButtonElement).blur();
            onToolChange(tool);
          }}
          className={cn(activeTool === tool && 'bg-primary text-primary-foreground')}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut && <span className="ml-2 text-xs opacity-60">({shortcut})</span>}
      </TooltipContent>
    </Tooltip>
  );
}

// #region FIX: Move ActionButton OUTSIDE MainToolbar to prevent recreation on every render
interface ActionButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  shortcut?: string;
  disabled?: boolean;
}

function ActionButton({ icon: Icon, label, onClick, shortcut, disabled }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            // Blur button to close tooltip after click
            (e.currentTarget as HTMLButtonElement).blur();
            onClick();
          }}
          disabled={disabled}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut && <span className="ml-2 text-xs opacity-60">({shortcut})</span>}
      </TooltipContent>
    </Tooltip>
  );
}
// #endregion

interface MainToolbarProps {
  onShowShortcuts?: () => void;
}

export function MainToolbar({ onShowShortcuts }: MainToolbarProps = {} as MainToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addModelInputRef = useRef<HTMLInputElement>(null);
  const { loadFile, loading, progress, geometryResult, ifcDataStore, models, clearAllModels, loadFilesSequentially, loadFederatedIfcx, addIfcxOverlays, addModel } = useIfc();

  // Check if we have models loaded (for showing add model button)
  const hasModelsLoaded = models.size > 0 || (geometryResult?.meshes && geometryResult.meshes.length > 0);
  const activeTool = useViewerStore((state) => state.activeTool);
  const setActiveTool = useViewerStore((state) => state.setActiveTool);
  const theme = useViewerStore((state) => state.theme);
  const toggleTheme = useViewerStore((state) => state.toggleTheme);
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const isolateEntity = useViewerStore((state) => state.isolateEntity);
  const hideEntity = useViewerStore((state) => state.hideEntity);
  const showAll = useViewerStore((state) => state.showAll);
  const clearStoreySelection = useViewerStore((state) => state.clearStoreySelection);
  const error = useViewerStore((state) => state.error);
  const cameraCallbacks = useViewerStore((state) => state.cameraCallbacks);
  const hoverTooltipsEnabled = useViewerStore((state) => state.hoverTooltipsEnabled);
  const toggleHoverTooltips = useViewerStore((state) => state.toggleHoverTooltips);
  const typeVisibility = useViewerStore((state) => state.typeVisibility);
  const toggleTypeVisibility = useViewerStore((state) => state.toggleTypeVisibility);
  const resetViewerState = useViewerStore((state) => state.resetViewerState);

  // Check which type geometries exist
  const typeGeometryExists = useMemo(() => {
    if (!geometryResult?.meshes) {
      return { spaces: false, openings: false, site: false };
    }
    const meshes = geometryResult.meshes;
    return {
      spaces: meshes.some(m => m.ifcType === 'IfcSpace'),
      openings: meshes.some(m => m.ifcType === 'IfcOpeningElement'),
      site: meshes.some(m => m.ifcType === 'IfcSite'),
    };
  }, [geometryResult]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter to only IFC files
    const ifcFiles = Array.from(files).filter(
      f => f.name.endsWith('.ifc') || f.name.endsWith('.ifcx')
    );

    if (ifcFiles.length === 0) return;

    if (ifcFiles.length === 1) {
      // Single file - use loadFile (simpler single-model path)
      loadFile(ifcFiles[0]);
    } else {
      // Multiple files - check if ALL are IFCX (use federated loading for layer composition)
      const allIfcx = ifcFiles.every(f => f.name.endsWith('.ifcx'));

      resetViewerState();
      clearAllModels();

      if (allIfcx) {
        // IFCX files use federated loading (layer composition - later files override earlier ones)
        // This handles overlay files that add properties without geometry
        console.log(`[MainToolbar] Loading ${ifcFiles.length} IFCX files with federated composition`);
        loadFederatedIfcx(ifcFiles);
      } else {
        // Mixed or all IFC4 files - load sequentially as independent models
        loadFilesSequentially(ifcFiles);
      }
    }

    // Reset input so same files can be selected again
    e.target.value = '';
  }, [loadFile, loadFilesSequentially, loadFederatedIfcx, resetViewerState, clearAllModels]);

  const handleAddModelSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter to only IFC files
    const ifcFiles = Array.from(files).filter(
      f => f.name.endsWith('.ifc') || f.name.endsWith('.ifcx')
    );

    if (ifcFiles.length === 0) return;

    // Check if adding IFCX files
    const newFilesAreIfcx = ifcFiles.every(f => f.name.endsWith('.ifcx'));
    const existingIsIfcx = isIfcxDataStore(ifcDataStore);

    if (newFilesAreIfcx && existingIsIfcx) {
      // Adding IFCX overlay(s) to existing IFCX model - re-compose with new layers
      console.log(`[MainToolbar] Adding ${ifcFiles.length} IFCX overlay(s) to existing IFCX model - re-composing`);
      addIfcxOverlays(ifcFiles);
    } else if (newFilesAreIfcx && !existingIsIfcx && ifcDataStore) {
      // User trying to add IFCX to IFC4 model - won't work
      console.warn('[MainToolbar] Cannot add IFCX files to non-IFCX model');
      alert(`IFCX overlay files cannot be added to IFC4 models.\n\nPlease load IFCX files separately.`);
    } else {
      // Standard case - add as independent models
      loadFilesSequentially(ifcFiles);
    }

    // Reset input so same files can be selected again
    e.target.value = '';
  }, [loadFilesSequentially, addIfcxOverlays, ifcDataStore]);

  const handleIsolate = useCallback(() => {
    if (selectedEntityId) {
      isolateEntity(selectedEntityId);
    }
  }, [selectedEntityId, isolateEntity]);

  const clearSelection = useViewerStore((state) => state.clearSelection);

  const handleHide = useCallback(() => {
    if (selectedEntityId) {
      hideEntity(selectedEntityId);
      // Clear selection after hiding - element is no longer visible
      clearSelection();
    }
  }, [selectedEntityId, hideEntity, clearSelection]);

  const handleShowAll = useCallback(() => {
    showAll();
    clearStoreySelection(); // Also clear storey filtering (matches 'A' keyboard shortcut)
  }, [showAll, clearStoreySelection]);

  const handleExportGLB = useCallback(() => {
    if (!geometryResult) return;
    try {
      const exporter = new GLTFExporter(geometryResult);
      const glb = exporter.exportGLB({ includeMetadata: true });
      // Create a new Uint8Array from the buffer to ensure correct typing
      const blob = new Blob([new Uint8Array(glb)], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [geometryResult]);

  const handleScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'screenshot.png';
      a.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  }, []);

  const handleExportCSV = useCallback((type: 'entities' | 'properties' | 'quantities') => {
    if (!ifcDataStore) return;
    try {
      const exporter = new CSVExporter(ifcDataStore);
      let csv: string;
      let filename: string;

      switch (type) {
        case 'entities':
          csv = exporter.exportEntities(undefined, { includeProperties: true, flattenProperties: true });
          filename = 'entities.csv';
          break;
        case 'properties':
          csv = exporter.exportProperties();
          filename = 'properties.csv';
          break;
        case 'quantities':
          csv = exporter.exportQuantities();
          filename = 'quantities.csv';
          break;
      }

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  }, [ifcDataStore]);

  const handleExportJSON = useCallback(() => {
    if (!ifcDataStore) return;
    try {
      // Export basic JSON structure of entities
      const entities: Record<string, unknown>[] = [];
      for (let i = 0; i < ifcDataStore.entities.count; i++) {
        const id = ifcDataStore.entities.expressId[i];
        entities.push({
          expressId: id,
          globalId: ifcDataStore.entities.getGlobalId(id),
          name: ifcDataStore.entities.getName(id),
          type: ifcDataStore.entities.getTypeName(id),
          properties: ifcDataStore.properties.getForEntity(id),
        });
      }

      const json = JSON.stringify({ entities }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('JSON export failed:', err);
    }
  }, [ifcDataStore]);

  return (
    <div className="flex items-center gap-1 px-2 h-12 border-b bg-white dark:bg-black border-zinc-200 dark:border-zinc-800 relative z-50">
      {/* File Operations */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc,.ifcx"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={addModelInputRef}
        type="file"
        accept=".ifc,.ifcx"
        multiple
        onChange={handleAddModelSelect}
        className="hidden"
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              // Blur button to close tooltip before opening file dialog
              (e.currentTarget as HTMLButtonElement).blur();
              fileInputRef.current?.click();
            }}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open IFC File</TooltipContent>
      </Tooltip>

      {/* Add Model button - only shown when models are loaded */}
      {hasModelsLoaded && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                addModelInputRef.current?.click();
              }}
              disabled={loading}
              className="text-[#9ece6a] hover:text-[#9ece6a] hover:bg-[#9ece6a]/10"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add Model to Scene (Multi-select supported)</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={!geometryResult}>
            <Download className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleExportGLB}>
            <Download className="h-4 w-4 mr-2" />
            Export GLB (3D Model)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleExportCSV('entities')} disabled={!ifcDataStore}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export Entities (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExportCSV('properties')} disabled={!ifcDataStore}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export Properties (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExportCSV('quantities')} disabled={!ifcDataStore}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export Quantities (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportJSON} disabled={!ifcDataStore}>
            <FileJson className="h-4 w-4 mr-2" />
            Export JSON (All Data)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleScreenshot}>
            <Camera className="h-4 w-4 mr-2" />
            Screenshot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Navigation Tools */}
      <ToolButton tool="select" icon={MousePointer2} label="Select" shortcut="V" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="pan" icon={Hand} label="Pan" shortcut="P" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="orbit" icon={Rotate3d} label="Orbit" shortcut="O" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="walk" icon={PersonStanding} label="Walk Mode" shortcut="C" activeTool={activeTool} onToolChange={setActiveTool} />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Measurement & Section */}
      <ToolButton tool="measure" icon={Ruler} label="Measure" shortcut="M" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="section" icon={Scissors} label="Section" shortcut="X" activeTool={activeTool} onToolChange={setActiveTool} />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Visibility */}
      <ActionButton icon={Focus} label="Isolate Selection" onClick={handleIsolate} shortcut="I" disabled={!selectedEntityId} />
      <ActionButton icon={EyeOff} label="Hide Selection" onClick={handleHide} shortcut="Del" disabled={!selectedEntityId} />
      <ActionButton icon={Eye} label="Show All (Reset Filters)" onClick={handleShowAll} shortcut="A" />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={!geometryResult}>
                <Layers className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Type Visibility</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          {typeGeometryExists.spaces && (
            <DropdownMenuCheckboxItem
              checked={typeVisibility.spaces}
              onCheckedChange={() => toggleTypeVisibility('spaces')}
            >
              <Box className="h-4 w-4 mr-2" style={{ color: '#33d9ff' }} />
              Show Spaces
            </DropdownMenuCheckboxItem>
          )}
          {typeGeometryExists.openings && (
            <DropdownMenuCheckboxItem
              checked={typeVisibility.openings}
              onCheckedChange={() => toggleTypeVisibility('openings')}
            >
              <SquareX className="h-4 w-4 mr-2" style={{ color: '#ff6b4a' }} />
              Show Openings
            </DropdownMenuCheckboxItem>
          )}
          {typeGeometryExists.site && (
            <DropdownMenuCheckboxItem
              checked={typeVisibility.site}
              onCheckedChange={() => toggleTypeVisibility('site')}
            >
              <Building2 className="h-4 w-4 mr-2" style={{ color: '#66cc4d' }} />
              Show Site
            </DropdownMenuCheckboxItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Display Options */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={hoverTooltipsEnabled ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              // Blur button to close tooltip after click
              (e.currentTarget as HTMLButtonElement).blur();
              toggleHoverTooltips();
            }}
            className={cn(hoverTooltipsEnabled && 'bg-primary text-primary-foreground')}
          >
            <Info className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {hoverTooltipsEnabled ? 'Disable' : 'Enable'} Hover Tooltips
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Camera */}
      <ActionButton icon={Home} label="Home (Isometric)" onClick={() => cameraCallbacks.home?.()} shortcut="H" />
      <ActionButton icon={Maximize2} label="Fit All" onClick={() => cameraCallbacks.fitAll?.()} shortcut="Z" />
      <ActionButton
        icon={Focus}
        label="Frame Selection"
        onClick={() => cameraCallbacks.frameSelection?.()}
        shortcut="F"
        disabled={!selectedEntityId}
      />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Preset Views (0-6)</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => cameraCallbacks.home?.()}>
            <Box className="h-4 w-4 mr-2" /> Isometric <span className="ml-auto text-xs opacity-60">0</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('top')}>
            <ArrowUp className="h-4 w-4 mr-2" /> Top <span className="ml-auto text-xs opacity-60">1</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('bottom')}>
            <ArrowDown className="h-4 w-4 mr-2" /> Bottom <span className="ml-auto text-xs opacity-60">2</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('front')}>
            <ArrowRight className="h-4 w-4 mr-2" /> Front <span className="ml-auto text-xs opacity-60">3</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('back')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back <span className="ml-auto text-xs opacity-60">4</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('left')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Left <span className="ml-auto text-xs opacity-60">5</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraCallbacks.setPresetView?.('right')}>
            <ArrowRight className="h-4 w-4 mr-2" /> Right <span className="ml-auto text-xs opacity-60">6</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Loading Progress */}
      {loading && progress && (
        <div className="flex items-center gap-2 mr-4">
          <span className="text-xs text-muted-foreground">{progress.phase}</span>
          <Progress value={progress.percent} className="w-32 h-2" />
          <span className="text-xs text-muted-foreground">{Math.round(progress.percent)}%</span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <span className="text-xs text-destructive mr-4">{error}</span>
      )}

      {/* Right Side Actions */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle Theme</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onShowShortcuts?.()}
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Keyboard Shortcuts (?)</TooltipContent>
      </Tooltip>
    </div>
  );
}

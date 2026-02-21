/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
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
  Equal,
  Crosshair,
  Home,
  Maximize2,
  Grid3x3,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  HelpCircle,
  Loader2,
  Camera,
  Info,
  Layers,
  SquareX,
  Building2,
  Plus,
  MessageSquare,
  ClipboardCheck,
  Palette,
  Orbit,
  LayoutTemplate,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useViewerStore, isIfcxDataStore } from '@/store';
import { goHomeFromStore, resetVisibilityForHomeFromStore } from '@/store/homeView';
import { executeBasketIsolate } from '@/store/basket/basketCommands';
import { useIfc } from '@/hooks/useIfc';
import { cn } from '@/lib/utils';
import { GLTFExporter, CSVExporter } from '@ifc-lite/export';
import { FileSpreadsheet, FileJson, FileText, Filter, Upload, Pencil } from 'lucide-react';
import { ExportDialog } from './ExportDialog';
import { BulkPropertyEditor } from './BulkPropertyEditor';
import { DataConnector } from './DataConnector';
import { ExportChangesButton } from './ExportChangesButton';
import { useFloorplanView } from '@/hooks/useFloorplanView';
import { recordRecentFiles, cacheFileBlobs } from '@/lib/recent-files';
import { ThemeSwitch } from './ThemeSwitch';

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

  // Listen for programmatic file-load requests (from command palette recent files)
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file) loadFile(file);
    };
    window.addEventListener('ifc-lite:load-file', handler);
    return () => window.removeEventListener('ifc-lite:load-file', handler);
  }, [loadFile]);

  // Floorplan view
  const { availableStoreys, activateFloorplan } = useFloorplanView();

  // Check if we have models loaded (for showing add model button)
  const hasModelsLoaded = models.size > 0 || (geometryResult?.meshes && geometryResult.meshes.length > 0);
  const activeTool = useViewerStore((state) => state.activeTool);
  const setActiveTool = useViewerStore((state) => state.setActiveTool);
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const hideEntities = useViewerStore((state) => state.hideEntities);
  const error = useViewerStore((state) => state.error);
  const cameraCallbacks = useViewerStore((state) => state.cameraCallbacks);
  const hoverTooltipsEnabled = useViewerStore((state) => state.hoverTooltipsEnabled);
  const toggleHoverTooltips = useViewerStore((state) => state.toggleHoverTooltips);
  const typeVisibility = useViewerStore((state) => state.typeVisibility);
  const toggleTypeVisibility = useViewerStore((state) => state.toggleTypeVisibility);
  const resetViewerState = useViewerStore((state) => state.resetViewerState);
  const bcfPanelVisible = useViewerStore((state) => state.bcfPanelVisible);
  const toggleBcfPanel = useViewerStore((state) => state.toggleBcfPanel);
  const setBcfPanelVisible = useViewerStore((state) => state.setBcfPanelVisible);
  const idsPanelVisible = useViewerStore((state) => state.idsPanelVisible);
  const toggleIdsPanel = useViewerStore((state) => state.toggleIdsPanel);
  const setIdsPanelVisible = useViewerStore((state) => state.setIdsPanelVisible);
  const listPanelVisible = useViewerStore((state) => state.listPanelVisible);
  const toggleListPanel = useViewerStore((state) => state.toggleListPanel);
  const setRightPanelCollapsed = useViewerStore((state) => state.setRightPanelCollapsed);
  const projectionMode = useViewerStore((state) => state.projectionMode);
  const toggleProjectionMode = useViewerStore((state) => state.toggleProjectionMode);
  // Basket presentation state
  const pinboardEntities = useViewerStore((state) => state.pinboardEntities);
  const basketViewCount = useViewerStore((state) => state.basketViews.length);
  const basketPresentationVisible = useViewerStore((state) => state.basketPresentationVisible);
  const toggleBasketPresentationVisible = useViewerStore((state) => state.toggleBasketPresentationVisible);
  // Lens state
  const lensPanelVisible = useViewerStore((state) => state.lensPanelVisible);
  const toggleLensPanel = useViewerStore((state) => state.toggleLensPanel);
  const setLensPanelVisible = useViewerStore((state) => state.setLensPanelVisible);

  // Check which type geometries exist across ALL loaded models (federation-aware)
  const typeGeometryExists = useMemo(() => {
    const result = { spaces: false, openings: false, site: false };

    // Check all federated models
    if (models.size > 0) {
      for (const [, model] of models) {
        const meshes = model.geometryResult?.meshes;
        if (!meshes) continue;
        for (const m of meshes) {
          if (m.ifcType === 'IfcSpace') result.spaces = true;
          else if (m.ifcType === 'IfcOpeningElement') result.openings = true;
          else if (m.ifcType === 'IfcSite') result.site = true;
          // Early exit if all found
          if (result.spaces && result.openings && result.site) return result;
        }
      }
    }

    // Fallback: also check legacy single-model geometryResult
    if (geometryResult?.meshes) {
      for (const m of geometryResult.meshes) {
        if (m.ifcType === 'IfcSpace') result.spaces = true;
        else if (m.ifcType === 'IfcOpeningElement') result.openings = true;
        else if (m.ifcType === 'IfcSite') result.site = true;
        if (result.spaces && result.openings && result.site) return result;
      }
    }

    return result;
  }, [models, geometryResult]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter to supported files (IFC, IFCX, GLB)
    const supportedFiles = Array.from(files).filter(
      f => f.name.endsWith('.ifc') || f.name.endsWith('.ifcx') || f.name.endsWith('.glb')
    );

    if (supportedFiles.length === 0) return;

    // Track recently opened files (metadata + blob cache for instant reload)
    recordRecentFiles(supportedFiles.map(f => ({ name: f.name, size: f.size })));
    cacheFileBlobs(supportedFiles);

    if (supportedFiles.length === 1) {
      // Single file - use loadFile (simpler single-model path)
      loadFile(supportedFiles[0]);
    } else {
      // Multiple files - check if ALL are IFCX (use federated loading for layer composition)
      const allIfcx = supportedFiles.every(f => f.name.endsWith('.ifcx'));

      resetViewerState();
      clearAllModels();

      if (allIfcx) {
        // IFCX files use federated loading (layer composition - later files override earlier ones)
        // This handles overlay files that add properties without geometry
        console.log(`[MainToolbar] Loading ${supportedFiles.length} IFCX files with federated composition`);
        loadFederatedIfcx(supportedFiles);
      } else {
        // Mixed or all IFC4/GLB files - load sequentially as independent models
        loadFilesSequentially(supportedFiles);
      }
    }

    // Reset input so same files can be selected again
    e.target.value = '';
  }, [loadFile, loadFilesSequentially, loadFederatedIfcx, resetViewerState, clearAllModels]);

  const handleAddModelSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter to supported files (IFC, IFCX, GLB)
    const supportedFiles = Array.from(files).filter(
      f => f.name.endsWith('.ifc') || f.name.endsWith('.ifcx') || f.name.endsWith('.glb')
    );

    if (supportedFiles.length === 0) return;

    // Check if adding IFCX files
    const newFilesAreIfcx = supportedFiles.every(f => f.name.endsWith('.ifcx'));
    const existingIsIfcx = isIfcxDataStore(ifcDataStore);

    if (newFilesAreIfcx && existingIsIfcx) {
      // Adding IFCX overlay(s) to existing IFCX model - re-compose with new layers
      console.log(`[MainToolbar] Adding ${supportedFiles.length} IFCX overlay(s) to existing IFCX model - re-composing`);
      addIfcxOverlays(supportedFiles);
    } else if (newFilesAreIfcx && !existingIsIfcx && ifcDataStore) {
      // User trying to add IFCX to IFC4 model - won't work
      console.warn('[MainToolbar] Cannot add IFCX files to non-IFCX model');
      alert(`IFCX overlay files cannot be added to IFC4 models.\n\nPlease load IFCX files separately.`);
    } else {
      // Standard case - add as independent models (IFC4, GLB, or mixed)
      loadFilesSequentially(supportedFiles);
    }

    // Reset input so same files can be selected again
    e.target.value = '';
  }, [loadFilesSequentially, addIfcxOverlays, ifcDataStore]);

  const hasSelection = selectedEntityId !== null;

  const clearSelection = useViewerStore((state) => state.clearSelection);

  const handleHide = useCallback(() => {
    // Hide ALL selected entities (multi-select or single)
    const state = useViewerStore.getState();
    const ids: number[] = state.selectedEntityIds.size > 0
      ? Array.from(state.selectedEntityIds)
      : selectedEntityId !== null ? [selectedEntityId] : [];
    if (ids.length > 0) {
      hideEntities(ids);
      clearSelection();
    }
  }, [selectedEntityId, hideEntities, clearSelection]);

  const handleShowAll = useCallback(() => {
    resetVisibilityForHomeFromStore();
  }, []);

  const handleIsolate = useCallback(() => {
    executeBasketIsolate();
  }, []);

  const handleHome = useCallback(() => {
    goHomeFromStore();
  }, []);

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

  const handleExportCSV = useCallback((type: 'entities' | 'properties' | 'quantities' | 'spatial') => {
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
        case 'spatial':
          csv = exporter.exportSpatialHierarchy();
          filename = 'spatial-hierarchy.csv';
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
      {/* ── File Operations ── */}
      <input
        id="file-input-open"
        ref={fileInputRef}
        type="file"
        accept=".ifc,.ifcx,.glb"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={addModelInputRef}
        type="file"
        accept=".ifc,.ifcx,.glb"
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
          <ExportDialog
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <FileText className="h-4 w-4 mr-2" />
                Export IFC (with changes)
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleExportGLB}>
            <Download className="h-4 w-4 mr-2" />
            Export GLB (3D Model)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!ifcDataStore}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export CSV
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => handleExportCSV('entities')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Entities
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportCSV('properties')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Properties
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportCSV('quantities')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Quantities
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExportCSV('spatial')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Spatial Hierarchy
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

      {/* Edit Menu - Bulk editing and data import */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={!ifcDataStore}>
                <Pencil className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Edit Properties</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <BulkPropertyEditor
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Filter className="h-4 w-4 mr-2" />
                Bulk Property Editor
              </DropdownMenuItem>
            }
          />
          <DataConnector
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Upload className="h-4 w-4 mr-2" />
                Import Data (CSV)
              </DropdownMenuItem>
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Export Changes Button - shows when there are pending mutations */}
      <ExportChangesButton />

      {/* ── Panels ── */}
      {/* BCF Issues Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={bcfPanelVisible ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              if (!bcfPanelVisible) {
                // Close other right-panel content first, then expand
                setIdsPanelVisible(false);
                setLensPanelVisible(false);
                setRightPanelCollapsed(false);
              }
              toggleBcfPanel();
            }}
            className={cn(bcfPanelVisible && 'bg-primary text-primary-foreground')}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>BCF Issues</TooltipContent>
      </Tooltip>

      {/* IDS Validation Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={idsPanelVisible ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              if (!idsPanelVisible) {
                // Close other right-panel content first, then expand
                setBcfPanelVisible(false);
                setLensPanelVisible(false);
                setRightPanelCollapsed(false);
              }
              toggleIdsPanel();
            }}
            className={cn(idsPanelVisible && 'bg-primary text-primary-foreground')}
          >
            <ClipboardCheck className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>IDS Validation</TooltipContent>
      </Tooltip>

      {/* Lists Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={listPanelVisible ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              // Close script panel (bottom-panel exclusivity)
              useViewerStore.getState().setScriptPanelVisible(false);
              if (!listPanelVisible) {
                setRightPanelCollapsed(false);
              }
              toggleListPanel();
            }}
            className={cn(listPanelVisible && 'bg-primary text-primary-foreground')}
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Lists</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* ── Navigation Tools ── */}
      <ToolButton tool="select" icon={MousePointer2} label="Select" shortcut="V" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="pan" icon={Hand} label="Pan" shortcut="P" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="orbit" icon={Rotate3d} label="Orbit" shortcut="O" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="walk" icon={PersonStanding} label="Walk Mode" shortcut="C" activeTool={activeTool} onToolChange={setActiveTool} />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* ── Measurement & Section ── */}
      <ToolButton tool="measure" icon={Ruler} label="Measure" shortcut="M" activeTool={activeTool} onToolChange={setActiveTool} />
      <ToolButton tool="section" icon={Scissors} label="Section" shortcut="X" activeTool={activeTool} onToolChange={setActiveTool} />

      {/* Floorplan dropdown */}
      {availableStoreys.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <Building2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Quick Floorplan</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            {availableStoreys.map((storey) => (
              <DropdownMenuItem
                key={`${storey.modelId}-${storey.expressId}`}
                onClick={() => activateFloorplan(storey)}
              >
                <Building2 className="h-4 w-4 mr-2" />
                {storey.name}
                <span className="ml-auto text-xs opacity-60">{storey.elevation.toFixed(1)}m</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* ── Basket Presentation ── */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={basketPresentationVisible ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              toggleBasketPresentationVisible();
            }}
            disabled={models.size === 0 && !geometryResult}
            className={cn(
              (basketPresentationVisible || pinboardEntities.size > 0) && 'relative',
            )}
          >
            <LayoutTemplate className="h-4 w-4" />
            {(basketViewCount > 0 || pinboardEntities.size > 0) && (
              <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 border border-background">
                {basketViewCount > 0 ? `${basketViewCount}/${pinboardEntities.size}` : pinboardEntities.size}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Basket Presentation Dock (Views: {basketViewCount}, Entities: {pinboardEntities.size})
        </TooltipContent>
      </Tooltip>

      <ActionButton icon={Equal} label="Isolate (Set Basket)" onClick={handleIsolate} shortcut="I / =" />
      <ActionButton icon={EyeOff} label="Hide Selection" onClick={handleHide} shortcut="Del / Space" disabled={!hasSelection} />
      <ActionButton icon={Eye} label="Show All (Reset Filters)" onClick={handleShowAll} shortcut="A" />
      <ActionButton icon={Maximize2} label="Fit All" onClick={() => cameraCallbacks.fitAll?.()} shortcut="Z" />
      <ActionButton
        icon={Crosshair}
        label="Frame Selection"
        onClick={() => cameraCallbacks.frameSelection?.()}
        shortcut="F"
        disabled={!hasSelection}
      />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={!geometryResult && models.size === 0}>
                <Layers className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Class Visibility</TooltipContent>
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

      {/* Lens (rule-based filtering) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={lensPanelVisible ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              if (!lensPanelVisible) {
                // Close other right-panel content first, then expand
                setBcfPanelVisible(false);
                setIdsPanelVisible(false);
                setRightPanelCollapsed(false);
              }
              toggleLensPanel();
            }}
            className={cn(lensPanelVisible && 'bg-primary text-primary-foreground')}
          >
            <Palette className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Lens (Color Rules)</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* ── Camera & View ── */}
      <ActionButton icon={Home} label="Home (Isometric + Reset Visibility)" onClick={handleHome} shortcut="H" />

      {/* Orthographic / Perspective toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={projectionMode === 'orthographic' ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              toggleProjectionMode();
            }}
            className={cn(projectionMode === 'orthographic' && 'bg-primary text-primary-foreground')}
          >
            <Orbit className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {projectionMode === 'orthographic' ? 'Switch to Perspective' : 'Switch to Orthographic'}
        </TooltipContent>
      </Tooltip>

      {/* Hover Tooltips toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={hoverTooltipsEnabled ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={(e) => {
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

      {/* Preset Views dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Preset Views</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleHome}>
            <Box className="h-4 w-4 mr-2" /> Isometric <span className="ml-auto text-xs opacity-60">H</span>
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
      <div className="flex items-center gap-2 ml-2 pl-2 border-l border-zinc-200 dark:border-zinc-700/60">
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <ThemeSwitch />
            </div>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => onShowShortcuts?.()}
            >
              <HelpCircle className="!h-[22px] !w-[22px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Info (?)</TooltipContent>
        </Tooltip>
      </div>

    </div>
  );
}

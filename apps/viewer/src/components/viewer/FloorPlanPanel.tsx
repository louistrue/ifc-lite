/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FloorPlanPanel - Convert 2D floor plans to 3D buildings
 *
 * Provides:
 * - PDF/image upload for floor plans
 * - Storey ordering with drag-and-drop
 * - Height configuration per storey
 * - Wall/room detection from floor plan images
 * - 3D building generation
 */

import React, { useCallback, useState, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  Play,
  FileImage,
  Layers,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
  Trash2,
  GripVertical,
  Settings2,
  Building2,
  Ruler,
  Eye,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import type { FloorPlanPage, StoreyConfig } from '@/store/slices/floorPlanSlice';
import { useFloorPlanDetection } from '@/hooks/useFloorPlanDetection';

// ============================================================================
// Types
// ============================================================================

interface FloorPlanPanelProps {
  onClose?: () => void;
}

// ============================================================================
// Sortable Storey Item Component
// ============================================================================

interface SortableStoreyItemProps {
  page: FloorPlanPage;
  config: StoreyConfig | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdateHeight: (height: number) => void;
  onUpdateName: (name: string) => void;
}

function SortableStoreyItem({
  page,
  config,
  isSelected,
  onSelect,
  onRemove,
  onUpdateHeight,
  onUpdateName,
}: SortableStoreyItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border transition-colors',
        isDragging && 'opacity-50',
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center gap-2 p-2">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="touch-none p-1 hover:bg-muted rounded cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* Thumbnail */}
          <div
            className="w-12 h-12 bg-muted rounded overflow-hidden shrink-0 cursor-pointer"
            onClick={onSelect}
          >
            {page.thumbnailUrl ? (
              <img
                src={page.thumbnailUrl}
                alt={page.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FileImage className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0" onClick={onSelect}>
            <div className="font-medium text-sm truncate">{page.name}</div>
            <div className="text-xs text-muted-foreground">
              {page.detected ? (
                <span className="text-green-600">
                  {page.walls.length} walls, {page.rooms.length} rooms
                </span>
              ) : (
                <span>Not yet detected</span>
              )}
            </div>
            {config && (
              <div className="text-xs text-muted-foreground">
                Height: {config.height.toFixed(1)}m · Elev: {config.elevation.toFixed(1)}m
              </div>
            )}
          </div>

          {/* Actions */}
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={onRemove}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>

        <CollapsibleContent>
          <Separator />
          <div className="p-3 space-y-3">
            {/* Name input */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Storey Name</label>
              <input
                type="text"
                value={config?.name || page.name}
                onChange={(e) => onUpdateName(e.target.value)}
                className="w-full h-8 px-2 text-sm border rounded bg-background"
              />
            </div>
            {/* Height input */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Floor-to-Floor Height (m)</label>
              <input
                type="number"
                step="0.1"
                min="2.0"
                max="10.0"
                value={config?.height || 3.0}
                onChange={(e) => onUpdateHeight(parseFloat(e.target.value) || 3.0)}
                className="w-full h-8 px-2 text-sm border rounded bg-background"
              />
            </div>
            {/* Scale input */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Scale (pixels/meter)</label>
              <input
                type="number"
                step="1"
                min="10"
                max="1000"
                value={page.scale}
                onChange={() => {/* TODO */}}
                className="w-full h-8 px-2 text-sm border rounded bg-background"
                disabled
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ============================================================================
// Main Panel Component
// ============================================================================

export function FloorPlanPanel({ onClose }: FloorPlanPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store state
  const status = useViewerStore((s) => s.floorPlanStatus);
  const progress = useViewerStore((s) => s.floorPlanProgress);
  const phase = useViewerStore((s) => s.floorPlanPhase);
  const error = useViewerStore((s) => s.floorPlanError);
  const pdfFileName = useViewerStore((s) => s.pdfFileName);
  const floorPlanPages = useViewerStore((s) => s.floorPlanPages);
  const selectedPageId = useViewerStore((s) => s.selectedPageId);
  const storeyConfigs = useViewerStore((s) => s.storeyConfigs);
  const defaultStoreyHeight = useViewerStore((s) => s.defaultStoreyHeight);
  const generatedBuilding = useViewerStore((s) => s.generatedBuilding);

  // Store actions
  const setFloorPlanStatus = useViewerStore((s) => s.setFloorPlanStatus);
  const setFloorPlanProgress = useViewerStore((s) => s.setFloorPlanProgress);
  const setFloorPlanError = useViewerStore((s) => s.setFloorPlanError);
  const setPdfFileName = useViewerStore((s) => s.setPdfFileName);
  const addFloorPlanPage = useViewerStore((s) => s.addFloorPlanPage);
  const updateFloorPlanPage = useViewerStore((s) => s.updateFloorPlanPage);
  const removeFloorPlanPage = useViewerStore((s) => s.removeFloorPlanPage);
  const setSelectedPageId = useViewerStore((s) => s.setSelectedPageId);
  const clearAllPages = useViewerStore((s) => s.clearAllPages);
  const updateStoreyConfig = useViewerStore((s) => s.updateStoreyConfig);
  const reorderStoreys = useViewerStore((s) => s.reorderStoreys);
  const autoCreateStoreyConfigs = useViewerStore((s) => s.autoCreateStoreyConfigs);
  const setGeneratedBuilding = useViewerStore((s) => s.setGeneratedBuilding);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sorted pages based on storey order
  const sortedPages = useMemo(() => {
    const configMap = new Map(storeyConfigs.map((c) => [c.floorPlanId, c]));
    return [...floorPlanPages].sort((a, b) => {
      const orderA = configMap.get(a.id)?.order ?? 999;
      const orderB = configMap.get(b.id)?.order ?? 999;
      return orderA - orderB;
    });
  }, [floorPlanPages, storeyConfigs]);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedPages.findIndex((p) => p.id === active.id);
      const newIndex = sortedPages.findIndex((p) => p.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(sortedPages, oldIndex, newIndex).map((p) => p.id);
        reorderStoreys(newOrder);
      }
    }
  }, [sortedPages, reorderStoreys]);

  // Handle file selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input for re-selection
    e.target.value = '';

    // Check file type
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.name);

    if (!isPdf && !isImage) {
      setFloorPlanError('Please select a PDF or image file');
      return;
    }

    setFloorPlanStatus('loading');
    setFloorPlanProgress(0, 'Loading file...');
    setFloorPlanError(null);

    try {
      if (isPdf) {
        // Load PDF using pdf.js
        const arrayBuffer = await file.arrayBuffer();
        const pdfjs = await import('pdfjs-dist');

        // Set worker source
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        setPdfFileName(file.name);

        // Process each page
        for (let i = 0; i < pdf.numPages; i++) {
          setFloorPlanProgress(((i + 1) / pdf.numPages) * 100, `Processing page ${i + 1}/${pdf.numPages}...`);

          const page = await pdf.getPage(i + 1);
          const viewport = page.getViewport({ scale: 2.0 }); // 2x for good resolution

          // Create canvas for rendering
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;

          await page.render({
            canvasContext: ctx,
            viewport,
          }).promise;

          // Get image data
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Create thumbnail
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 100;
          thumbCanvas.height = 100;
          const thumbCtx = thumbCanvas.getContext('2d')!;
          thumbCtx.drawImage(canvas, 0, 0, 100, 100);
          const thumbnailUrl = thumbCanvas.toDataURL('image/png');

          const pageId = `page-${Date.now()}-${i}`;
          addFloorPlanPage({
            id: pageId,
            pageIndex: i,
            name: `Page ${i + 1}`,
            imageData,
            thumbnailUrl,
            walls: [],
            rooms: [],
            openings: [],
            detected: false,
            scale: 100, // Default: 100 pixels per meter
          });
        }

        // Auto-create storey configs
        autoCreateStoreyConfigs();
        setFloorPlanStatus('ready');
        setFloorPlanProgress(100, 'Done');
      } else {
        // Load image directly
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
        });

        // Create canvas for image data
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Create thumbnail
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 100;
        thumbCanvas.height = 100;
        const thumbCtx = thumbCanvas.getContext('2d')!;
        thumbCtx.drawImage(img, 0, 0, 100, 100);
        const thumbnailUrl = thumbCanvas.toDataURL('image/png');

        URL.revokeObjectURL(img.src);

        const pageId = `page-${Date.now()}-0`;
        setPdfFileName(file.name);
        addFloorPlanPage({
          id: pageId,
          pageIndex: 0,
          name: file.name.replace(/\.[^/.]+$/, ''),
          imageData,
          thumbnailUrl,
          walls: [],
          rooms: [],
          openings: [],
          detected: false,
          scale: 100,
        });

        autoCreateStoreyConfigs();
        setFloorPlanStatus('ready');
        setFloorPlanProgress(100, 'Done');
      }
    } catch (err) {
      setFloorPlanError(err instanceof Error ? err.message : 'Failed to load file');
      setFloorPlanStatus('error');
    }
  }, [
    setPdfFileName,
    addFloorPlanPage,
    autoCreateStoreyConfigs,
    setFloorPlanStatus,
    setFloorPlanProgress,
    setFloorPlanError,
  ]);

  // Floor plan detection hook
  const {
    detectFloorPlan: detectFloorPlanWasm,
    generateBuilding: generateBuildingWasm,
    wasmAvailable,
    detecting: wasmDetecting,
    error: wasmError,
  } = useFloorPlanDetection();

  // Handle detection (wall/room detection from image)
  const handleDetectFloorPlan = useCallback(async (pageId: string) => {
    const page = floorPlanPages.find((p) => p.id === pageId);
    if (!page || !page.imageData) return;

    setFloorPlanStatus('detecting');
    setFloorPlanProgress(0, 'Detecting walls and rooms...');

    try {
      const result = await detectFloorPlanWasm(page);

      if (result) {
        // Update page with detection results
        updateFloorPlanPage(pageId, {
          walls: result.walls,
          rooms: result.rooms,
          openings: result.openings,
          detected: true,
        });
      }

      setFloorPlanStatus('ready');
      setFloorPlanProgress(100, 'Detection complete');
    } catch (err) {
      setFloorPlanError(err instanceof Error ? err.message : 'Detection failed');
      setFloorPlanStatus('error');
    }
  }, [floorPlanPages, detectFloorPlanWasm, updateFloorPlanPage, setFloorPlanStatus, setFloorPlanProgress, setFloorPlanError]);

  // Handle building generation
  const handleGenerateBuilding = useCallback(async () => {
    if (floorPlanPages.length === 0) return;

    setFloorPlanStatus('generating');
    setFloorPlanProgress(0, 'Generating 3D building...');

    try {
      // First, detect all pages that haven't been detected
      for (const page of floorPlanPages) {
        if (!page.detected && page.imageData) {
          await handleDetectFloorPlan(page.id);
        }
      }

      // Generate building using hook
      const building = await generateBuildingWasm(floorPlanPages, storeyConfigs);

      if (building) {
        setGeneratedBuilding(building);
        setFloorPlanStatus('ready');
        setFloorPlanProgress(100, 'Building generated');
      } else {
        setFloorPlanError('Failed to generate building');
        setFloorPlanStatus('error');
      }
    } catch (err) {
      setFloorPlanError(err instanceof Error ? err.message : 'Generation failed');
      setFloorPlanStatus('error');
    }
  }, [floorPlanPages, storeyConfigs, handleDetectFloorPlan, generateBuildingWasm, setGeneratedBuilding, setFloorPlanStatus, setFloorPlanProgress, setFloorPlanError]);

  // Render empty state
  const renderEmptyState = () => {
    if (floorPlanPages.length > 0) return null;

    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <Layers className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-sm mb-2">No Floor Plans</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Upload a PDF or image of your floor plans to generate a 3D building
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Floor Plan
        </Button>
      </div>
    );
  };

  // Render progress
  const renderProgress = () => {
    if (status !== 'loading' && status !== 'detecting' && status !== 'generating') return null;

    return (
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{phase}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
    );
  };

  // Render floor plan list
  const renderFloorPlanList = () => {
    if (floorPlanPages.length === 0) return null;

    const configMap = new Map(storeyConfigs.map((c) => [c.floorPlanId, c]));

    return (
      <>
        {/* Summary */}
        <div className="p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-4 w-4" />
            <span className="font-medium text-sm">
              {floorPlanPages.length} Floor Plan{floorPlanPages.length !== 1 ? 's' : ''}
            </span>
          </div>
          {pdfFileName && (
            <div className="text-xs text-muted-foreground truncate">
              {pdfFileName}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Drag to reorder storeys (bottom to top)
          </p>
        </div>

        {/* Sortable list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedPages.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedPages.map((page) => (
                  <SortableStoreyItem
                    key={page.id}
                    page={page}
                    config={configMap.get(page.id)}
                    isSelected={selectedPageId === page.id}
                    onSelect={() => setSelectedPageId(page.id)}
                    onRemove={() => removeFloorPlanPage(page.id)}
                    onUpdateHeight={(height) => updateStoreyConfig(page.id, { height })}
                    onUpdateName={(name) => updateStoreyConfig(page.id, { name })}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="p-3 border-t space-y-2">
          {/* Generated building info */}
          {generatedBuilding && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <Building2 className="h-4 w-4" />
                <span className="font-medium">Building Generated</span>
              </div>
              <div className="text-xs text-green-600 dark:text-green-500 mt-1">
                {generatedBuilding.storeyCount} storeys · {generatedBuilding.totalHeight.toFixed(1)}m total height
              </div>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleGenerateBuilding}
            disabled={status === 'loading' || status === 'detecting' || status === 'generating'}
          >
            {status === 'generating' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Generate 3D Building
          </Button>

          {generatedBuilding && (
            <Button variant="outline" className="w-full" disabled>
              <Eye className="h-4 w-4 mr-2" />
              Load into Viewer
            </Button>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          <span className="font-medium text-sm">Floor Plan to 3D</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Upload more */}
          {floorPlanPages.length > 0 && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add More</TooltipContent>
              </Tooltip>
            </>
          )}

          {/* Clear all */}
          {floorPlanPages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={clearAllPages}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear All</TooltipContent>
            </Tooltip>
          )}

          {/* Close */}
          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Progress */}
      {renderProgress()}

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {renderEmptyState()}
        {renderFloorPlanList()}
      </div>
    </div>
  );
}

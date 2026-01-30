/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * SheetSetupPanel - Configure drawing sheet for architectural output
 *
 * Provides controls for:
 * - Paper size selection (ISO, ANSI, ARCH)
 * - Drawing frame style
 * - Scale selection
 * - Title block configuration
 * - Scale bar and north arrow
 */

import React, { useCallback, useState, useMemo } from 'react';
import {
  X,
  FileText,
  ChevronDown,
  ChevronRight,
  Ruler,
  Compass,
  Edit3,
  Save,
  Trash2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useViewerStore } from '@/store';
import {
  PAPER_SIZE_REGISTRY,
  FRAME_PRESETS,
  TITLE_BLOCK_PRESETS,
  COMMON_SCALES,
  type FrameStyle,
  type TitleBlockLayout,
  type DrawingScale,
  type ScaleBarStyle,
  type NorthArrowStyle,
} from '@ifc-lite/drawing-2d';

interface SheetSetupPanelProps {
  onClose: () => void;
  onOpenTitleBlockEditor?: () => void;
}

// Group paper sizes by category
const PAPER_SIZE_GROUPS = {
  ISO: ['A0_PORTRAIT', 'A0_LANDSCAPE', 'A1_PORTRAIT', 'A1_LANDSCAPE', 'A2_PORTRAIT', 'A2_LANDSCAPE', 'A3_PORTRAIT', 'A3_LANDSCAPE', 'A4_PORTRAIT', 'A4_LANDSCAPE'],
  ANSI: ['LETTER_PORTRAIT', 'LETTER_LANDSCAPE', 'LEGAL_PORTRAIT', 'LEGAL_LANDSCAPE', 'TABLOID_PORTRAIT', 'TABLOID_LANDSCAPE', 'ANSI_C', 'ANSI_D', 'ANSI_E'],
  ARCH: ['ARCH_A', 'ARCH_B', 'ARCH_C', 'ARCH_D', 'ARCH_E', 'ARCH_E1'],
};

const FRAME_STYLE_OPTIONS: { value: FrameStyle; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'professional', label: 'Professional' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'iso', label: 'ISO Standard' },
];

const TITLE_BLOCK_LAYOUT_OPTIONS: { value: TitleBlockLayout; label: string }[] = [
  { value: 'standard', label: 'Standard (Bottom Right)' },
  { value: 'extended', label: 'Extended (Full Width)' },
  { value: 'compact', label: 'Compact (Smaller)' },
];

const SCALE_BAR_STYLE_OPTIONS: { value: ScaleBarStyle; label: string }[] = [
  { value: 'alternating', label: 'Alternating' },
  { value: 'linear', label: 'Linear' },
  { value: 'single', label: 'Single Bar' },
  { value: 'graphic', label: 'Graphic' },
];

const NORTH_ARROW_STYLE_OPTIONS: { value: NorthArrowStyle; label: string }[] = [
  { value: 'simple', label: 'Simple Arrow' },
  { value: 'compass', label: 'Compass Rose' },
  { value: 'decorative', label: 'Decorative' },
  { value: 'none', label: 'None' },
];

export function SheetSetupPanel({ onClose, onOpenTitleBlockEditor }: SheetSetupPanelProps): React.ReactElement {
  const activeSheet = useViewerStore((s) => s.activeSheet);
  const sheetEnabled = useViewerStore((s) => s.sheetEnabled);
  const setSheetEnabled = useViewerStore((s) => s.setSheetEnabled);
  const createSheet = useViewerStore((s) => s.createSheet);
  const setPaperSize = useViewerStore((s) => s.setPaperSize);
  const setFrameStyle = useViewerStore((s) => s.setFrameStyle);
  const setDrawingScale = useViewerStore((s) => s.setDrawingScale);
  const setTitleBlockLayout = useViewerStore((s) => s.setTitleBlockLayout);
  const updateScaleBar = useViewerStore((s) => s.updateScaleBar);
  const toggleScaleBar = useViewerStore((s) => s.toggleScaleBar);
  const updateNorthArrow = useViewerStore((s) => s.updateNorthArrow);
  const savedSheetTemplates = useViewerStore((s) => s.savedSheetTemplates);
  const saveAsTemplate = useViewerStore((s) => s.saveAsTemplate);
  const loadTemplate = useViewerStore((s) => s.loadTemplate);
  const deleteTemplate = useViewerStore((s) => s.deleteTemplate);

  // Section state
  const [paperSizeOpen, setPaperSizeOpen] = useState(true);
  const [frameOpen, setFrameOpen] = useState(true);
  const [scaleOpen, setScaleOpen] = useState(true);
  const [titleBlockOpen, setTitleBlockOpen] = useState(true);
  const [scaleBarOpen, setScaleBarOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Get current paper size ID
  const currentPaperId = useMemo(() => {
    if (!activeSheet) return 'A3_LANDSCAPE';
    const paper = activeSheet.paper;
    // Find matching paper in registry
    for (const [id, def] of Object.entries(PAPER_SIZE_REGISTRY)) {
      if (def.widthMm === paper.widthMm && def.heightMm === paper.heightMm) {
        return id;
      }
    }
    return 'A3_LANDSCAPE';
  }, [activeSheet]);

  // Initialize sheet if needed
  const handleEnableSheet = useCallback((enabled: boolean) => {
    if (enabled && !activeSheet) {
      createSheet();
    }
    setSheetEnabled(enabled);
  }, [activeSheet, createSheet, setSheetEnabled]);

  // Paper size change
  const handlePaperSizeChange = useCallback((paperId: string) => {
    setPaperSize(paperId);
  }, [setPaperSize]);

  // Frame style change
  const handleFrameStyleChange = useCallback((style: string) => {
    setFrameStyle(style as FrameStyle);
  }, [setFrameStyle]);

  // Scale change
  const handleScaleChange = useCallback((scaleName: string) => {
    const scale = COMMON_SCALES.find((s) => s.name === scaleName);
    if (scale) {
      setDrawingScale(scale);
    }
  }, [setDrawingScale]);

  // Title block layout change
  const handleTitleBlockLayoutChange = useCallback((layout: string) => {
    setTitleBlockLayout(layout as TitleBlockLayout);
  }, [setTitleBlockLayout]);

  // Scale bar style change
  const handleScaleBarStyleChange = useCallback((style: string) => {
    updateScaleBar({ style: style as ScaleBarStyle });
  }, [updateScaleBar]);

  // North arrow style change
  const handleNorthArrowStyleChange = useCallback((style: string) => {
    updateNorthArrow({ style: style as NorthArrowStyle });
  }, [updateNorthArrow]);

  // Save template
  const handleSaveTemplate = useCallback(() => {
    if (newTemplateName.trim()) {
      saveAsTemplate(newTemplateName.trim());
      setNewTemplateName('');
    }
  }, [newTemplateName, saveAsTemplate]);

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm">Drawing Sheet</h2>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={sheetEnabled}
            onCheckedChange={handleEnableSheet}
          />
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!activeSheet && !sheetEnabled ? (
          <div className="p-4 text-center text-muted-foreground">
            <p className="text-sm">Enable drawing sheet to configure paper size, frame, and title block.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => handleEnableSheet(true)}
            >
              Enable Sheet
            </Button>
          </div>
        ) : (
          <>
            {/* Paper Size Section */}
            <Collapsible open={paperSizeOpen} onOpenChange={setPaperSizeOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <span className="text-sm font-medium">Paper Size</span>
                  {paperSizeOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  <Select value={currentPaperId} onValueChange={handlePaperSizeChange}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAPER_SIZE_GROUPS).map(([group, ids]) => (
                        <React.Fragment key={group}>
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                            {group}
                          </div>
                          {ids.filter((id) => id in PAPER_SIZE_REGISTRY).map((id) => {
                            const paper = PAPER_SIZE_REGISTRY[id];
                            return (
                              <SelectItem key={id} value={id}>
                                {paper.name} ({paper.widthMm}×{paper.heightMm}mm)
                              </SelectItem>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>

                  {activeSheet && (
                    <div className="text-xs text-muted-foreground">
                      {activeSheet.paper.widthMm} × {activeSheet.paper.heightMm} mm
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Frame Section */}
            <Collapsible open={frameOpen} onOpenChange={setFrameOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <span className="text-sm font-medium">Frame Style</span>
                  {frameOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  <Select
                    value={activeSheet?.frame.style || 'professional'}
                    onValueChange={handleFrameStyleChange}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FRAME_STYLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {activeSheet && (
                    <div className="text-xs text-muted-foreground">
                      Margins: {activeSheet.frame.margins.top}/{activeSheet.frame.margins.right}/{activeSheet.frame.margins.bottom}/{activeSheet.frame.margins.left}mm
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Scale Section */}
            <Collapsible open={scaleOpen} onOpenChange={setScaleOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Drawing Scale</span>
                  </div>
                  {scaleOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  <Select
                    value={activeSheet?.scale.name || '1:100'}
                    onValueChange={handleScaleChange}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_SCALES.map((scale) => (
                        <SelectItem key={scale.name} value={scale.name}>
                          {scale.name} - {scale.useCase}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Title Block Section */}
            <Collapsible open={titleBlockOpen} onOpenChange={setTitleBlockOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <span className="text-sm font-medium">Title Block</span>
                  {titleBlockOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <Label className="text-xs">Layout</Label>
                    <Select
                      value={activeSheet?.titleBlock.layout || 'standard'}
                      onValueChange={handleTitleBlockLayoutChange}
                    >
                      <SelectTrigger className="h-8 text-sm mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TITLE_BLOCK_LAYOUT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {activeSheet && (
                    <div className="text-xs text-muted-foreground">
                      {activeSheet.titleBlock.widthMm} × {activeSheet.titleBlock.heightMm}mm
                      <br />
                      {activeSheet.titleBlock.fields.length} fields configured
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={onOpenTitleBlockEditor}
                  >
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit Title Block Fields
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Scale Bar & North Arrow Section */}
            <Collapsible open={scaleBarOpen} onOpenChange={setScaleBarOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <div className="flex items-center gap-2">
                    <Compass className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Scale Bar & North Arrow</span>
                  </div>
                  {scaleBarOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-4">
                  {/* Scale Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Scale Bar</Label>
                      <Switch
                        checked={activeSheet?.scaleBar.visible ?? true}
                        onCheckedChange={toggleScaleBar}
                      />
                    </div>

                    {activeSheet?.scaleBar.visible && (
                      <Select
                        value={activeSheet.scaleBar.style}
                        onValueChange={handleScaleBarStyleChange}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCALE_BAR_STYLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* North Arrow */}
                  <div className="space-y-2">
                    <Label className="text-xs">North Arrow</Label>
                    <Select
                      value={activeSheet?.northArrow.style || 'simple'}
                      onValueChange={handleNorthArrowStyleChange}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NORTH_ARROW_STYLE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Templates Section */}
            <Collapsible open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors border-b">
                  <span className="text-sm font-medium">Saved Templates</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {savedSheetTemplates.length}
                    </span>
                    {templatesOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  {/* Save current as template */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Template name..."
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveTemplate}
                      disabled={!newTemplateName.trim() || !activeSheet}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Template list */}
                  {savedSheetTemplates.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-2">
                      No saved templates
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {savedSheetTemplates.map((template) => (
                        <div
                          key={template.id}
                          className="flex items-center justify-between px-2 py-1.5 bg-muted/30 rounded text-xs"
                        >
                          <span className="truncate flex-1">{template.name}</span>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-6 w-6"
                              onClick={() => loadTemplate(template.id)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => deleteTemplate(template.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Viewport Info */}
            {activeSheet && (
              <div className="px-4 py-3 border-t">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    <strong>Drawing Area:</strong>{' '}
                    {activeSheet.viewportBounds.width.toFixed(1)} ×{' '}
                    {activeSheet.viewportBounds.height.toFixed(1)} mm
                  </div>
                  <div>
                    <strong>Scale:</strong> {activeSheet.scale.name}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

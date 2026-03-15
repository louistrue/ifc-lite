/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DrawingSettingsPanel - Full control over 2D drawing graphic styles
 *
 * Provides:
 * - Preset selection dropdown
 * - Custom rule editor
 * - Color, line weight, hatch controls
 */

import React, { useCallback, useState, useMemo } from 'react';
import { X, Palette, Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Eye, EyeOff, Check, Copy, PenTool, Flame, Building2, Wrench, Printer, Layers, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { GraphicOverrideRule, GraphicStyle } from '@ifc-lite/drawing-2d';
import { DEFAULT_OBJECT_STYLES, resolveObjectStyle, type ObjectStylesConfig } from '@ifc-lite/drawing-2d';

// Common IFC types for the dropdown
const COMMON_IFC_TYPES = [
  'IfcWall',
  'IfcWallStandardCase',
  'IfcSlab',
  'IfcColumn',
  'IfcBeam',
  'IfcDoor',
  'IfcWindow',
  'IfcStair',
  'IfcRoof',
  'IfcRailing',
  'IfcCovering',
  'IfcFurnishingElement',
  'IfcSpace',
  'IfcBuildingElementProxy',
];

// Line weight presets
const LINE_WEIGHTS = [
  { value: 'heavy', label: 'Heavy (0.5mm)' },
  { value: 'medium', label: 'Medium (0.35mm)' },
  { value: 'light', label: 'Light (0.25mm)' },
  { value: 'hairline', label: 'Hairline (0.18mm)' },
];

// Icon mapping for presets
const PRESET_ICONS: Record<string, LucideIcon> = {
  Palette,
  PenTool,
  Flame,
  Building2,
  Wrench,
  Printer,
};

function PresetIcon({ iconName, className }: { iconName?: string; className?: string }) {
  const Icon = iconName ? PRESET_ICONS[iconName] : Palette;
  if (!Icon) return <Palette className={className} />;
  return <Icon className={className} />;
}

interface DrawingSettingsPanelProps {
  onClose: () => void;
}

export function DrawingSettingsPanel({ onClose }: DrawingSettingsPanelProps) {
  const graphicOverridePresets = useViewerStore((s) => s.graphicOverridePresets);
  const activePresetId = useViewerStore((s) => s.activePresetId);
  const setActivePreset = useViewerStore((s) => s.setActivePreset);
  const customOverrideRules = useViewerStore((s) => s.customOverrideRules);
  const addCustomRule = useViewerStore((s) => s.addCustomRule);
  const updateCustomRule = useViewerStore((s) => s.updateCustomRule);
  const removeCustomRule = useViewerStore((s) => s.removeCustomRule);
  const overridesEnabled = useViewerStore((s) => s.overridesEnabled);
  const toggleOverridesEnabled = useViewerStore((s) => s.toggleOverridesEnabled);

  // Object Styles state
  const objectStyleOverrides = useViewerStore((s) => s.objectStyleOverrides);
  const setObjectStyleOverride = useViewerStore((s) => s.setObjectStyleOverride);
  const resetObjectStyleOverride = useViewerStore((s) => s.resetObjectStyleOverride);
  const resetAllObjectStyleOverrides = useViewerStore((s) => s.resetAllObjectStyleOverrides);

  // Active tab: 'overrides' | 'object-styles'
  const [activeTab, setActiveTab] = useState<'overrides' | 'object-styles'>('object-styles');

  // Expanded sections
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [customRulesOpen, setCustomRulesOpen] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Get the active preset's rules for display
  const activePreset = useMemo(() => {
    if (!activePresetId) return null;
    return graphicOverridePresets.find((p) => p.id === activePresetId) ?? null;
  }, [activePresetId, graphicOverridePresets]);

  // Add new custom rule
  const handleAddRule = useCallback(() => {
    const newRule: GraphicOverrideRule = {
      id: `custom-${Date.now()}`,
      name: 'New Rule',
      enabled: true,
      priority: customOverrideRules.length + 100, // Start after presets
      criteria: {
        type: 'ifcType',
        ifcTypes: ['IfcWall'],
        includeSubtypes: true,
      },
      style: {
        fillColor: '#808080',
        strokeColor: '#000000',
      },
    };
    addCustomRule(newRule);
    setEditingRuleId(newRule.id);
  }, [customOverrideRules.length, addCustomRule]);

  // Copy preset rules to custom rules for editing
  const handleCopyPresetToCustom = useCallback(() => {
    if (!activePreset) return;

    // Copy each rule from preset to custom with new IDs
    for (const rule of activePreset.rules) {
      const newRule: GraphicOverrideRule = {
        ...rule,
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        priority: customOverrideRules.length + 100,
      };
      addCustomRule(newRule);
    }

    // Clear preset selection and expand custom rules
    setActivePreset(null);
    setCustomRulesOpen(true);
  }, [activePreset, customOverrideRules.length, addCustomRule, setActivePreset]);

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm">Drawing Settings</h2>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'overrides' && (
            <Button
              variant={overridesEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={toggleOverridesEnabled}
              className="h-7 text-xs"
            >
              {overridesEnabled ? 'Enabled' : 'Disabled'}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'object-styles'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('object-styles')}
        >
          <Layers className="h-3.5 w-3.5" />
          Object Styles
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'overrides'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('overrides')}
        >
          <Palette className="h-3.5 w-3.5" />
          Overrides
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── OBJECT STYLES TAB ─────────────────────────────── */}
        {activeTab === 'object-styles' && (
          <ObjectStylesEditor
            overrides={objectStyleOverrides}
            onSetOverride={setObjectStyleOverride}
            onResetOverride={resetObjectStyleOverride}
            onResetAll={resetAllObjectStyleOverrides}
          />
        )}

        {/* ── GRAPHIC OVERRIDES TAB ─────────────────────────── */}
        {activeTab === 'overrides' && (
          <>
        {/* Presets Section */}
        <Collapsible open={presetsOpen} onOpenChange={setPresetsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors">
              <span className="text-sm font-medium">Style Presets</span>
              {presetsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-3 space-y-1">
              {/* Built-in presets */}
              {graphicOverridePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-sm ${
                    activePresetId === preset.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted text-foreground'
                  }`}
                  onClick={() => setActivePreset(preset.id)}
                >
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${activePresetId === preset.id ? 'bg-primary/20' : 'bg-muted'}`}>
                    <PresetIcon iconName={preset.icon} className="h-3.5 w-3.5" />
                  </div>
                  <span className="flex-1 text-left font-medium">{preset.name}</span>
                  {activePresetId === preset.id && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Active Preset Rules (read-only with edit option) */}
        {activePreset && activePreset.rules.length > 0 && (
          <div className="border-t">
            <div className="px-4 py-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {activePreset.name} Rules
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={handleCopyPresetToCustom}
                title="Copy rules to custom for editing"
              >
                <Copy className="h-3 w-3 mr-1" />
                Edit as Custom
              </Button>
            </div>
            <div className="px-4 pb-4 space-y-1">
              {activePreset.rules.map((rule) => (
                <PresetRuleItem key={rule.id} rule={rule} />
              ))}
            </div>
          </div>
        )}

        {/* Custom Rules Section */}
        <Collapsible open={customRulesOpen} onOpenChange={setCustomRulesOpen}>
          <div className="border-t">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors">
                <span className="text-sm font-medium">Custom Rules</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {customOverrideRules.length} rules
                  </span>
                  {customRulesOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-2">
                {customOverrideRules.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    No custom rules yet
                  </div>
                ) : (
                  customOverrideRules.map((rule) => (
                    <CustomRuleItem
                      key={rule.id}
                      rule={rule}
                      isEditing={editingRuleId === rule.id}
                      onEdit={() => setEditingRuleId(rule.id)}
                      onSave={() => setEditingRuleId(null)}
                      onUpdate={(updates) => updateCustomRule(rule.id, updates)}
                      onRemove={() => removeCustomRule(rule.id)}
                    />
                  ))
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleAddRule}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Custom Rule
                </Button>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
        </>
        )}

      </div>
    </div>
  );
}

// Read-only preset rule display
function PresetRuleItem({ rule }: { rule: GraphicOverrideRule }) {
  // Extract IFC types from criteria
  const ifcTypes = useMemo(() => {
    if ('ifcTypes' in rule.criteria && rule.criteria.ifcTypes) {
      return rule.criteria.ifcTypes.join(', ');
    }
    if ('conditions' in rule.criteria) {
      // Find ifcType criteria in conditions
      for (const condition of rule.criteria.conditions) {
        if ('ifcTypes' in condition && condition.ifcTypes) {
          return condition.ifcTypes.join(', ');
        }
      }
    }
    return 'All';
  }, [rule.criteria]);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded text-xs">
      {rule.style.fillColor && (
        <div
          className="w-4 h-4 rounded border border-black/20"
          style={{ backgroundColor: rule.style.fillColor }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{rule.name}</div>
        <div className="text-muted-foreground truncate">{ifcTypes}</div>
      </div>
    </div>
  );
}

// Editable custom rule
interface CustomRuleItemProps {
  rule: GraphicOverrideRule;
  isEditing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onUpdate: (updates: Partial<GraphicOverrideRule>) => void;
  onRemove: () => void;
}

function CustomRuleItem({
  rule,
  isEditing,
  onEdit,
  onSave,
  onUpdate,
  onRemove,
}: CustomRuleItemProps) {
  // Extract IFC types
  const ifcTypes = useMemo(() => {
    if ('ifcTypes' in rule.criteria && rule.criteria.ifcTypes) {
      return rule.criteria.ifcTypes;
    }
    return [];
  }, [rule.criteria]);

  const handleIfcTypeChange = useCallback(
    (type: string) => {
      onUpdate({
        criteria: {
          type: 'ifcType',
          ifcTypes: [type],
          includeSubtypes: true,
        },
      });
    },
    [onUpdate]
  );

  const handleStyleChange = useCallback(
    (key: keyof GraphicStyle, value: string | number | undefined) => {
      onUpdate({
        style: {
          ...rule.style,
          [key]: value,
        },
      });
    },
    [rule.style, onUpdate]
  );

  if (!isEditing) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded text-xs cursor-pointer hover:bg-muted/50"
        onClick={onEdit}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
        {rule.style.fillColor && (
          <div
            className="w-4 h-4 rounded border border-black/20"
            style={{ backgroundColor: rule.style.fillColor }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{rule.name}</div>
          <div className="text-muted-foreground truncate">
            {ifcTypes.join(', ') || 'Click to edit'}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ enabled: !rule.enabled });
          }}
        >
          {rule.enabled ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-3 bg-muted/30 rounded-lg border space-y-3">
      {/* Name */}
      <div>
        <Label className="text-xs">Rule Name</Label>
        <Input
          value={rule.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="h-8 text-sm mt-1"
        />
      </div>

      {/* IFC Class */}
      <div>
        <Label className="text-xs">IFC Class</Label>
        <Select
          value={ifcTypes[0] || ''}
          onValueChange={handleIfcTypeChange}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue placeholder="Select class..." />
          </SelectTrigger>
          <SelectContent>
            {COMMON_IFC_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Fill Color</Label>
          <div className="flex gap-1 mt-1">
            <input
              type="color"
              value={rule.style.fillColor || '#808080'}
              onChange={(e) => handleStyleChange('fillColor', e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <Input
              value={rule.style.fillColor || '#808080'}
              onChange={(e) => handleStyleChange('fillColor', e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Stroke Color</Label>
          <div className="flex gap-1 mt-1">
            <input
              type="color"
              value={rule.style.strokeColor || '#000000'}
              onChange={(e) => handleStyleChange('strokeColor', e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <Input
              value={rule.style.strokeColor || '#000000'}
              onChange={(e) => handleStyleChange('strokeColor', e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
          </div>
        </div>
      </div>

      {/* Line Weight - preset or custom mm value */}
      <div>
        <Label className="text-xs">Line Weight</Label>
        <div className="flex gap-2 mt-1">
          <Select
            value={typeof rule.style.lineWeight === 'string' ? rule.style.lineWeight : 'custom'}
            onValueChange={(v) => {
              if (v === 'custom') {
                handleStyleChange('lineWeight', 0.35); // Default to 0.35mm
              } else {
                handleStyleChange('lineWeight', v);
              }
            }}
          >
            <SelectTrigger className="h-8 text-sm flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINE_WEIGHTS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom...</SelectItem>
            </SelectContent>
          </Select>
          {typeof rule.style.lineWeight === 'number' && (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0.05}
                max={2}
                step={0.05}
                value={rule.style.lineWeight}
                onChange={(e) => handleStyleChange('lineWeight', parseFloat(e.target.value) || 0.35)}
                className="h-8 w-16 text-xs"
              />
              <span className="text-xs text-muted-foreground">mm</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>
        <Button size="sm" onClick={onSave}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OBJECT STYLES EDITOR
// Per-IFC-category line weight, color, hatch configurator (Revit-style).
// ─────────────────────────────────────────────────────────────────────────────

const HATCH_LABELS: Record<string, string> = {
  none: 'None',
  diagonal: 'Diagonal lines',
  cross: 'Cross hatching',
  horizontal: 'Horizontal lines',
  vertical: 'Vertical lines',
  concrete: 'Concrete (dots)',
  brick: 'Brick pattern',
};

interface ObjectStylesEditorProps {
  overrides: Partial<ObjectStylesConfig>;
  onSetOverride: (ifcType: string, style: Record<string, unknown>) => void;
  onResetOverride: (ifcType: string) => void;
  onResetAll: () => void;
}

function ObjectStylesEditor({ overrides, onSetOverride, onResetOverride, onResetAll }: ObjectStylesEditorProps) {
  const ifcTypes = Object.keys(DEFAULT_OBJECT_STYLES);
  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">Per-category line weights, colors & hatches</span>
        {hasOverrides && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={onResetAll}>
            Reset All
          </Button>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[minmax(80px,1fr)_32px_40px_52px_56px_24px] gap-1 px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b">
        <span>Category</span>
        <span>Vis</span>
        <span>Color</span>
        <span>Weight</span>
        <span>Hatch</span>
        <span></span>
      </div>

      {/* Rows */}
      <div className="overflow-y-auto flex-1">
        {ifcTypes.map((ifcType) => {
          const resolved = resolveObjectStyle(ifcType, overrides);
          const isOverridden = !!overrides[ifcType];
          return (
            <ObjectStyleRow
              key={ifcType}
              ifcType={ifcType}
              style={resolved}
              isOverridden={isOverridden}
              onUpdate={(updates) => onSetOverride(ifcType, updates)}
              onReset={() => onResetOverride(ifcType)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ObjectStyleRowProps {
  ifcType: string;
  style: ReturnType<typeof resolveObjectStyle>;
  isOverridden: boolean;
  onUpdate: (updates: Record<string, unknown>) => void;
  onReset: () => void;
}

function ObjectStyleRow({ ifcType, style, isOverridden, onUpdate, onReset }: ObjectStyleRowProps) {
  const label = ifcType.replace('Ifc', '');
  const hatchPattern = style.hatch?.pattern ?? 'none';

  return (
    <div className={`grid grid-cols-[minmax(80px,1fr)_32px_40px_52px_56px_24px] gap-1 items-center px-3 py-1.5 border-b border-muted/50 hover:bg-muted/20 ${isOverridden ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''}`}>
      {/* Category label */}
      <span className="text-xs font-medium truncate" title={ifcType}>{label}</span>

      {/* Visibility toggle */}
      <button
        className={`w-7 h-6 flex items-center justify-center rounded transition-colors ${style.visible ? 'text-foreground' : 'text-muted-foreground/40'}`}
        title={style.visible ? 'Visible — click to hide' : 'Hidden — click to show'}
        onClick={() => onUpdate({ visible: !style.visible })}
      >
        {style.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>

      {/* Cut line color swatch */}
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={style.cutLines.lineColor}
          title="Cut line color"
          onChange={(e) => onUpdate({ cutLines: { ...style.cutLines, lineColor: e.target.value } })}
          className="w-6 h-6 rounded border cursor-pointer p-0"
        />
      </div>

      {/* Line weight (mm) */}
      <input
        type="number"
        min={0.05}
        max={2.0}
        step={0.05}
        value={style.cutLines.lineWeight}
        title="Cut line weight (mm)"
        onChange={(e) => onUpdate({ cutLines: { ...style.cutLines, lineWeight: parseFloat(e.target.value) || 0.25 } })}
        className="w-12 h-6 text-xs font-mono text-center border rounded bg-background"
      />

      {/* Hatch pattern */}
      <select
        value={hatchPattern}
        title="Hatch pattern"
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'none') {
            onUpdate({ hatch: null });
          } else {
            onUpdate({ hatch: { ...(style.hatch ?? { spacing: 3, angle: 45, lineColor: '#000000', lineWeight: 0.18 }), pattern: val } });
          }
        }}
        className="h-6 text-[10px] border rounded bg-background px-1 truncate"
      >
        {Object.entries(HATCH_LABELS).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>

      {/* Reset button */}
      <button
        className={`w-6 h-6 flex items-center justify-center rounded transition-opacity ${isOverridden ? 'opacity-100 text-muted-foreground hover:text-destructive' : 'opacity-0 pointer-events-none'}`}
        title="Reset to default"
        onClick={onReset}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

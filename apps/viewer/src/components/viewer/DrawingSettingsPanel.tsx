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
import { X, Palette, Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Eye, EyeOff, Check } from 'lucide-react';
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

// Hatch patterns
const HATCH_PATTERNS = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid Fill' },
  { value: 'diagonal', label: 'Diagonal Lines' },
  { value: 'cross-hatch', label: 'Cross Hatch' },
  { value: 'dots', label: 'Dots' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'brick', label: 'Brick' },
  { value: 'insulation', label: 'Insulation' },
];

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

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm">Drawing Settings</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={overridesEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={toggleOverridesEnabled}
            className="h-7 text-xs"
          >
            {overridesEnabled ? 'Enabled' : 'Disabled'}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
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
            <div className="px-4 pb-4 space-y-2">
              {/* Default option */}
              <button
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
                  activePresetId === null
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent hover:bg-muted'
                }`}
                onClick={() => setActivePreset(null)}
              >
                <span className="text-lg">📐</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">Default</div>
                  <div className="text-xs text-muted-foreground">IFC type-based colors</div>
                </div>
                {activePresetId === null && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </button>

              {/* Built-in presets */}
              {graphicOverridePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
                    activePresetId === preset.id
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent hover:bg-muted'
                  }`}
                  onClick={() => setActivePreset(preset.id)}
                >
                  <span className="text-lg">{preset.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {preset.rules.length} rules
                    </div>
                  </div>
                  {activePresetId === preset.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Active Preset Rules (read-only) */}
        {activePreset && (
          <div className="border-t">
            <div className="px-4 py-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {activePreset.name} Rules
              </h3>
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

      {/* IFC Type */}
      <div>
        <Label className="text-xs">IFC Type</Label>
        <Select
          value={ifcTypes[0] || ''}
          onValueChange={handleIfcTypeChange}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue placeholder="Select type..." />
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

      {/* Line Weight */}
      <div>
        <Label className="text-xs">Line Weight</Label>
        <Select
          value={typeof rule.style.lineWeight === 'string' ? rule.style.lineWeight : 'medium'}
          onValueChange={(v) => handleStyleChange('lineWeight', v)}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_WEIGHTS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Hatch Pattern */}
      <div>
        <Label className="text-xs">Hatch Pattern</Label>
        <Select
          value={rule.style.hatchPattern || 'none'}
          onValueChange={(v) => handleStyleChange('hatchPattern', v === 'none' ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HATCH_PATTERNS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

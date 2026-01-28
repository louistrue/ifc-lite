/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property Editor component for editing IFC property values inline.
 * Production-ready with keyboard support and proper UX.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Save,
  X,
  Plus,
  Trash2,
  PenLine,
  Undo,
  Redo,
  Check,
} from 'lucide-react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { PropertyValueType } from '@ifc-lite/data';
import type { PropertyValue } from '@ifc-lite/mutations';

interface PropertyEditorProps {
  modelId: string;
  entityId: number;
  psetName: string;
  propName: string;
  currentValue: unknown;
  currentType?: PropertyValueType;
  onClose?: () => void;
}

/**
 * Inline property value editor with pen icon on the right.
 * Supports keyboard: Enter to save, Escape to cancel.
 */
export function PropertyEditor({
  modelId,
  entityId,
  psetName,
  propName,
  currentValue,
  currentType = PropertyValueType.String,
  onClose,
}: PropertyEditorProps) {
  const setProperty = useViewerStore((s) => s.setProperty);
  const deleteProperty = useViewerStore((s) => s.deleteProperty);
  const bumpMutationVersion = useViewerStore((s) => s.bumpMutationVersion);

  const [value, setValue] = useState<string>(formatValue(currentValue));
  const [valueType, setValueType] = useState<PropertyValueType>(detectValueType(currentValue, currentType));
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const parsedValue = parseValue(value, valueType);

    // Normalize model ID for legacy models
    let normalizedModelId = modelId;
    if (modelId === 'legacy') {
      normalizedModelId = '__legacy__';
    }

    setProperty(normalizedModelId, entityId, psetName, propName, parsedValue, valueType);
    bumpMutationVersion();
    setIsEditing(false);
    onClose?.();
  }, [modelId, entityId, psetName, propName, value, valueType, setProperty, bumpMutationVersion, onClose]);

  const handleDelete = useCallback(() => {
    // Normalize model ID for legacy models
    let normalizedModelId = modelId;
    if (modelId === 'legacy') {
      normalizedModelId = '__legacy__';
    }

    deleteProperty(normalizedModelId, entityId, psetName, propName);
    bumpMutationVersion();
    setIsEditing(false);
    onClose?.();
  }, [modelId, entityId, psetName, propName, deleteProperty, bumpMutationVersion, onClose]);

  const handleCancel = useCallback(() => {
    setValue(formatValue(currentValue));
    setValueType(detectValueType(currentValue, currentType));
    setIsEditing(false);
    onClose?.();
  }, [currentValue, currentType, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  const displayValue = formatDisplayValue(currentValue);

  // Non-editing view: value with pen icon on right (always visible)
  if (!isEditing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="font-mono text-zinc-900 dark:text-zinc-100 select-all break-words flex-1 min-w-0 cursor-text"
          onClick={() => setIsEditing(true)}
          title="Click to edit"
        >
          {displayValue}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 hover:bg-purple-100 dark:hover:bg-purple-900/30"
              onClick={() => setIsEditing(true)}
            >
              <PenLine className="h-3 w-3 text-purple-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Edit property</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Editing view: inline input with type selector and action buttons
  return (
    <div className="flex flex-col gap-2 p-2 -mx-2 bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded">
      {/* Value input */}
      <div className="flex items-center gap-2">
        {valueType === PropertyValueType.Boolean || valueType === PropertyValueType.Logical ? (
          <div className="flex items-center gap-2 flex-1">
            <Switch
              checked={value === 'true'}
              onCheckedChange={(checked) => setValue(checked ? 'true' : 'false')}
            />
            <span className="text-xs text-zinc-500">{value === 'true' ? 'True' : 'False'}</span>
          </div>
        ) : (
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-7 text-xs font-mono flex-1 bg-white dark:bg-zinc-900"
            placeholder="Enter value"
            type={valueType === PropertyValueType.Real || valueType === PropertyValueType.Integer ? 'number' : 'text'}
            step={valueType === PropertyValueType.Real ? 'any' : undefined}
          />
        )}

        {/* Action buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-green-100 dark:hover:bg-green-900/30"
              onClick={handleSave}
            >
              <Check className="h-3.5 w-3.5 text-green-600" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save (Enter)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onClick={handleCancel}
            >
              <X className="h-3.5 w-3.5 text-zinc-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel (Esc)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-red-100 dark:hover:bg-red-900/30"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete property</TooltipContent>
        </Tooltip>
      </div>

      {/* Type selector - always visible */}
      <div className="flex flex-wrap gap-1">
        {[
          { type: PropertyValueType.String, label: 'String' },
          { type: PropertyValueType.Label, label: 'Label' },
          { type: PropertyValueType.Identifier, label: 'ID' },
          { type: PropertyValueType.Real, label: 'Real' },
          { type: PropertyValueType.Integer, label: 'Int' },
          { type: PropertyValueType.Boolean, label: 'Bool' },
        ].map(({ type, label }) => (
          <Button
            key={type}
            variant={valueType === type ? 'default' : 'outline'}
            size="sm"
            className="h-5 px-2 text-[10px]"
            onClick={() => {
              setValueType(type);
              // Convert value if switching to/from boolean
              if (type === PropertyValueType.Boolean || type === PropertyValueType.Logical) {
                const boolVal = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
                setValue(boolVal ? 'true' : 'false');
              }
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface NewPropertyDialogProps {
  modelId: string;
  entityId: number;
  existingPsets: string[];
}

/**
 * Dialog for adding a new property
 */
export function NewPropertyDialog({ modelId, entityId, existingPsets }: NewPropertyDialogProps) {
  const setProperty = useViewerStore((s) => s.setProperty);
  const createPropertySet = useViewerStore((s) => s.createPropertySet);
  const bumpMutationVersion = useViewerStore((s) => s.bumpMutationVersion);

  const [open, setOpen] = useState(false);
  const [psetName, setPsetName] = useState('');
  const [isNewPset, setIsNewPset] = useState(false);
  const [propName, setPropName] = useState('');
  const [value, setValue] = useState('');
  const [valueType, setValueType] = useState<PropertyValueType>(PropertyValueType.String);

  const commonPsets = useMemo(() => [
    'Pset_WallCommon',
    'Pset_DoorCommon',
    'Pset_WindowCommon',
    'Pset_SlabCommon',
    'Pset_BeamCommon',
    'Pset_ColumnCommon',
    'Pset_BuildingElementProxyCommon',
    'Pset_SpaceCommon',
  ], []);

  const handleSubmit = useCallback(() => {
    if (!psetName || !propName) return;

    // Normalize model ID for legacy models
    let normalizedModelId = modelId;
    if (modelId === 'legacy') {
      normalizedModelId = '__legacy__';
    }

    const parsedValue = parseValue(value, valueType);

    if (isNewPset) {
      createPropertySet(normalizedModelId, entityId, psetName, [
        { name: propName, value: parsedValue, type: valueType },
      ]);
    } else {
      setProperty(normalizedModelId, entityId, psetName, propName, parsedValue, valueType);
    }

    bumpMutationVersion();

    // Reset form
    setPsetName('');
    setPropName('');
    setValue('');
    setValueType(PropertyValueType.String);
    setIsNewPset(false);
    setOpen(false);
  }, [modelId, entityId, psetName, propName, value, valueType, isNewPset, setProperty, createPropertySet, bumpMutationVersion]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <Plus className="h-3 w-3 mr-1" />
          Add Property
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Property</DialogTitle>
          <DialogDescription>
            Add a new property to this entity
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center gap-4">
            <Label className="w-24">New Pset</Label>
            <Switch checked={isNewPset} onCheckedChange={setIsNewPset} />
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-24">Property Set</Label>
            {isNewPset ? (
              <Input
                value={psetName}
                onChange={(e) => setPsetName(e.target.value)}
                placeholder="e.g., Pset_CustomProperties"
              />
            ) : (
              <Select value={psetName} onValueChange={setPsetName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property set" />
                </SelectTrigger>
                <SelectContent>
                  {existingPsets.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  {commonPsets
                    .filter((p) => !existingPsets.includes(p))
                    .map((name) => (
                      <SelectItem key={name} value={name}>
                        {name} (new)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-24">Property</Label>
            <Input
              value={propName}
              onChange={(e) => setPropName(e.target.value)}
              placeholder="e.g., FireRating"
            />
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-24">Type</Label>
            <Select
              value={valueType.toString()}
              onValueChange={(v) => setValueType(parseInt(v) as PropertyValueType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PropertyValueType.String.toString()}>String</SelectItem>
                <SelectItem value={PropertyValueType.Real.toString()}>Real</SelectItem>
                <SelectItem value={PropertyValueType.Integer.toString()}>Integer</SelectItem>
                <SelectItem value={PropertyValueType.Boolean.toString()}>Boolean</SelectItem>
                <SelectItem value={PropertyValueType.Label.toString()}>Label</SelectItem>
                <SelectItem value={PropertyValueType.Identifier.toString()}>Identifier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-24">Value</Label>
            {valueType === PropertyValueType.Boolean ? (
              <Switch
                checked={value === 'true'}
                onCheckedChange={(checked) => setValue(checked ? 'true' : 'false')}
              />
            ) : (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Property value"
                type={valueType === PropertyValueType.Real || valueType === PropertyValueType.Integer ? 'number' : 'text'}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!psetName || !propName}>
            Add Property
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UndoRedoButtonsProps {
  modelId: string;
}

/**
 * Undo/Redo buttons for property mutations
 */
export function UndoRedoButtons({ modelId }: UndoRedoButtonsProps) {
  const canUndo = useViewerStore((s) => s.canUndo);
  const canRedo = useViewerStore((s) => s.canRedo);
  const undo = useViewerStore((s) => s.undo);
  const redo = useViewerStore((s) => s.redo);
  const bumpMutationVersion = useViewerStore((s) => s.bumpMutationVersion);

  // Normalize model ID for legacy models
  let normalizedModelId = modelId;
  if (modelId === 'legacy') {
    normalizedModelId = '__legacy__';
  }

  const handleUndo = useCallback(() => {
    undo(normalizedModelId);
    bumpMutationVersion();
  }, [normalizedModelId, undo, bumpMutationVersion]);

  const handleRedo = useCallback(() => {
    redo(normalizedModelId);
    bumpMutationVersion();
  }, [normalizedModelId, redo, bumpMutationVersion]);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleUndo}
            disabled={!canUndo(normalizedModelId)}
          >
            <Undo className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRedo}
            disabled={!canRedo(normalizedModelId)}
          >
            <Redo className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>
    </div>
  );
}

// Helper functions

/**
 * Extract the raw value from typed IFC values.
 * Handles: arrays like [IFCLABEL, value], strings like "IFCLABEL,value"
 */
function extractRawValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Handle typed value arrays [IFCTYPENAME, actualValue]
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && value[0].toUpperCase().startsWith('IFC')) {
    return value[1];
  }

  // Handle string format "IFCTYPENAME,actualValue"
  if (typeof value === 'string') {
    const match = value.match(/^(IFC[A-Z0-9_]+),(.*)$/i);
    if (match) {
      return match[2]; // Return just the value part
    }
  }

  return value;
}

function formatValue(value: unknown): string {
  const raw = extractRawValue(value);
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number') return raw.toString();
  if (Array.isArray(raw)) return JSON.stringify(raw);
  return String(raw);
}

function formatDisplayValue(value: unknown): string {
  const raw = extractRawValue(value);
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'boolean') return raw ? 'True' : 'False';
  if (typeof raw === 'number') {
    return Number.isInteger(raw)
      ? raw.toLocaleString()
      : raw.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (Array.isArray(raw)) return JSON.stringify(raw);

  // Handle boolean strings
  const strVal = String(raw);
  if (strVal === '.T.' || strVal.toUpperCase() === '.T.') return 'True';
  if (strVal === '.F.' || strVal.toUpperCase() === '.F.') return 'False';
  if (strVal === '.U.' || strVal.toUpperCase() === '.U.') return 'Unknown';
  return strVal;
}

function detectValueType(value: unknown, fallback: PropertyValueType): PropertyValueType {
  // First check if it's a typed value and extract the type
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
    const typeName = value[0].toUpperCase();
    if (typeName === 'IFCBOOLEAN' || typeName === 'IFCLOGICAL') return PropertyValueType.Boolean;
    if (typeName === 'IFCREAL') return PropertyValueType.Real;
    if (typeName === 'IFCINTEGER') return PropertyValueType.Integer;
    if (typeName === 'IFCIDENTIFIER') return PropertyValueType.Identifier;
    if (typeName === 'IFCLABEL') return PropertyValueType.Label;
    if (typeName === 'IFCTEXT') return PropertyValueType.String;
  }

  // Check string format "IFCTYPE,value"
  if (typeof value === 'string') {
    const match = value.match(/^(IFC[A-Z0-9_]+),/i);
    if (match) {
      const typeName = match[1].toUpperCase();
      if (typeName === 'IFCBOOLEAN' || typeName === 'IFCLOGICAL') return PropertyValueType.Boolean;
      if (typeName === 'IFCREAL') return PropertyValueType.Real;
      if (typeName === 'IFCINTEGER') return PropertyValueType.Integer;
      if (typeName === 'IFCIDENTIFIER') return PropertyValueType.Identifier;
      if (typeName === 'IFCLABEL') return PropertyValueType.Label;
      if (typeName === 'IFCTEXT') return PropertyValueType.String;
    }

    // Check for boolean enum values
    const upper = value.toUpperCase();
    if (upper === '.T.' || upper === '.F.' || upper === '.U.') {
      return PropertyValueType.Boolean;
    }
  }

  // Check raw value type
  const raw = extractRawValue(value);
  if (typeof raw === 'boolean') return PropertyValueType.Boolean;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? PropertyValueType.Integer : PropertyValueType.Real;
  }

  return fallback;
}

function getTypeName(type: PropertyValueType): string {
  switch (type) {
    case PropertyValueType.String: return 'String';
    case PropertyValueType.Label: return 'Label';
    case PropertyValueType.Identifier: return 'Identifier';
    case PropertyValueType.Real: return 'Real';
    case PropertyValueType.Integer: return 'Integer';
    case PropertyValueType.Boolean: return 'Boolean';
    case PropertyValueType.Logical: return 'Logical';
    default: return 'String';
  }
}

function parseValue(value: string, type: PropertyValueType): PropertyValue {
  switch (type) {
    case PropertyValueType.Real:
      return parseFloat(value) || 0;
    case PropertyValueType.Integer:
      return parseInt(value, 10) || 0;
    case PropertyValueType.Boolean:
    case PropertyValueType.Logical:
      return value.toLowerCase() === 'true';
    default:
      return value;
  }
}

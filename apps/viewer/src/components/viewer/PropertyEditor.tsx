/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property Editor component for editing IFC property values
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Save,
  X,
  Plus,
  Trash2,
  Edit3,
  Undo,
  Redo,
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
 * Inline property value editor
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

  const [value, setValue] = useState<string>(formatValue(currentValue));
  const [valueType, setValueType] = useState<PropertyValueType>(currentType);
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = useCallback(() => {
    const parsedValue = parseValue(value, valueType);
    setProperty(modelId, entityId, psetName, propName, parsedValue, valueType);
    setIsEditing(false);
    onClose?.();
  }, [modelId, entityId, psetName, propName, value, valueType, setProperty, onClose]);

  const handleDelete = useCallback(() => {
    deleteProperty(modelId, entityId, psetName, propName);
    onClose?.();
  }, [modelId, entityId, psetName, propName, deleteProperty, onClose]);

  const handleCancel = useCallback(() => {
    setValue(formatValue(currentValue));
    setValueType(currentType);
    setIsEditing(false);
    onClose?.();
  }, [currentValue, currentType, onClose]);

  if (!isEditing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground truncate max-w-[150px]">
          {formatValue(currentValue)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setIsEditing(true)}
        >
          <Edit3 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
      {valueType === PropertyValueType.Boolean ? (
        <Switch
          checked={value === 'true'}
          onCheckedChange={(checked) => setValue(checked ? 'true' : 'false')}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 text-sm"
          placeholder="Value"
          type={valueType === PropertyValueType.Real || valueType === PropertyValueType.Integer ? 'number' : 'text'}
        />
      )}
      <Select
        value={valueType.toString()}
        onValueChange={(v) => setValueType(parseInt(v) as PropertyValueType)}
      >
        <SelectTrigger className="w-24 h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PropertyValueType.String.toString()}>String</SelectItem>
          <SelectItem value={PropertyValueType.Real.toString()}>Real</SelectItem>
          <SelectItem value={PropertyValueType.Integer.toString()}>Integer</SelectItem>
          <SelectItem value={PropertyValueType.Boolean.toString()}>Boolean</SelectItem>
          <SelectItem value={PropertyValueType.Label.toString()}>Label</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSave}>
        <Save className="h-3 w-3 text-green-600" />
      </Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCancel}>
        <X className="h-3 w-3 text-red-600" />
      </Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDelete}>
        <Trash2 className="h-3 w-3 text-red-600" />
      </Button>
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

    const parsedValue = parseValue(value, valueType);

    if (isNewPset) {
      createPropertySet(modelId, entityId, psetName, [
        { name: propName, value: parsedValue, type: valueType },
      ]);
    } else {
      setProperty(modelId, entityId, psetName, propName, parsedValue, valueType);
    }

    // Reset form
    setPsetName('');
    setPropName('');
    setValue('');
    setValueType(PropertyValueType.String);
    setIsNewPset(false);
    setOpen(false);
  }, [modelId, entityId, psetName, propName, value, valueType, isNewPset, setProperty, createPropertySet]);

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

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => undo(modelId)}
        disabled={!canUndo(modelId)}
      >
        <Undo className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => redo(modelId)}
        disabled={!canRedo(modelId)}
      >
        <Redo className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Helper functions

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
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

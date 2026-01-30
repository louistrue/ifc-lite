/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Edit Panel
 *
 * Panel for editing geometry parameters with live preview.
 * Displays editable parameters for the currently selected entity
 * when in geometry edit mode.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Move,
  RotateCcw,
  Scale,
  Undo,
  Redo,
  X,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  useGeometryEdit,
  useEditableParameters,
} from '@/hooks/useGeometryEdit';
import {
  ParameterType,
  type GeometryParameter,
  type ParameterValue,
  type Point2D,
} from '@ifc-lite/geometry-edit';
import type { Vec3 } from '@ifc-lite/geometry';

/**
 * Main Geometry Edit Panel component
 */
export function GeometryEditPanel() {
  const {
    editMode,
    session,
    isEditing,
    hasChanges,
    constraintAxis,
    canUndo,
    canRedo,
    stopEditing,
    updateParameter,
    setConstraintAxis,
    undo,
    redo,
    resetGeometry,
    discardChanges,
  } = useGeometryEdit();

  const parameters = useEditableParameters();

  // Group parameters by category
  const groupedParameters = useMemo(() => {
    const groups: Record<string, GeometryParameter[]> = {
      dimensions: [],
      position: [],
      profile: [],
      other: [],
    };

    for (const param of parameters) {
      const pathLower = param.path.toLowerCase();
      if (pathLower.includes('depth') || pathLower.includes('height') || pathLower.includes('width') || pathLower.includes('radius') || pathLower.includes('dim') || pathLower.includes('axis')) {
        groups.dimensions.push(param);
      } else if (pathLower.includes('position') || pathLower.includes('location') || pathLower.includes('direction')) {
        groups.position.push(param);
      } else if (pathLower.includes('profile') || pathLower.includes('sweptarea')) {
        groups.profile.push(param);
      } else {
        groups.other.push(param);
      }
    }

    return groups;
  }, [parameters]);

  // Handle parameter change with live preview
  const handleParameterChange = useCallback(
    (parameter: GeometryParameter, value: ParameterValue) => {
      updateParameter(parameter, value);
    },
    [updateParameter]
  );

  // Handle commit
  const handleCommit = useCallback(() => {
    stopEditing(true);
  }, [stopEditing]);

  // Handle discard
  const handleDiscard = useCallback(() => {
    discardChanges();
  }, [discardChanges]);

  // Not in edit mode
  if (!isEditing || !session) {
    return (
      <div className="h-full flex flex-col border-l-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Geometry Edit
          </h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-black">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-950">
            <Pencil className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="font-bold uppercase text-zinc-900 dark:text-zinc-100 mb-2">
            No Active Edit
          </p>
          <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 max-w-[180px]">
            Right-click an element and select "Edit Geometry" to begin
          </p>
        </div>
      </div>
    );
  }

  const entityType = session.entity.ifcType;
  const entityId = session.entity.expressId;

  return (
    <div className="h-full flex flex-col border-l-2 border-amber-400 dark:border-amber-600 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-4 border-b-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 border-2 border-amber-400 dark:border-amber-600 bg-white dark:bg-zinc-950 shrink-0 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
            <Box className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-bold text-sm truncate uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              Editing Geometry
            </h3>
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              {entityType} #{entityId}
            </p>
          </div>
        </div>

        {/* Undo/Redo and Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={undo}
                  disabled={!canUndo}
                >
                  <Undo className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={redo}
                  disabled={!canRedo}
                >
                  <Redo className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="h-5 mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={resetGeometry}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to original</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleDiscard}
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
              onClick={handleCommit}
              disabled={!hasChanges}
            >
              <Check className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>

        {/* Constraint Axis Selector */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-zinc-500 font-bold">Axis:</span>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <Button
              key={axis}
              variant={constraintAxis === axis ? 'default' : 'outline'}
              size="sm"
              className={`h-6 w-6 p-0 text-[10px] font-bold uppercase ${
                constraintAxis === axis
                  ? axis === 'x'
                    ? 'bg-red-500 hover:bg-red-600'
                    : axis === 'y'
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-blue-500 hover:bg-blue-600'
                  : ''
              }`}
              onClick={() => setConstraintAxis(constraintAxis === axis ? null : axis)}
            >
              {axis.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Dimensions */}
          {groupedParameters.dimensions.length > 0 && (
            <ParameterGroup
              title="Dimensions"
              icon={<Scale className="h-3.5 w-3.5" />}
              parameters={groupedParameters.dimensions}
              onParameterChange={handleParameterChange}
            />
          )}

          {/* Position */}
          {groupedParameters.position.length > 0 && (
            <ParameterGroup
              title="Position"
              icon={<Move className="h-3.5 w-3.5" />}
              parameters={groupedParameters.position}
              onParameterChange={handleParameterChange}
            />
          )}

          {/* Profile */}
          {groupedParameters.profile.length > 0 && (
            <ParameterGroup
              title="Profile"
              icon={<Box className="h-3.5 w-3.5" />}
              parameters={groupedParameters.profile}
              onParameterChange={handleParameterChange}
            />
          )}

          {/* Other */}
          {groupedParameters.other.length > 0 && (
            <ParameterGroup
              title="Other"
              icon={<Pencil className="h-3.5 w-3.5" />}
              parameters={groupedParameters.other}
              onParameterChange={handleParameterChange}
            />
          )}

          {parameters.length === 0 && (
            <div className="text-center py-8">
              <p className="text-xs text-zinc-500 font-mono">
                No editable parameters for this entity type
              </p>
              <p className="text-[10px] text-zinc-400 mt-1">
                Try mesh editing mode for direct manipulation
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Parameter group with collapsible header
 */
interface ParameterGroupProps {
  title: string;
  icon: React.ReactNode;
  parameters: GeometryParameter[];
  onParameterChange: (parameter: GeometryParameter, value: ParameterValue) => void;
}

function ParameterGroup({ title, icon, parameters, onParameterChange }: ParameterGroupProps) {
  return (
    <Collapsible defaultOpen className="border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left">
        <span className="text-zinc-500">{icon}</span>
        <span className="font-bold text-xs uppercase tracking-wide text-zinc-900 dark:text-zinc-100 flex-1">
          {title}
        </span>
        <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
          {parameters.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
          {parameters.map((param) => (
            <ParameterInput
              key={param.path}
              parameter={param}
              onChange={(value) => onParameterChange(param, value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Individual parameter input based on type
 */
interface ParameterInputProps {
  parameter: GeometryParameter;
  onChange: (value: ParameterValue) => void;
}

function ParameterInput({ parameter, onChange }: ParameterInputProps) {
  const [localValue, setLocalValue] = useState<string>(
    formatParameterValue(parameter.value, parameter.type)
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Update local value when parameter changes externally
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(formatParameterValue(parameter.value, parameter.type));
    }
  }, [parameter.value, parameter.type, isFocused]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Parse and emit change for live preview
      const parsed = parseParameterValue(newValue, parameter.type);
      if (parsed !== null) {
        onChange(parsed);
      }
    },
    [parameter.type, onChange]
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Reformat on blur
    setLocalValue(formatParameterValue(parameter.value, parameter.type));
  }, [parameter.value, parameter.type]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        setLocalValue(formatParameterValue(parameter.value, parameter.type));
        inputRef.current?.blur();
      }
    },
    [parameter.value, parameter.type]
  );

  const isModified = parameter.value !== parameter.originalValue;

  // Render different input types based on parameter type
  switch (parameter.type) {
    case ParameterType.Number:
      return (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <Label className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {parameter.displayName}
            </Label>
            {isModified && (
              <span className="text-[9px] bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1 py-0.5 uppercase font-bold">
                Modified
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              type="number"
              value={localValue}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              className="h-7 text-xs font-mono"
              step="any"
              disabled={!parameter.editable}
            />
            {parameter.unit && (
              <span className="text-[10px] text-zinc-400 shrink-0">{parameter.unit}</span>
            )}
          </div>
        </div>
      );

    case ParameterType.Vec3:
      return (
        <Vec3Input
          parameter={parameter}
          onChange={onChange}
          isModified={isModified}
        />
      );

    case ParameterType.Point2D:
      return (
        <Point2DInput
          parameter={parameter}
          onChange={onChange}
          isModified={isModified}
        />
      );

    case ParameterType.Boolean:
      return (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {parameter.displayName}
            </Label>
            <Button
              variant={parameter.value ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => onChange(!parameter.value)}
              disabled={!parameter.editable}
            >
              {parameter.value ? 'Yes' : 'No'}
            </Button>
          </div>
        </div>
      );

    default:
      return (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <Label className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {parameter.displayName}
            </Label>
          </div>
          <Input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            className="h-7 text-xs font-mono"
            disabled={!parameter.editable}
          />
        </div>
      );
  }
}

/**
 * Vec3 input component
 */
interface Vec3InputProps {
  parameter: GeometryParameter;
  onChange: (value: Vec3) => void;
  isModified: boolean;
}

function Vec3Input({ parameter, onChange, isModified }: Vec3InputProps) {
  const value = parameter.value as Vec3;
  const [localX, setLocalX] = useState(value.x.toString());
  const [localY, setLocalY] = useState(value.y.toString());
  const [localZ, setLocalZ] = useState(value.z.toString());

  useEffect(() => {
    const v = parameter.value as Vec3;
    setLocalX(v.x.toString());
    setLocalY(v.y.toString());
    setLocalZ(v.z.toString());
  }, [parameter.value]);

  const handleComponentChange = useCallback(
    (component: 'x' | 'y' | 'z', newValue: string) => {
      const num = parseFloat(newValue);
      if (!isNaN(num)) {
        const newVec = { ...value, [component]: num };
        onChange(newVec);
      }
      if (component === 'x') setLocalX(newValue);
      else if (component === 'y') setLocalY(newValue);
      else setLocalZ(newValue);
    },
    [value, onChange]
  );

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <Label className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {parameter.displayName}
        </Label>
        {isModified && (
          <span className="text-[9px] bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1 py-0.5 uppercase font-bold">
            Modified
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-red-500 font-bold">X</span>
          <Input
            type="number"
            value={localX}
            onChange={(e) => handleComponentChange('x', e.target.value)}
            className="h-6 text-[10px] font-mono px-1"
            step="any"
            disabled={!parameter.editable}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-green-500 font-bold">Y</span>
          <Input
            type="number"
            value={localY}
            onChange={(e) => handleComponentChange('y', e.target.value)}
            className="h-6 text-[10px] font-mono px-1"
            step="any"
            disabled={!parameter.editable}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-blue-500 font-bold">Z</span>
          <Input
            type="number"
            value={localZ}
            onChange={(e) => handleComponentChange('z', e.target.value)}
            className="h-6 text-[10px] font-mono px-1"
            step="any"
            disabled={!parameter.editable}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Point2D input component
 */
interface Point2DInputProps {
  parameter: GeometryParameter;
  onChange: (value: Point2D) => void;
  isModified: boolean;
}

function Point2DInput({ parameter, onChange, isModified }: Point2DInputProps) {
  const value = parameter.value as Point2D;
  const [localX, setLocalX] = useState(value.x.toString());
  const [localY, setLocalY] = useState(value.y.toString());

  useEffect(() => {
    const v = parameter.value as Point2D;
    setLocalX(v.x.toString());
    setLocalY(v.y.toString());
  }, [parameter.value]);

  const handleComponentChange = useCallback(
    (component: 'x' | 'y', newValue: string) => {
      const num = parseFloat(newValue);
      if (!isNaN(num)) {
        const newPoint = { ...value, [component]: num };
        onChange(newPoint);
      }
      if (component === 'x') setLocalX(newValue);
      else setLocalY(newValue);
    },
    [value, onChange]
  );

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <Label className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {parameter.displayName}
        </Label>
        {isModified && (
          <span className="text-[9px] bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1 py-0.5 uppercase font-bold">
            Modified
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-red-500 font-bold">X</span>
          <Input
            type="number"
            value={localX}
            onChange={(e) => handleComponentChange('x', e.target.value)}
            className="h-6 text-[10px] font-mono px-1"
            step="any"
            disabled={!parameter.editable}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-green-500 font-bold">Y</span>
          <Input
            type="number"
            value={localY}
            onChange={(e) => handleComponentChange('y', e.target.value)}
            className="h-6 text-[10px] font-mono px-1"
            step="any"
            disabled={!parameter.editable}
          />
        </div>
      </div>
    </div>
  );
}

// Helper functions

function formatParameterValue(value: ParameterValue, type: ParameterType): string {
  if (value === null || value === undefined) return '';

  switch (type) {
    case ParameterType.Number:
      return typeof value === 'number' ? value.toFixed(4) : String(value);
    case ParameterType.Boolean:
      return value ? 'true' : 'false';
    case ParameterType.Vec3:
      const vec = value as Vec3;
      return `${vec.x}, ${vec.y}, ${vec.z}`;
    case ParameterType.Point2D:
      const pt = value as Point2D;
      return `${pt.x}, ${pt.y}`;
    default:
      return String(value);
  }
}

function parseParameterValue(str: string, type: ParameterType): ParameterValue | null {
  switch (type) {
    case ParameterType.Number:
      const num = parseFloat(str);
      return isNaN(num) ? null : num;
    case ParameterType.Boolean:
      return str.toLowerCase() === 'true';
    default:
      return str;
  }
}

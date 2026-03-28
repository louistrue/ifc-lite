/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Georeferencing panel - displays and allows editing of IfcProjectedCRS
 * and IfcMapConversion entities.
 */

import { useState, useCallback, useMemo } from 'react';
import { Globe, MapPin, PenLine, Check, X, Search } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { computeAngleToGridNorth, type GeoreferenceInfo, type MapConversion, type ProjectedCRS } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { EpsgLookupDialog, type EpsgResult } from './EpsgLookupDialog';

/** Georef field mutation stored per-model */
export interface GeorefFieldMutation {
  entity: 'projectedCRS' | 'mapConversion';
  field: string;
  value: string | number;
  oldValue: string | number | undefined;
}

interface GeorefRowProps {
  label: string;
  value: string | number | undefined | null;
  suffix?: string;
  isComputed?: boolean;
  isNumber?: boolean;
  editable?: boolean;
  isMutated?: boolean;
  onSave?: (value: string | number) => void;
}

function GeorefRow({ label, value, suffix, isComputed, isNumber, editable, isMutated, onSave }: GeorefRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback(() => {
    setEditValue(value != null ? String(value) : '');
    setEditing(true);
  }, [value]);

  const commitEdit = useCallback(() => {
    if (!onSave) return;
    const trimmed = editValue.trim();
    if (isNumber) {
      const num = parseFloat(trimmed);
      if (!Number.isFinite(num)) return;
      onSave(num);
    } else {
      onSave(trimmed);
    }
    setEditing(false);
  }, [editValue, isNumber, onSave]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') cancelEdit();
  }, [commitEdit, cancelEdit]);

  const displayValue = value != null ? String(value) : '-';

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 group/row ${
        isMutated
          ? 'bg-purple-50/50 dark:bg-purple-950/30'
          : ''
      }`}
    >
      <span className="text-xs text-zinc-500 shrink-0 flex items-center gap-1">
        {isComputed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-teal-500">*</span>
            </TooltipTrigger>
            <TooltipContent>Computed from XAxisAbscissa and XAxisOrdinate</TooltipContent>
          </Tooltip>
        )}
        {label}
      </span>
      <div className="ml-auto flex items-center gap-1.5 min-w-0">
        {isMutated && (
          <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700 shrink-0">
            edited
          </Badge>
        )}
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type={isNumber ? 'text' : 'text'}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-32 text-xs font-mono px-1.5 py-0.5 border border-teal-300 dark:border-teal-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-teal-400"
              autoFocus
            />
            <button
              onClick={commitEdit}
              className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={cancelEdit}
              className="p-0.5 text-red-500 hover:text-red-600 dark:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <span className={`text-xs font-mono tabular-nums truncate max-w-[65%] ${
              isMutated
                ? 'text-purple-700 dark:text-purple-300 font-semibold'
                : 'text-teal-700 dark:text-teal-400'
            }`}>
              {displayValue}
              {suffix && <span className="text-zinc-400 ml-1">{suffix}</span>}
            </span>
            {editable && !isComputed && (
              <button
                onClick={startEdit}
                className="p-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400"
              >
                <PenLine className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export interface GeoreferencingPanelProps {
  georef: GeoreferenceInfo | null;
  modelId?: string;
  enableEditing?: boolean;
}

export function GeoreferencingPanel({ georef, modelId, enableEditing }: GeoreferencingPanelProps) {
  const georefMutations = useViewerStore(s => s.georefMutations);
  const setGeorefField = useViewerStore(s => s.setGeorefField);

  // Bump version read to trigger re-renders
  useViewerStore(s => s.mutationVersion);

  // Get mutations for this model
  const mutations = modelId ? georefMutations?.get(modelId) : undefined;

  // Merge base data with mutations
  const mergedCRS = useMemo((): ProjectedCRS | undefined => {
    const base = georef?.projectedCRS;
    const muts = mutations?.projectedCRS;
    if (!base && !muts) return undefined;
    return {
      id: base?.id ?? 0,
      name: muts?.name ?? base?.name ?? '',
      description: muts?.description ?? base?.description,
      geodeticDatum: muts?.geodeticDatum ?? base?.geodeticDatum,
      verticalDatum: muts?.verticalDatum ?? base?.verticalDatum,
      mapProjection: muts?.mapProjection ?? base?.mapProjection,
      mapZone: muts?.mapZone ?? base?.mapZone,
      mapUnit: muts?.mapUnit ?? base?.mapUnit,
    };
  }, [georef, mutations]);

  const mergedConversion = useMemo((): MapConversion | undefined => {
    const base = georef?.mapConversion;
    const muts = mutations?.mapConversion;
    if (!base && !muts) return undefined;
    return {
      id: base?.id ?? 0,
      sourceCRS: base?.sourceCRS ?? 0,
      targetCRS: base?.targetCRS ?? 0,
      eastings: muts?.eastings ?? base?.eastings ?? 0,
      northings: muts?.northings ?? base?.northings ?? 0,
      orthogonalHeight: muts?.orthogonalHeight ?? base?.orthogonalHeight ?? 0,
      xAxisAbscissa: muts?.xAxisAbscissa ?? base?.xAxisAbscissa,
      xAxisOrdinate: muts?.xAxisOrdinate ?? base?.xAxisOrdinate,
      scale: muts?.scale ?? base?.scale,
    };
  }, [georef, mutations]);

  const angleToGridNorth = useMemo(() => {
    return computeAngleToGridNorth(mergedConversion?.xAxisAbscissa, mergedConversion?.xAxisOrdinate);
  }, [mergedConversion]);

  // Check if a specific field has been mutated
  const isMutated = useCallback((entity: 'projectedCRS' | 'mapConversion', field: string): boolean => {
    if (!mutations) return false;
    const entityMuts = mutations[entity];
    if (!entityMuts) return false;
    return field in entityMuts;
  }, [mutations]);

  // Handle field edits
  const handleSave = useCallback((entity: 'projectedCRS' | 'mapConversion', field: string, value: string | number) => {
    if (!modelId || !setGeorefField) return;
    const oldValue = entity === 'projectedCRS'
      ? georef?.projectedCRS?.[field as keyof ProjectedCRS]
      : georef?.mapConversion?.[field as keyof MapConversion];
    setGeorefField(modelId, entity, field, value, oldValue as string | number | undefined);
  }, [modelId, setGeorefField, georef]);

  // Handle EPSG lookup result - apply CRS info
  const handleEpsgSelect = useCallback((result: EpsgResult) => {
    if (!modelId || !setGeorefField) return;
    const epsgName = `EPSG:${result.code}`;
    setGeorefField(modelId, 'projectedCRS', 'name', epsgName, georef?.projectedCRS?.name);
    if (result.name) {
      setGeorefField(modelId, 'projectedCRS', 'description', result.name, georef?.projectedCRS?.description);
    }
    if (result.datum) {
      setGeorefField(modelId, 'projectedCRS', 'geodeticDatum', result.datum, georef?.projectedCRS?.geodeticDatum);
    }
    if (result.projection) {
      setGeorefField(modelId, 'projectedCRS', 'mapProjection', result.projection, georef?.projectedCRS?.mapProjection);
    }
    if (result.unit) {
      const unitUpper = result.unit.toUpperCase();
      const mapUnit = unitUpper.includes('METRE') || unitUpper.includes('METER') ? 'METRE'
        : unitUpper.includes('FOOT') || unitUpper.includes('FEET') ? 'FOOT'
        : result.unit;
      setGeorefField(modelId, 'projectedCRS', 'mapUnit', mapUnit, georef?.projectedCRS?.mapUnit);
    }
  }, [modelId, setGeorefField, georef]);

  const hasData = mergedCRS || mergedConversion;

  if (!hasData && !georef?.hasGeoreference) return null;

  const editable = enableEditing && !!modelId;

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="p-3 bg-teal-50/50 dark:bg-teal-950/20">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <h4 className="font-bold text-xs uppercase tracking-wide text-teal-700 dark:text-teal-300 flex-1">
            Georeferencing
          </h4>
          {editable && (
            <EpsgLookupDialog onSelect={handleEpsgSelect}>
              <button className="flex items-center gap-1 text-[10px] font-mono text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors px-1.5 py-0.5 border border-teal-300/50 dark:border-teal-700/50 hover:bg-teal-50 dark:hover:bg-teal-950/50">
                <Search className="h-2.5 w-2.5" />
                EPSG
              </button>
            </EpsgLookupDialog>
          )}
        </div>
      </div>

      {/* IfcProjectedCRS */}
      {mergedCRS && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors border-b border-zinc-100 dark:border-zinc-900">
            <Globe className="h-3 w-3 text-teal-500 shrink-0" />
            <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Projected CRS</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              <GeorefRow
                label="Name"
                value={mergedCRS.name}
                editable={editable}
                isMutated={isMutated('projectedCRS', 'name')}
                onSave={v => handleSave('projectedCRS', 'name', v)}
              />
              {(mergedCRS.description || editable) && (
                <GeorefRow
                  label="Description"
                  value={mergedCRS.description}
                  editable={editable}
                  isMutated={isMutated('projectedCRS', 'description')}
                  onSave={v => handleSave('projectedCRS', 'description', v)}
                />
              )}
              {(mergedCRS.geodeticDatum || editable) && (
                <GeorefRow
                  label="GeodeticDatum"
                  value={mergedCRS.geodeticDatum}
                  editable={editable}
                  isMutated={isMutated('projectedCRS', 'geodeticDatum')}
                  onSave={v => handleSave('projectedCRS', 'geodeticDatum', v)}
                />
              )}
              {(mergedCRS.verticalDatum || editable) && (
                <GeorefRow
                  label="VerticalDatum"
                  value={mergedCRS.verticalDatum}
                  editable={editable}
                  isMutated={isMutated('projectedCRS', 'verticalDatum')}
                  onSave={v => handleSave('projectedCRS', 'verticalDatum', v)}
                />
              )}
              {(mergedCRS.mapProjection || editable) && (
                <GeorefRow
                  label="MapProjection"
                  value={mergedCRS.mapProjection}
                  editable={editable}
                  isMutated={isMutated('projectedCRS', 'mapProjection')}
                  onSave={v => handleSave('projectedCRS', 'mapProjection', v)}
                />
              )}
              {(mergedCRS.mapZone || editable) && (
                <GeorefRow
                  label="MapZone"
                  value={mergedCRS.mapZone}
                  editable={editable}
                  isMutated={isMutated('projectedCRS', 'mapZone')}
                  onSave={v => handleSave('projectedCRS', 'mapZone', v)}
                />
              )}
              <GeorefRow
                label="MapUnit"
                value={mergedCRS.mapUnit}
                editable={editable}
                isMutated={isMutated('projectedCRS', 'mapUnit')}
                onSave={v => handleSave('projectedCRS', 'mapUnit', v)}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* IfcMapConversion */}
      {mergedConversion && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors border-b border-zinc-100 dark:border-zinc-900">
            <MapPin className="h-3 w-3 text-teal-500 shrink-0" />
            <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Coordinate Operation</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              <GeorefRow
                label="Type"
                value="IfcMapConversion"
              />
              <GeorefRow
                label="Eastings"
                value={mergedConversion.eastings}
                suffix="m"
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'eastings')}
                onSave={v => handleSave('mapConversion', 'eastings', v)}
              />
              <GeorefRow
                label="Northings"
                value={mergedConversion.northings}
                suffix="m"
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'northings')}
                onSave={v => handleSave('mapConversion', 'northings', v)}
              />
              <GeorefRow
                label="OrthogonalHeight"
                value={mergedConversion.orthogonalHeight}
                suffix="m"
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'orthogonalHeight')}
                onSave={v => handleSave('mapConversion', 'orthogonalHeight', v)}
              />
              <GeorefRow
                label="XAxisAbscissa"
                value={mergedConversion.xAxisAbscissa}
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'xAxisAbscissa')}
                onSave={v => handleSave('mapConversion', 'xAxisAbscissa', v)}
              />
              <GeorefRow
                label="XAxisOrdinate"
                value={mergedConversion.xAxisOrdinate}
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'xAxisOrdinate')}
                onSave={v => handleSave('mapConversion', 'xAxisOrdinate', v)}
              />
              {angleToGridNorth != null && (
                <GeorefRow
                  label="Angle to Grid North"
                  value={parseFloat(angleToGridNorth.toFixed(6))}
                  suffix="deg"
                  isComputed
                />
              )}
              <GeorefRow
                label="Scale"
                value={mergedConversion.scale}
                isNumber
                editable={editable}
                isMutated={isMutated('mapConversion', 'scale')}
                onSave={v => handleSave('mapConversion', 'scale', v)}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

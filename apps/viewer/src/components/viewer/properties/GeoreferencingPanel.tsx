/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Georeferencing panel - displays and allows editing of IfcProjectedCRS
 * and IfcMapConversion entities with field-specific editing assistance.
 */

import { useState, useCallback, useMemo } from 'react';
import { Globe, MapPin, PenLine, Check, X, Search, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { computeAngleToGridNorth, type GeoreferenceInfo, type MapConversion, type ProjectedCRS } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { EpsgLookupDialog, type EpsgResult } from './EpsgLookupDialog';

// ── Field-specific assistance data ─────────────────────────────────────

const COMMON_DATUMS = ['WGS84', 'ETRS89', 'NAD83', 'NAD27', 'GRS80', 'Bessel 1841', 'Clarke 1866'];
const COMMON_PROJECTIONS = ['Transverse Mercator', 'UTM', 'Lambert Conformal Conic', 'Mercator', 'Stereographic', 'Oblique Mercator'];
const MAP_UNITS = ['METRE', 'FOOT', 'US SURVEY FOOT'];
const COMMON_VERTICAL_DATUMS = ['MSL', 'NAVD88', 'EVRF2007', 'EVRF2019', 'AHD', 'ODN', 'LN02'];

type FieldHint = {
  placeholder?: string;
  suggestions?: string[];
  isSelect?: boolean;
  helpText?: string;
};

function getFieldHint(entity: string, field: string): FieldHint {
  if (entity === 'projectedCRS') {
    switch (field) {
      case 'name': return { placeholder: 'e.g. EPSG:4326', helpText: 'Use EPSG lookup to search' };
      case 'description': return { placeholder: 'e.g. WGS 84 / UTM zone 32N' };
      case 'geodeticDatum': return { placeholder: 'e.g. WGS84', suggestions: COMMON_DATUMS };
      case 'verticalDatum': return { placeholder: 'e.g. MSL', suggestions: COMMON_VERTICAL_DATUMS };
      case 'mapProjection': return { placeholder: 'e.g. Transverse Mercator', suggestions: COMMON_PROJECTIONS };
      case 'mapZone': return { placeholder: 'e.g. 32N' };
      case 'mapUnit': return { isSelect: true, suggestions: MAP_UNITS };
      default: return {};
    }
  }
  if (entity === 'mapConversion') {
    switch (field) {
      case 'eastings': return { placeholder: '0.0', helpText: 'X offset in map units' };
      case 'northings': return { placeholder: '0.0', helpText: 'Y offset in map units' };
      case 'orthogonalHeight': return { placeholder: '0.0', helpText: 'Z offset in metres' };
      case 'xAxisAbscissa': return { placeholder: '1.0', helpText: 'cos(angle to grid north)' };
      case 'xAxisOrdinate': return { placeholder: '0.0', helpText: 'sin(angle to grid north)' };
      case 'scale': return { placeholder: '1.0', helpText: 'Usually 1.0 or close to it' };
      default: return {};
    }
  }
  return {};
}

// ── GeorefRow: a single editable field ─────────────────────────────────

interface GeorefRowProps {
  label: string;
  value: string | number | undefined | null;
  suffix?: string;
  isComputed?: boolean;
  isNumber?: boolean;
  editable?: boolean;
  isMutated?: boolean;
  fieldEntity?: string;
  fieldName?: string;
  onSave?: (value: string | number) => void;
}

function GeorefRow({ label, value, suffix, isComputed, isNumber, editable, isMutated, fieldEntity, fieldName, onSave }: GeorefRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const hint = useMemo(() => getFieldHint(fieldEntity ?? '', fieldName ?? ''), [fieldEntity, fieldName]);

  const startEdit = useCallback(() => {
    if (!editable || isComputed) return;
    setEditValue(value != null ? String(value) : '');
    setEditing(true);
  }, [value, editable, isComputed]);

  const commitEdit = useCallback((overrideValue?: string) => {
    if (!onSave) { setEditing(false); return; }
    const trimmed = (overrideValue ?? editValue).trim();
    if (!trimmed && !hint.isSelect) { setEditing(false); return; }
    if (isNumber) {
      const num = parseFloat(trimmed);
      if (!Number.isFinite(num)) { setEditing(false); return; }
      onSave(num);
    } else {
      onSave(trimmed);
    }
    setEditing(false);
  }, [editValue, isNumber, onSave, hint.isSelect]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') cancelEdit();
  }, [commitEdit, cancelEdit]);

  const selectSuggestion = useCallback((s: string) => {
    if (!onSave) return;
    if (isNumber) {
      const num = parseFloat(s);
      if (Number.isFinite(num)) onSave(num);
    } else {
      onSave(s);
    }
    setEditing(false);
  }, [onSave, isNumber]);

  const displayValue = value != null ? String(value) : '-';

  return (
    <div
      className={`flex items-start gap-2 px-3 py-1.5 min-w-0 ${
        isMutated ? 'bg-purple-50/50 dark:bg-purple-950/30' : ''
      } ${editable && !isComputed ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 group/row' : ''}`}
      onClick={!editing ? startEdit : undefined}
    >
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0 pt-0.5 flex items-center gap-0.5 min-w-[110px]">
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
      <div className="flex-1 flex flex-col items-end gap-0.5 min-w-0">
        <div className="flex items-start gap-1 w-full justify-end">
          {isMutated && !editing && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700 shrink-0 mt-0.5">
              edited
            </Badge>
          )}
          {editing ? (
            <div className="flex flex-col gap-1 w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-1">
                {hint.isSelect ? (
                  <select
                    value={editValue}
                    onChange={e => { setEditValue(e.target.value); }}
                    className="flex-1 text-[11px] font-mono px-1.5 py-1 border border-teal-400 dark:border-teal-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-teal-400"
                    autoFocus
                  >
                    <option value="">-- select --</option>
                    {hint.suggestions?.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={hint.placeholder}
                    className="flex-1 min-w-0 text-[11px] font-mono px-1.5 py-0.5 border border-teal-400 dark:border-teal-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-zinc-400/50"
                    autoFocus
                  />
                )}
                <button onClick={() => commitEdit()} className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400 shrink-0">
                  <Check className="h-3 w-3" />
                </button>
                <button onClick={cancelEdit} className="p-0.5 text-red-500 hover:text-red-600 dark:text-red-400 shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {/* Suggestion chips for fields with common values */}
              {hint.suggestions && !hint.isSelect && (
                <div className="flex flex-wrap gap-1">
                  {hint.suggestions.map(s => (
                    <button
                      key={s}
                      onClick={() => selectSuggestion(s)}
                      className="text-[9px] font-mono px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {/* Help text */}
              {hint.helpText && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500">{hint.helpText}</span>
              )}
            </div>
          ) : (
            <>
              <span
                className={`text-[11px] font-mono tabular-nums break-all text-right ${
                  isMutated
                    ? 'text-purple-700 dark:text-purple-300 font-semibold'
                    : 'text-teal-700 dark:text-teal-400'
                }`}
                title={displayValue}
              >
                {displayValue}
                {suffix && <span className="text-zinc-400 dark:text-zinc-500 ml-0.5">{suffix}</span>}
              </span>
              {editable && !isComputed && (
                <PenLine className="h-3 w-3 opacity-0 group-hover/row:opacity-100 transition-opacity text-zinc-400 shrink-0 mt-0.5" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AngleRow: edit angle and auto-compute XAxisAbscissa/XAxisOrdinate ───

interface AngleRowProps {
  angle: number | null;
  editable?: boolean;
  onAngleChange?: (abscissa: number, ordinate: number) => void;
}

function AngleRow({ angle, editable, onAngleChange }: AngleRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback(() => {
    if (!editable) return;
    setEditValue(angle != null ? angle.toFixed(6) : '');
    setEditing(true);
  }, [angle, editable]);

  const commitEdit = useCallback(() => {
    if (!onAngleChange) return;
    const deg = parseFloat(editValue.trim());
    if (!Number.isFinite(deg)) return;
    const rad = deg * (Math.PI / 180);
    onAngleChange(Math.sin(rad), Math.cos(rad));
    setEditing(false);
  }, [editValue, onAngleChange]);

  const cancelEdit = useCallback(() => setEditing(false), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') cancelEdit();
  }, [commitEdit, cancelEdit]);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-1.5 min-w-0 ${editable ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 group/row' : ''}`}
      onClick={!editing ? startEdit : undefined}
    >
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0 pt-0.5 flex items-center gap-0.5 min-w-[110px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-teal-500">*</span>
          </TooltipTrigger>
          <TooltipContent>{editable ? 'Edit angle to auto-compute XAxisAbscissa/XAxisOrdinate' : 'Computed from XAxisAbscissa and XAxisOrdinate'}</TooltipContent>
        </Tooltip>
        Angle to Grid North
      </span>
      <div className="flex-1 flex items-start gap-1 min-w-0 justify-end">
        {editing ? (
          <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <input
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0.0"
                className="w-28 text-[11px] font-mono px-1.5 py-0.5 border border-teal-400 dark:border-teal-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-zinc-400/50"
                autoFocus
              />
              <span className="text-[10px] text-zinc-400">deg</span>
              <button onClick={commitEdit} className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400 shrink-0">
                <Check className="h-3 w-3" />
              </button>
              <button onClick={cancelEdit} className="p-0.5 text-red-500 hover:text-red-600 dark:text-red-400 shrink-0">
                <X className="h-3 w-3" />
              </button>
            </div>
            <span className="text-[9px] text-zinc-400 dark:text-zinc-500">Sets XAxisAbscissa = sin(angle), XAxisOrdinate = cos(angle)</span>
          </div>
        ) : (
          <>
            <span className="text-[11px] font-mono tabular-nums text-teal-700 dark:text-teal-400">
              {angle != null ? parseFloat(angle.toFixed(6)) : '-'}
              <span className="text-zinc-400 dark:text-zinc-500 ml-0.5">deg</span>
            </span>
            {editable && (
              <PenLine className="h-3 w-3 opacity-0 group-hover/row:opacity-100 transition-opacity text-zinc-400 shrink-0 mt-0.5" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────

export interface GeoreferencingPanelProps {
  georef: GeoreferenceInfo | null;
  modelId?: string;
  enableEditing?: boolean;
}

export function GeoreferencingPanel({ georef, modelId, enableEditing }: GeoreferencingPanelProps) {
  const georefMutations = useViewerStore(s => s.georefMutations);
  const setGeorefField = useViewerStore(s => s.setGeorefField);
  const [crsOpen, setCrsOpen] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);

  useViewerStore(s => s.mutationVersion);

  const mutations = modelId ? georefMutations?.get(modelId) : undefined;

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

  const isMutated = useCallback((entity: 'projectedCRS' | 'mapConversion', field: string): boolean => {
    if (!mutations) return false;
    const entityMuts = mutations[entity];
    if (!entityMuts) return false;
    return field in entityMuts;
  }, [mutations]);

  const handleSave = useCallback((entity: 'projectedCRS' | 'mapConversion', field: string, value: string | number) => {
    if (!modelId || !setGeorefField) return;
    const oldValue = entity === 'projectedCRS'
      ? georef?.projectedCRS?.[field as keyof ProjectedCRS]
      : georef?.mapConversion?.[field as keyof MapConversion];
    setGeorefField(modelId, entity, field, value, oldValue as string | number | undefined);
  }, [modelId, setGeorefField, georef]);

  // Handle angle edit: compute and set both XAxisAbscissa and XAxisOrdinate
  const handleAngleChange = useCallback((abscissa: number, ordinate: number) => {
    if (!modelId || !setGeorefField) return;
    setGeorefField(modelId, 'mapConversion', 'xAxisAbscissa', abscissa, georef?.mapConversion?.xAxisAbscissa);
    setGeorefField(modelId, 'mapConversion', 'xAxisOrdinate', ordinate, georef?.mapConversion?.xAxisOrdinate);
  }, [modelId, setGeorefField, georef]);

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
  const editable = enableEditing && !!modelId;

  // When no georef data exists, show "Add Georeferencing" in edit mode
  if (!hasData && !georef?.hasGeoreference) {
    if (!editable) return null;
    return (
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="px-2.5 py-2 bg-teal-50/50 dark:bg-teal-950/20 flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex-1">No georeferencing</span>
          <EpsgLookupDialog onSelect={handleEpsgSelect}>
            <button className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors px-2 py-1 border border-teal-300/50 dark:border-teal-700/50 hover:bg-teal-50 dark:hover:bg-teal-950/50">
              <Globe className="h-3 w-3" />
              Add Georeferencing
            </button>
          </EpsgLookupDialog>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {/* Header with CRS summary always visible */}
      <div className="px-2.5 py-1.5 bg-teal-50/50 dark:bg-teal-950/20">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <span className="font-bold text-xs uppercase tracking-wide text-teal-700 dark:text-teal-300 flex-1">
            Georeferencing
          </span>
          {editable && (
            <EpsgLookupDialog onSelect={handleEpsgSelect}>
              <button className="flex items-center gap-1 text-[10px] font-mono text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors px-1.5 py-0.5 border border-teal-300/50 dark:border-teal-700/50 hover:bg-teal-50 dark:hover:bg-teal-950/50">
                <Search className="h-2.5 w-2.5" />
                EPSG
              </button>
            </EpsgLookupDialog>
          )}
        </div>
        {/* Always-visible summary */}
        {mergedCRS?.name && (
          <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-teal-600 dark:text-teal-400">
            <span className="font-semibold">{mergedCRS.name}</span>
            {mergedCRS.description && <span className="text-teal-500/60 truncate">{mergedCRS.description}</span>}
          </div>
        )}
        {mergedConversion && (
          <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-teal-500/70 dark:text-teal-500/50">
            <span>E {mergedConversion.eastings}</span>
            <span>N {mergedConversion.northings}</span>
            <span>H {mergedConversion.orthogonalHeight}</span>
          </div>
        )}
      </div>

      {/* IfcProjectedCRS */}
      {mergedCRS && (
        <div>
          <button
            onClick={() => setCrsOpen(!crsOpen)}
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors border-b border-zinc-100 dark:border-zinc-900"
          >
            <ChevronRight className={`h-3 w-3 text-teal-500 shrink-0 transition-transform ${crsOpen ? 'rotate-90' : ''}`} />
            <Globe className="h-3 w-3 text-teal-500 shrink-0" />
            <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1 text-left">Projected CRS</span>
            {!crsOpen && mergedCRS.name && (
              <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60 truncate max-w-[50%]">{mergedCRS.name}</span>
            )}
          </button>
          {crsOpen && (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              <GeorefRow label="Name" value={mergedCRS.name} editable={editable} isMutated={isMutated('projectedCRS', 'name')} fieldEntity="projectedCRS" fieldName="name" onSave={v => handleSave('projectedCRS', 'name', v)} />
              <GeorefRow label="Description" value={mergedCRS.description} editable={editable} isMutated={isMutated('projectedCRS', 'description')} fieldEntity="projectedCRS" fieldName="description" onSave={v => handleSave('projectedCRS', 'description', v)} />
              <GeorefRow label="GeodeticDatum" value={mergedCRS.geodeticDatum} editable={editable} isMutated={isMutated('projectedCRS', 'geodeticDatum')} fieldEntity="projectedCRS" fieldName="geodeticDatum" onSave={v => handleSave('projectedCRS', 'geodeticDatum', v)} />
              <GeorefRow label="VerticalDatum" value={mergedCRS.verticalDatum} editable={editable} isMutated={isMutated('projectedCRS', 'verticalDatum')} fieldEntity="projectedCRS" fieldName="verticalDatum" onSave={v => handleSave('projectedCRS', 'verticalDatum', v)} />
              <GeorefRow label="MapProjection" value={mergedCRS.mapProjection} editable={editable} isMutated={isMutated('projectedCRS', 'mapProjection')} fieldEntity="projectedCRS" fieldName="mapProjection" onSave={v => handleSave('projectedCRS', 'mapProjection', v)} />
              <GeorefRow label="MapZone" value={mergedCRS.mapZone} editable={editable} isMutated={isMutated('projectedCRS', 'mapZone')} fieldEntity="projectedCRS" fieldName="mapZone" onSave={v => handleSave('projectedCRS', 'mapZone', v)} />
              <GeorefRow label="MapUnit" value={mergedCRS.mapUnit} editable={editable} isMutated={isMutated('projectedCRS', 'mapUnit')} fieldEntity="projectedCRS" fieldName="mapUnit" onSave={v => handleSave('projectedCRS', 'mapUnit', v)} />
            </div>
          )}
        </div>
      )}

      {/* IfcMapConversion */}
      {mergedConversion && (
        <div>
          <button
            onClick={() => setConversionOpen(!conversionOpen)}
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors border-b border-zinc-100 dark:border-zinc-900"
          >
            <ChevronRight className={`h-3 w-3 text-teal-500 shrink-0 transition-transform ${conversionOpen ? 'rotate-90' : ''}`} />
            <MapPin className="h-3 w-3 text-teal-500 shrink-0" />
            <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1 text-left">Coordinate Operation</span>
            {!conversionOpen && (
              <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60">
                E {mergedConversion.eastings.toFixed(0)} N {mergedConversion.northings.toFixed(0)}
              </span>
            )}
          </button>
          {conversionOpen && (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              <GeorefRow label="Type" value="IfcMapConversion" />
              <GeorefRow label="Eastings" value={mergedConversion.eastings} suffix="m" isNumber editable={editable} isMutated={isMutated('mapConversion', 'eastings')} fieldEntity="mapConversion" fieldName="eastings" onSave={v => handleSave('mapConversion', 'eastings', v)} />
              <GeorefRow label="Northings" value={mergedConversion.northings} suffix="m" isNumber editable={editable} isMutated={isMutated('mapConversion', 'northings')} fieldEntity="mapConversion" fieldName="northings" onSave={v => handleSave('mapConversion', 'northings', v)} />
              <GeorefRow label="OrthogonalHeight" value={mergedConversion.orthogonalHeight} suffix="m" isNumber editable={editable} isMutated={isMutated('mapConversion', 'orthogonalHeight')} fieldEntity="mapConversion" fieldName="orthogonalHeight" onSave={v => handleSave('mapConversion', 'orthogonalHeight', v)} />
              <GeorefRow label="XAxisAbscissa" value={mergedConversion.xAxisAbscissa} isNumber editable={editable} isMutated={isMutated('mapConversion', 'xAxisAbscissa')} fieldEntity="mapConversion" fieldName="xAxisAbscissa" onSave={v => handleSave('mapConversion', 'xAxisAbscissa', v)} />
              <GeorefRow label="XAxisOrdinate" value={mergedConversion.xAxisOrdinate} isNumber editable={editable} isMutated={isMutated('mapConversion', 'xAxisOrdinate')} fieldEntity="mapConversion" fieldName="xAxisOrdinate" onSave={v => handleSave('mapConversion', 'xAxisOrdinate', v)} />
              <AngleRow angle={angleToGridNorth} editable={editable} onAngleChange={handleAngleChange} />
              <GeorefRow label="Scale" value={mergedConversion.scale} isNumber editable={editable} isMutated={isMutated('mapConversion', 'scale')} fieldEntity="mapConversion" fieldName="scale" onSave={v => handleSave('mapConversion', 'scale', v)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

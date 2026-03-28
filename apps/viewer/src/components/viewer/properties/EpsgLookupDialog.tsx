/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EPSG lookup dialog - search by code or name.
 *
 * Uses a bundled database of common CRS codes for instant offline search,
 * plus epsg.io direct code lookup for any EPSG code entered numerically.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Search, Globe, Loader2, MapPin } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface EpsgResult {
  code: string;
  name: string;
  area: string;
  unit: string;
  kind?: string;
  datum?: string;
  projection?: string;
}

// ── Bundled CRS database (most common codes for BIM/GIS) ───────────────
// Covers UTM zones, national grids, Web Mercator, WGS84, and common projected CRS.

const COMMON_CRS: EpsgResult[] = [
  // Global
  { code: '4326', name: 'WGS 84', area: 'World', unit: 'degree', kind: 'Geographic', datum: 'WGS84' },
  { code: '3857', name: 'WGS 84 / Pseudo-Mercator', area: 'World', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'Pseudo-Mercator' },
  { code: '4258', name: 'ETRS89', area: 'Europe', unit: 'degree', kind: 'Geographic', datum: 'ETRS89' },
  { code: '3035', name: 'ETRS89-extended / LAEA Europe', area: 'Europe', unit: 'metre', kind: 'Projected', datum: 'ETRS89' },
  // UTM WGS84 North (selected zones)
  { code: '32601', name: 'WGS 84 / UTM zone 1N', area: 'World - N 0°-84°, W 180°-174°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32610', name: 'WGS 84 / UTM zone 10N', area: 'World - N 0°-84°, W 126°-120°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32611', name: 'WGS 84 / UTM zone 11N', area: 'World - N 0°-84°, W 120°-114°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32612', name: 'WGS 84 / UTM zone 12N', area: 'World - N 0°-84°, W 114°-108°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32613', name: 'WGS 84 / UTM zone 13N', area: 'World - N 0°-84°, W 108°-102°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32614', name: 'WGS 84 / UTM zone 14N', area: 'World - N 0°-84°, W 102°-96°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32615', name: 'WGS 84 / UTM zone 15N', area: 'World - N 0°-84°, W 96°-90°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32616', name: 'WGS 84 / UTM zone 16N', area: 'World - N 0°-84°, W 90°-84°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32617', name: 'WGS 84 / UTM zone 17N', area: 'World - N 0°-84°, W 84°-78°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32618', name: 'WGS 84 / UTM zone 18N', area: 'World - N 0°-84°, W 78°-72°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32619', name: 'WGS 84 / UTM zone 19N', area: 'World - N 0°-84°, W 72°-66°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32620', name: 'WGS 84 / UTM zone 20N', area: 'World - N 0°-84°, W 66°-60°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32628', name: 'WGS 84 / UTM zone 28N', area: 'World - N 0°-84°, W 18°-12°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32629', name: 'WGS 84 / UTM zone 29N', area: 'World - N 0°-84°, W 12°-6°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32630', name: 'WGS 84 / UTM zone 30N', area: 'World - N 0°-84°, W 6°-0°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32631', name: 'WGS 84 / UTM zone 31N', area: 'World - N 0°-84°, E 0°-6°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32632', name: 'WGS 84 / UTM zone 32N', area: 'World - N 0°-84°, E 6°-12°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32633', name: 'WGS 84 / UTM zone 33N', area: 'World - N 0°-84°, E 12°-18°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32634', name: 'WGS 84 / UTM zone 34N', area: 'World - N 0°-84°, E 18°-24°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32635', name: 'WGS 84 / UTM zone 35N', area: 'World - N 0°-84°, E 24°-30°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32636', name: 'WGS 84 / UTM zone 36N', area: 'World - N 0°-84°, E 30°-36°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32637', name: 'WGS 84 / UTM zone 37N', area: 'World - N 0°-84°, E 36°-42°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32638', name: 'WGS 84 / UTM zone 38N', area: 'World - N 0°-84°, E 42°-48°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  // Switzerland
  { code: '2056', name: 'CH1903+ / LV95', area: 'Switzerland, Liechtenstein', unit: 'metre', kind: 'Projected', datum: 'CH1903+', projection: 'Swiss Oblique Mercator' },
  { code: '21781', name: 'CH1903 / LV03', area: 'Switzerland, Liechtenstein', unit: 'metre', kind: 'Projected', datum: 'CH1903', projection: 'Swiss Oblique Mercator' },
  // Germany
  { code: '25832', name: 'ETRS89 / UTM zone 32N', area: 'Europe - E 6°-12°', unit: 'metre', kind: 'Projected', datum: 'ETRS89', projection: 'UTM' },
  { code: '25833', name: 'ETRS89 / UTM zone 33N', area: 'Europe - E 12°-18°', unit: 'metre', kind: 'Projected', datum: 'ETRS89', projection: 'UTM' },
  { code: '5555', name: 'ETRS89 / UTM zone 32N + DHHN2016 height', area: 'Germany', unit: 'metre', kind: 'Compound', datum: 'ETRS89' },
  { code: '31467', name: 'DHDN / 3-degree Gauss-Kruger zone 3', area: 'Germany - E 7.5°-10.5°', unit: 'metre', kind: 'Projected', datum: 'DHDN' },
  // Austria
  { code: '31256', name: 'MGI / Austria GK M31', area: 'Austria - E 13.33°-16.33°', unit: 'metre', kind: 'Projected', datum: 'MGI' },
  { code: '31255', name: 'MGI / Austria GK M28', area: 'Austria - W of 14.83°E', unit: 'metre', kind: 'Projected', datum: 'MGI' },
  { code: '31257', name: 'MGI / Austria GK M34', area: 'Austria - E of 14.83°E', unit: 'metre', kind: 'Projected', datum: 'MGI' },
  // UK
  { code: '27700', name: 'OSGB 1936 / British National Grid', area: 'United Kingdom', unit: 'metre', kind: 'Projected', datum: 'OSGB 1936' },
  // France
  { code: '2154', name: 'RGF93 v1 / Lambert-93', area: 'France', unit: 'metre', kind: 'Projected', datum: 'RGF93 v1', projection: 'Lambert-93' },
  // Netherlands
  { code: '28992', name: 'Amersfoort / RD New', area: 'Netherlands', unit: 'metre', kind: 'Projected', datum: 'Amersfoort', projection: 'Stereographic' },
  // Belgium
  { code: '31370', name: 'Belge 1972 / Belgian Lambert 72', area: 'Belgium', unit: 'metre', kind: 'Projected', datum: 'Belge 1972' },
  // Spain
  { code: '25830', name: 'ETRS89 / UTM zone 30N', area: 'Europe - W 6°-0°', unit: 'metre', kind: 'Projected', datum: 'ETRS89', projection: 'UTM' },
  // Italy
  { code: '6706', name: 'RDN2008 / UTM zone 32N', area: 'Italy - W of 12°E', unit: 'metre', kind: 'Projected', datum: 'RDN2008', projection: 'UTM' },
  // Scandinavia
  { code: '3006', name: 'SWEREF99 TM', area: 'Sweden', unit: 'metre', kind: 'Projected', datum: 'SWEREF99' },
  { code: '25835', name: 'ETRS89 / UTM zone 35N', area: 'Europe - E 24°-30°', unit: 'metre', kind: 'Projected', datum: 'ETRS89', projection: 'UTM' },
  // North America
  { code: '2263', name: 'NAD83 / New York Long Island (ftUS)', area: 'USA - New York - Long Island', unit: 'US survey foot', kind: 'Projected', datum: 'NAD83' },
  { code: '2227', name: 'NAD83 / California zone 3 (ftUS)', area: 'USA - California - zone 3', unit: 'US survey foot', kind: 'Projected', datum: 'NAD83' },
  { code: '6339', name: 'NAD83(2011) / UTM zone 10N', area: 'USA - W 126°-120°', unit: 'metre', kind: 'Projected', datum: 'NAD83(2011)', projection: 'UTM' },
  { code: '26917', name: 'NAD83 / UTM zone 17N', area: 'North America - W 84°-78°', unit: 'metre', kind: 'Projected', datum: 'NAD83', projection: 'UTM' },
  // Australia / NZ
  { code: '28355', name: 'GDA94 / MGA zone 55', area: 'Australia - E 144°-150°', unit: 'metre', kind: 'Projected', datum: 'GDA94', projection: 'UTM' },
  { code: '7855', name: 'GDA2020 / MGA zone 55', area: 'Australia - E 144°-150°', unit: 'metre', kind: 'Projected', datum: 'GDA2020', projection: 'UTM' },
  { code: '2193', name: 'NZGD2000 / New Zealand Transverse Mercator', area: 'New Zealand', unit: 'metre', kind: 'Projected', datum: 'NZGD2000' },
  // Asia
  { code: '32650', name: 'WGS 84 / UTM zone 50N', area: 'World - N 0°-84°, E 114°-120°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '32651', name: 'WGS 84 / UTM zone 51N', area: 'World - N 0°-84°, E 120°-126°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
  { code: '2326', name: 'Hong Kong 1980 Grid System', area: 'Hong Kong', unit: 'metre', kind: 'Projected', datum: 'Hong Kong 1980' },
  { code: '3414', name: 'SVY21 / Singapore TM', area: 'Singapore', unit: 'metre', kind: 'Projected', datum: 'SVY21' },
  // Middle East
  { code: '32640', name: 'WGS 84 / UTM zone 40N', area: 'World - N 0°-84°, E 54°-60°', unit: 'metre', kind: 'Projected', datum: 'WGS84', projection: 'UTM' },
];

// ── API lookup for codes not in the bundled database ───────────────────

async function lookupEpsgCode(code: string, signal: AbortSignal): Promise<EpsgResult | null> {
  // Try epsg.io direct code lookup (still works, CORS enabled)
  try {
    const res = await fetch(`https://epsg.io/${code}.json`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) return null;
    return {
      code: String(r.code),
      name: String(r.name || ''),
      area: String(r.area || ''),
      unit: String(r.unit || ''),
      kind: r.kind === 'CRS-PROJCRS' ? 'Projected' : r.kind === 'CRS-GEOGCRS' ? 'Geographic' : r.kind === 'CRS-COMPOUNDCRS' ? 'Compound' : undefined,
      datum: r.datum ? String(r.datum) : undefined,
      projection: r.projection ? String(r.projection) : undefined,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return null;
  }
}

// ── Dialog component ───────────────────────────────────────────────────

interface EpsgLookupDialogProps {
  onSelect: (result: EpsgResult) => void;
  children?: React.ReactNode;
}

export function EpsgLookupDialog({ onSelect, children }: EpsgLookupDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EpsgResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build search index once
  const searchIndex = useMemo(() => {
    return COMMON_CRS.map(crs => ({
      ...crs,
      _searchText: `${crs.code} ${crs.name} ${crs.area} ${crs.datum || ''} ${crs.projection || ''}`.toLowerCase(),
    }));
  }, []);

  const search = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    const isCode = /^\d+$/.test(trimmed);

    // Local search first (instant)
    const queryLower = trimmed.toLowerCase();
    const localMatches = searchIndex
      .filter(crs => {
        if (isCode) return crs.code.startsWith(trimmed);
        return crs._searchText.includes(queryLower);
      })
      .slice(0, 20);

    if (localMatches.length > 0) {
      setResults(localMatches);
      setError(null);
      setLoading(false);
      return;
    }

    // If user entered a code not in our database, try online lookup
    if (isCode && trimmed.length >= 4) {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const result = await lookupEpsgCode(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        if (result) {
          setResults([result]);
          setError(null);
        } else {
          setResults([]);
          setError(`EPSG:${trimmed} not found`);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setResults([]);
        setError(`Could not look up EPSG:${trimmed}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
      return;
    }

    // Text search with no local matches
    setResults([]);
    setError(trimmed.length < 2 ? null : 'No matching CRS found — try an EPSG code number');
  }, [searchIndex]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 150);
  }, [search]);

  const handleSelect = useCallback((result: EpsgResult) => {
    onSelect(result);
    setOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelect]);

  // Show popular CRS when dialog opens with empty query
  useEffect(() => {
    if (open && !query) {
      setResults(COMMON_CRS.slice(0, 10));
      setError(null);
    }
  }, [open, query]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <button className="flex items-center gap-1 text-[10px] font-mono text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors px-1.5 py-0.5 border border-teal-300/50 dark:border-teal-700/50 hover:bg-teal-50 dark:hover:bg-teal-950/50">
            <Search className="h-2.5 w-2.5" />
            EPSG
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4 text-teal-500" />
            EPSG Coordinate Reference System Lookup
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Search by code, name, country, or datum. Enter any EPSG code for online lookup.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="e.g. 2056, UTM 32N, Switzerland, WGS84..."
            value={query}
            onChange={handleInputChange}
            leftIcon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            autoFocus
          />

          {error && (
            <p className="text-xs text-muted-foreground px-1">{error}</p>
          )}

          {results.length > 0 && (
            <ScrollArea className="max-h-[300px] border rounded-md">
              <div className="divide-y">
                {results.map((result) => (
                  <button
                    key={result.code}
                    className="w-full text-left px-3 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors"
                    onClick={() => handleSelect(result)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-1.5 py-0.5 border border-teal-200 dark:border-teal-800 shrink-0">
                        {result.code}
                      </span>
                      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate flex-1">
                        {result.name}
                      </span>
                      {result.kind && (
                        <span className="text-[9px] font-mono px-1 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 shrink-0">
                          {result.kind}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      {result.area && (
                        <span className="flex items-center gap-0.5 truncate">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          {result.area}
                        </span>
                      )}
                      {result.datum && (
                        <span className="shrink-0">Datum: {result.datum}</span>
                      )}
                      {result.unit && (
                        <span className="shrink-0">{result.unit}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

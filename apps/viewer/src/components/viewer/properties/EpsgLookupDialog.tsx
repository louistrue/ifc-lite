/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EPSG lookup dialog - search by code or name.
 *
 * Uses the local full EPSG index from @ifc-lite/data so search remains stable
 * and works offline once the bundle is loaded.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Search, Globe, Loader2 } from 'lucide-react';
import {
  loadEpsgIndexDatasetVersion,
  lookupEpsgByCode,
  searchEpsgIndex,
  type EpsgIndexEntry,
} from '@ifc-lite/data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface EpsgResult {
  code: string;
  name: string;
  area: string;
  unit: string;
  kind?: string;
  datum?: string;
  projection?: string;
}

function toDialogResult(entry: EpsgIndexEntry): EpsgResult {
  return {
    code: entry.code,
    name: entry.name,
    area: entry.area,
    unit: entry.unit,
    kind: entry.kind,
    datum: entry.datum || undefined,
    projection: entry.projection || undefined,
  };
}

// ── Bundled offline fallback (common BIM/GIS codes) ────────────────────

const COMMON_CRS: EpsgResult[] = [
  { code: '4326', name: 'WGS 84', area: 'World', unit: 'degree', kind: 'Geographic', datum: 'WGS84' },
  { code: '3857', name: 'WGS 84 / Pseudo-Mercator', area: 'World', unit: 'metre', kind: 'Projected', datum: 'WGS84' },
  { code: '4258', name: 'ETRS89', area: 'Europe', unit: 'degree', kind: 'Geographic', datum: 'ETRS89' },
  { code: '2056', name: 'CH1903+ / LV95', area: 'Switzerland', unit: 'metre', kind: 'Projected', datum: 'CH1903+' },
  { code: '21781', name: 'CH1903 / LV03', area: 'Switzerland', unit: 'metre', kind: 'Projected', datum: 'CH1903' },
  { code: '25832', name: 'ETRS89 / UTM zone 32N', area: 'Europe 6°-12°E', unit: 'metre', kind: 'Projected', datum: 'ETRS89' },
  { code: '25833', name: 'ETRS89 / UTM zone 33N', area: 'Europe 12°-18°E', unit: 'metre', kind: 'Projected', datum: 'ETRS89' },
  { code: '27700', name: 'OSGB 1936 / British National Grid', area: 'United Kingdom', unit: 'metre', kind: 'Projected', datum: 'OSGB 1936' },
  { code: '2154', name: 'RGF93 v1 / Lambert-93', area: 'France', unit: 'metre', kind: 'Projected', datum: 'RGF93 v1' },
  { code: '28992', name: 'Amersfoort / RD New', area: 'Netherlands', unit: 'metre', kind: 'Projected', datum: 'Amersfoort' },
  { code: '32632', name: 'WGS 84 / UTM zone 32N', area: 'World 6°-12°E', unit: 'metre', kind: 'Projected', datum: 'WGS84' },
  { code: '32633', name: 'WGS 84 / UTM zone 33N', area: 'World 12°-18°E', unit: 'metre', kind: 'Projected', datum: 'WGS84' },
];

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

  const localIndex = useMemo(() => {
    return COMMON_CRS.map(crs => ({
      ...crs,
      _s: `${crs.code} ${crs.name} ${crs.area} ${crs.datum ?? ''} ${crs.projection ?? ''}`.toLowerCase(),
    }));
  }, []);

  const search = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    const queryLower = trimmed.toLowerCase();
    const isCode = /^\d+$/.test(trimmed);
    const localMatches = localIndex
      .filter(c => isCode ? c.code.startsWith(trimmed) : c._s.includes(queryLower))
      .slice(0, 10);

    if (localMatches.length > 0) {
      setResults(localMatches);
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const datasetVersion = await loadEpsgIndexDatasetVersion();
      if (controller.signal.aborted) return;

      console.debug('[EPSG Lookup] Search started', {
        query: trimmed,
        isCode,
        datasetVersion,
        localMatchCount: localMatches.length,
      });

      const indexResults = isCode
        ? (() => {
            const exact = lookupEpsgByCode(trimmed);
            return exact.then(entry => entry ? [entry] : []);
          })()
        : searchEpsgIndex(trimmed, { limit: 25 });

      const resolved = await indexResults;
      if (controller.signal.aborted) return;

      const mappedResults = resolved.map(toDialogResult);

      console.debug('[EPSG Lookup] Search finished', {
        query: trimmed,
        isCode,
        resultCount: mappedResults.length,
        topResults: mappedResults.slice(0, 5).map(result => ({
          code: result.code,
          name: result.name,
        })),
      });

      if (mappedResults.length > 0) {
        setResults(mappedResults);
        setError(null);
      } else if (localMatches.length === 0) {
        setResults([]);
        setError('No coordinate reference systems found');
        console.warn('[EPSG Lookup] No matches found', {
          query: trimmed,
          isCode,
          datasetVersion,
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[EPSG Lookup] Local search failed', {
        query: trimmed,
        error: err,
      });
      if (localMatches.length === 0) {
        setError('Search unavailable — check browser console for EPSG logs');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [localIndex]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }, [search]);

  const handleSelect = useCallback((result: EpsgResult) => {
    onSelect(result);
    setOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelect]);

  useEffect(() => {
    if (open && !query) {
      setResults(COMMON_CRS.slice(0, 8));
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
      <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden" hideCloseButton>
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4 text-teal-500" />
            EPSG Lookup
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Search by code, name, country, or datum
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-3">
          <Input
            placeholder="e.g. 2056, UTM, Switzerland, Tokyo..."
            value={query}
            onChange={handleInputChange}
            leftIcon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            className="h-8 text-xs"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-[11px] text-muted-foreground px-4 pb-2">{error}</p>
        )}

        {results.length > 0 && (
          <div className="border-t overflow-y-auto max-h-[280px]">
            {results.map((result) => (
              <button
                key={result.code}
                className="w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0"
                onClick={() => handleSelect(result)}
              >
                <div className="flex items-baseline gap-2 min-w-0">
                  <code className="text-[11px] font-bold text-teal-600 dark:text-teal-400 shrink-0">{result.code}</code>
                  <span className="text-[11px] text-foreground truncate">{result.name}</span>
                  {result.kind && (
                    <span className="text-[9px] text-muted-foreground shrink-0 ml-auto">{result.kind}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                  {result.area && <span className="truncate">{result.area}</span>}
                  {result.datum && <span className="shrink-0">{result.datum}</span>}
                  {result.unit && <span className="shrink-0">{result.unit}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

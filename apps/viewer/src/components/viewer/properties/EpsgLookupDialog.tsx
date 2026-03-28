/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EPSG lookup dialog - search by code or name.
 *
 * Uses two API sources with automatic fallback:
 * 1. EPSG.org Registry API (apps.epsg.org) - authoritative, free, no key
 * 2. epsg.io direct code lookup - fallback for code-only queries
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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

// ── API search functions ───────────────────────────────────────────────

/** Search via EPSG.org Registry API (authoritative, free, no key) */
async function searchEpsgRegistry(
  query: string,
  signal: AbortSignal
): Promise<EpsgResult[]> {
  const isCode = /^\d+$/.test(query);

  if (isCode) {
    // Direct code lookup
    const res = await fetch(
      `https://apps.epsg.org/api/v1/CoordRefSystem/${query}`,
      { signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !data.Code) return [];
    return [{
      code: String(data.Code),
      name: String(data.Name || ''),
      area: data.AreaOfUse?.Name ? String(data.AreaOfUse.Name) : '',
      unit: data.CoordSys?.CoordinateAxis?.[0]?.Uom?.Name
        ? String(data.CoordSys.CoordinateAxis[0].Uom.Name) : '',
      kind: data.Kind ? String(data.Kind) : undefined,
      datum: data.Datum?.Name ? String(data.Datum.Name) : undefined,
      projection: data.Projection?.Name ? String(data.Projection.Name) : undefined,
    }];
  }

  // Name search
  const res = await fetch(
    `https://apps.epsg.org/api/v1/CoordRefSystem?searchText=${encodeURIComponent(query)}&pageSize=20&includeDeprecated=false`,
    { signal, headers: { Accept: 'application/json' } }
  );
  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];

  return items
    .filter((r: Record<string, unknown>) => r.Code && r.Name)
    .slice(0, 20)
    .map((r: Record<string, unknown>) => ({
      code: String(r.Code),
      name: String(r.Name || ''),
      area: (r as Record<string, Record<string, unknown>>).AreaOfUse?.Name
        ? String((r as Record<string, Record<string, unknown>>).AreaOfUse.Name) : '',
      unit: '',
      kind: r.Kind ? String(r.Kind) : undefined,
      datum: (r as Record<string, Record<string, unknown>>).Datum?.Name
        ? String((r as Record<string, Record<string, unknown>>).Datum.Name) : undefined,
    }));
}

/** Search via epsg.io (fallback, works for code lookups) */
async function searchEpsgIo(
  query: string,
  signal: AbortSignal
): Promise<EpsgResult[]> {
  const isCode = /^\d+$/.test(query);
  const url = isCode
    ? `https://epsg.io/${query}.json`
    : `https://epsg.io/?q=${encodeURIComponent(query)}&format=json`;

  const res = await fetch(url, { signal });
  if (!res.ok) return [];

  const data = await res.json();
  const rawResults = data.results || [];

  return rawResults
    .filter((r: Record<string, unknown>) =>
      r.code && r.name && (r.kind === 'CRS-PROJCRS' || r.kind === 'CRS-GEOGCRS' || r.kind === 'CRS-COMPOUNDCRS' || isCode)
    )
    .slice(0, 20)
    .map((r: Record<string, unknown>) => ({
      code: String(r.code),
      name: String(r.name || ''),
      area: String(r.area || ''),
      unit: String(r.unit || ''),
      kind: r.kind ? String(r.kind) : undefined,
      datum: r.datum ? String(r.datum) : undefined,
      projection: r.projection ? String(r.projection) : undefined,
    }));
}

/** Search with fallback: EPSG.org → epsg.io */
async function searchWithFallback(
  query: string,
  signal: AbortSignal
): Promise<EpsgResult[]> {
  // Try EPSG.org registry first
  try {
    const results = await searchEpsgRegistry(query, signal);
    if (results.length > 0) return results;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Fall through to epsg.io
  }

  // Fallback to epsg.io
  return searchEpsgIo(query, signal);
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

  const search = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const mapped = await searchWithFallback(trimmed, controller.signal);
      if (controller.signal.aborted) return;

      setResults(mapped);
      if (mapped.length === 0) {
        setError('No coordinate reference systems found');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Failed to search — check your internet connection');
      setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 400);
  }, [search]);

  const handleSelect = useCallback((result: EpsgResult) => {
    onSelect(result);
    setOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelect]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Format kind label for display
  const kindLabel = (kind?: string) => {
    if (!kind) return null;
    if (kind.includes('projected') || kind === 'CRS-PROJCRS') return 'Projected';
    if (kind.includes('geographic') || kind === 'CRS-GEOGCRS') return 'Geographic';
    if (kind.includes('compound') || kind === 'CRS-COMPOUNDCRS') return 'Compound';
    return kind.replace('CRS-', '');
  };

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
            Search by EPSG code (e.g. 3857) or name (e.g. &quot;Web Mercator&quot;, &quot;UTM Zone 10N&quot;)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Enter EPSG code or search by name..."
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
                        EPSG:{result.code}
                      </span>
                      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate flex-1">
                        {result.name}
                      </span>
                      {kindLabel(result.kind) && (
                        <span className="text-[9px] font-mono px-1 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 shrink-0">
                          {kindLabel(result.kind)}
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

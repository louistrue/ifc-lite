/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EPSG lookup dialog - search by code or name via epsg.io API.
 * Allows users to find and apply a coordinate reference system.
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
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface EpsgResult {
  code: string;
  name: string;
  area: string;
  unit: string;
  datum?: string;
  projection?: string;
}

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

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      // Check if it's a direct EPSG code lookup
      const isCode = /^\d+$/.test(trimmed);
      const url = isCode
        ? `https://epsg.io/${trimmed}.json`
        : `https://epsg.io/?q=${encodeURIComponent(trimmed)}&format=json&trans=1`;

      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`Search failed (${response.status})`);
      }

      const data = await response.json();
      const rawResults = data.results || [];

      const mapped: EpsgResult[] = rawResults
        .filter((r: Record<string, unknown>) =>
          r.code && r.name && (r.kind === 'CRS-PROJCRS' || r.kind === 'CRS-GEOGCRS' || r.kind === 'CRS-COMPOUNDCRS' || isCode)
        )
        .slice(0, 20)
        .map((r: Record<string, unknown>) => ({
          code: String(r.code),
          name: String(r.name || ''),
          area: String(r.area || ''),
          unit: String(r.unit || ''),
          datum: r.datum ? String(r.datum) : undefined,
          projection: r.projection ? String(r.projection) : undefined,
        }));

      if (controller.signal.aborted) return;

      setResults(mapped);
      if (mapped.length === 0 && trimmed) {
        setError('No results found');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Failed to search EPSG database');
      setResults([]);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      search(value);
    }, 300);
  }, [search]);

  const handleSelect = useCallback((result: EpsgResult) => {
    onSelect(result);
    setOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelect]);

  // Cleanup on unmount
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
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2">
            <Search className="h-3 w-3" />
            EPSG Lookup
          </Button>
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
                    className="w-full text-left px-3 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors group"
                    onClick={() => handleSelect(result)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-1.5 py-0.5 border border-teal-200 dark:border-teal-800 shrink-0">
                        EPSG:{result.code}
                      </span>
                      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {result.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      {result.area && (
                        <span className="flex items-center gap-0.5 truncate">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          {result.area}
                        </span>
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

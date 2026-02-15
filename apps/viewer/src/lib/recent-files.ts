/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Track recently opened model files via localStorage.
 * Shared between MainToolbar (writes) and CommandPalette (reads).
 */

const KEY = 'ifc-lite:recent-files';

export interface RecentFileEntry {
  name: string;
  size: number;
  timestamp: number;
}

export function getRecentFiles(): RecentFileEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
}

export function recordRecentFiles(files: { name: string; size: number }[]) {
  try {
    const names = new Set(files.map(f => f.name));
    const existing = getRecentFiles().filter(f => !names.has(f.name));
    const entries: RecentFileEntry[] = files.map(f => ({
      name: f.name,
      size: f.size,
      timestamp: Date.now(),
    }));
    localStorage.setItem(KEY, JSON.stringify([...entries, ...existing].slice(0, 10)));
  } catch { /* noop */ }
}

/** Format bytes into human-readable size */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

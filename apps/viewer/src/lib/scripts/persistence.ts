/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persistence for user scripts via localStorage
 */

export interface SavedScript {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'ifc-lite-scripts';

export function loadSavedScripts(): SavedScript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedScript[];
  } catch {
    return [];
  }
}

export function saveScripts(scripts: SavedScript[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch {
    console.warn('[Scripts] Failed to save scripts to localStorage');
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface DesktopPreferences {
  reopenLastModelOnLaunch: boolean;
  restoreWorkspaceLayoutOnLaunch: boolean;
}

const STORAGE_KEY = 'ifc-lite:desktop-preferences:v1';
const CHANGED_EVENT = 'ifc-lite:desktop-preferences-changed';

const DEFAULT_PREFERENCES: DesktopPreferences = {
  reopenLastModelOnLaunch: true,
  restoreWorkspaceLayoutOnLaunch: true,
};

function sanitizePreferences(value: unknown): DesktopPreferences {
  const parsed = (value && typeof value === 'object') ? value as Partial<DesktopPreferences> : {};
  return {
    reopenLastModelOnLaunch: parsed.reopenLastModelOnLaunch ?? DEFAULT_PREFERENCES.reopenLastModelOnLaunch,
    restoreWorkspaceLayoutOnLaunch: parsed.restoreWorkspaceLayoutOnLaunch ?? DEFAULT_PREFERENCES.restoreWorkspaceLayoutOnLaunch,
  };
}

export function getDesktopPreferences(): DesktopPreferences {
  try {
    return sanitizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function updateDesktopPreferences(updates: Partial<DesktopPreferences>): DesktopPreferences {
  const next = { ...getDesktopPreferences(), ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGED_EVENT));
  return next;
}

export function subscribeDesktopPreferences(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}

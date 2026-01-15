/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Global keyboard shortcuts for the viewer
 */

import { useEffect, useCallback } from 'react';
import { useViewerStore } from '@/store';

interface KeyboardShortcutsOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}) {
  const { enabled = true } = options;

  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const isolateEntity = useViewerStore((s) => s.isolateEntity);
  const hideEntity = useViewerStore((s) => s.hideEntity);
  const showAll = useViewerStore((s) => s.showAll);
  const toggleTheme = useViewerStore((s) => s.toggleTheme);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input or textarea
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Get modifier keys
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    // Navigation tools
    if (key === 'v' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('select');
    }
    if (key === 'p' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('pan');
    }
    if (key === 'o' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('orbit');
    }
    if (key === 'c' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('walk');
    }
    if (key === 'm' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('measure');
    }
    if (key === 'x' && !ctrl && !shift) {
      e.preventDefault();
      setActiveTool('section');
    }

    // Visibility controls
    if (key === 'i' && !ctrl && !shift && selectedEntityId) {
      e.preventDefault();
      isolateEntity(selectedEntityId);
    }
    if ((key === 'delete' || key === 'backspace') && !ctrl && !shift && selectedEntityId) {
      e.preventDefault();
      hideEntity(selectedEntityId);
    }
    if (key === 'a' && !ctrl && !shift) {
      e.preventDefault();
      showAll();
    }

    // Selection - Escape clears selection and switches to select tool
    if (key === 'escape') {
      e.preventDefault();
      setSelectedEntityId(null);
      showAll();
      setActiveTool('select');
    }

    // Theme toggle
    if (key === 't' && !ctrl && !shift) {
      e.preventDefault();
      toggleTheme();
    }

    // Help - handled by KeyboardShortcutsDialog hook
    // The dialog hook listens for '?' key globally
  }, [
    selectedEntityId,
    setSelectedEntityId,
    setActiveTool,
    isolateEntity,
    hideEntity,
    showAll,
    toggleTheme,
  ]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

// Export shortcut definitions for UI display
export const KEYBOARD_SHORTCUTS = [
  { key: 'V', description: 'Select tool', category: 'Tools' },
  { key: 'B', description: 'Box select tool', category: 'Tools' },
  { key: 'P', description: 'Pan tool', category: 'Tools' },
  { key: 'O', description: 'Orbit tool', category: 'Tools' },
  { key: 'C', description: 'Walk mode', category: 'Tools' },
  { key: 'M', description: 'Measure tool', category: 'Tools' },
  { key: 'X', description: 'Section tool', category: 'Tools' },
  { key: 'I', description: 'Isolate selection', category: 'Visibility' },
  { key: 'Del', description: 'Hide selection', category: 'Visibility' },
  { key: 'A', description: 'Show all', category: 'Visibility' },
  { key: 'H', description: 'Home (Isometric view)', category: 'Camera' },
  { key: 'Z', description: 'Fit all (zoom extents)', category: 'Camera' },
  { key: 'F', description: 'Frame selection', category: 'Camera' },
  { key: '0-6', description: 'Preset views', category: 'Camera' },
  { key: 'T', description: 'Toggle theme', category: 'UI' },
  { key: 'Esc', description: 'Clear selection & switch to Select tool', category: 'Selection' },
  { key: '?', description: 'Show keyboard shortcuts', category: 'Help' },
] as const;

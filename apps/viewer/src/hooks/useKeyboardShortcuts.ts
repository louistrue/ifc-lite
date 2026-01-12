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
    if (key === 'h' && !ctrl && !shift && !selectedEntityId) {
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
    if (key === 'h' && !ctrl && !shift && selectedEntityId) {
      e.preventDefault();
      hideEntity(selectedEntityId);
    }
    if (key === 'a' && !ctrl && !shift) {
      e.preventDefault();
      showAll();
    }

    // Selection
    if (key === 'escape') {
      e.preventDefault();
      setSelectedEntityId(null);
      showAll();
    }

    // Theme toggle
    if (key === 't' && !ctrl && !shift) {
      e.preventDefault();
      toggleTheme();
    }

    // Help
    if (key === '?' || (key === '/' && shift)) {
      e.preventDefault();
      // Could show a shortcuts modal here
      console.log('Keyboard Shortcuts:');
      console.log('V - Select tool');
      console.log('H - Pan tool (or hide selection)');
      console.log('O - Orbit tool');
      console.log('C - Walk mode');
      console.log('M - Measure tool');
      console.log('X - Section tool');
      console.log('I - Isolate selection');
      console.log('A - Show all');
      console.log('T - Toggle theme');
      console.log('Escape - Clear selection');
      console.log('1-6 - Preset views');
    }
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
  { key: 'H', description: 'Pan tool', category: 'Tools' },
  { key: 'O', description: 'Orbit tool', category: 'Tools' },
  { key: 'C', description: 'Walk mode', category: 'Tools' },
  { key: 'M', description: 'Measure tool', category: 'Tools' },
  { key: 'X', description: 'Section tool', category: 'Tools' },
  { key: 'I', description: 'Isolate selection', category: 'Visibility' },
  { key: 'H', description: 'Hide selection', category: 'Visibility' },
  { key: 'A', description: 'Show all', category: 'Visibility' },
  { key: 'T', description: 'Toggle theme', category: 'UI' },
  { key: 'Esc', description: 'Clear selection', category: 'Selection' },
  { key: '1-6', description: 'Preset views', category: 'Camera' },
  { key: 'F', description: 'Fit all', category: 'Camera' },
] as const;

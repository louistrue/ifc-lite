/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Global keyboard shortcuts for the viewer
 */

import { useEffect, useCallback } from 'react';
import { useViewerStore, stringToEntityRef } from '@/store';
import type { EntityRef } from '@/store';

interface KeyboardShortcutsOptions {
  enabled?: boolean;
}

/** Clear multi-select state so subsequent operations use single-entity selectedEntity */
function clearMultiSelect(): void {
  const state = useViewerStore.getState();
  if (state.selectedEntitiesSet.size > 0) {
    useViewerStore.setState({ selectedEntitiesSet: new Set(), selectedEntityIds: new Set() });
  }
}

/** Get all selected global IDs — multi-select if available, else single selectedEntityId */
function getAllSelectedGlobalIds(): number[] {
  const state = useViewerStore.getState();
  if (state.selectedEntityIds.size > 0) {
    return Array.from(state.selectedEntityIds);
  }
  if (state.selectedEntityId !== null) {
    return [state.selectedEntityId];
  }
  return [];
}

/** Get current selection as EntityRef[] — multi-select if available, else single */
function getSelectionRefsFromStore(): EntityRef[] {
  const state = useViewerStore.getState();
  if (state.selectedEntitiesSet.size > 0) {
    const refs: EntityRef[] = [];
    for (const str of state.selectedEntitiesSet) {
      refs.push(stringToEntityRef(str));
    }
    return refs;
  }
  if (state.selectedEntity) {
    return [state.selectedEntity];
  }
  return [];
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}) {
  const { enabled = true } = options;

  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showAll = useViewerStore((s) => s.showAll);
  const clearStoreySelection = useViewerStore((s) => s.clearStoreySelection);
  const toggleTheme = useViewerStore((s) => s.toggleTheme);

  // Basket actions
  const setBasket = useViewerStore((s) => s.setBasket);
  const addToBasket = useViewerStore((s) => s.addToBasket);
  const removeFromBasket = useViewerStore((s) => s.removeFromBasket);
  const clearBasket = useViewerStore((s) => s.clearBasket);
  const showPinboard = useViewerStore((s) => s.showPinboard);

  // Measure tool specific actions
  const activeMeasurement = useViewerStore((s) => s.activeMeasurement);
  const cancelMeasurement = useViewerStore((s) => s.cancelMeasurement);
  const clearMeasurements = useViewerStore((s) => s.clearMeasurements);
  const toggleSnap = useViewerStore((s) => s.toggleSnap);

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

    // Basket / Visibility controls
    // I = Set basket (isolate selection as basket), or re-apply basket if no selection
    if (key === 'i' && !ctrl && !shift) {
      const state = useViewerStore.getState();
      // If basket already exists and user hasn't explicitly multi-selected,
      // re-apply the basket instead of replacing it with a stale single selection.
      if (state.pinboardEntities.size > 0 && state.selectedEntitiesSet.size === 0) {
        e.preventDefault();
        showPinboard();
      } else {
        const refs = getSelectionRefsFromStore();
        if (refs.length > 0) {
          e.preventDefault();
          setBasket(refs);
          // Consume multi-select so subsequent − removes a single entity
          clearMultiSelect();
        }
      }
    }

    // + or = (with shift) = Add to basket
    if ((e.key === '+' || (e.key === '=' && shift)) && !ctrl) {
      e.preventDefault();
      const refs = getSelectionRefsFromStore();
      if (refs.length > 0) {
        addToBasket(refs);
        // Consume multi-select so subsequent − removes a single entity
        clearMultiSelect();
      }
    }

    // - or _ = Remove from basket
    if ((e.key === '-' || e.key === '_') && !ctrl) {
      e.preventDefault();
      const refs = getSelectionRefsFromStore();
      if (refs.length > 0) {
        removeFromBasket(refs);
        // Consume multi-select after removal
        clearMultiSelect();
      }
    }

    if ((key === 'delete' || key === 'backspace') && !ctrl && !shift && selectedEntityId) {
      e.preventDefault();
      const ids = getAllSelectedGlobalIds();
      hideEntities(ids);
      clearMultiSelect();
    }
    // Space to hide — skip when focused on buttons/selects/links where Space has native behavior
    if (key === ' ' && !ctrl && !shift && selectedEntityId) {
      const tag = document.activeElement?.tagName;
      if (tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') {
        e.preventDefault();
        const ids = getAllSelectedGlobalIds();
        hideEntities(ids);
        clearMultiSelect();
      }
    }
    if (key === 'a' && !ctrl && !shift) {
      e.preventDefault();
      showAll();             // Clear hiddenEntities + isolatedEntities (basket preserved)
      clearStoreySelection(); // Also clear storey filtering
    }

    // Measure tool shortcuts
    if (activeTool === 'measure') {
      // Cancel active measurement with ESC
      if (key === 'escape' && activeMeasurement) {
        e.preventDefault();
        cancelMeasurement();
        return;
      }
      // Clear all measurements with Ctrl+C or Cmd+C
      if (key === 'c' && ctrl && !shift) {
        e.preventDefault();
        clearMeasurements();
        return;
      }
      // Toggle snapping with S
      if (key === 's' && !ctrl && !shift) {
        e.preventDefault();
        toggleSnap();
        return;
      }
      // Delete/Backspace clears measurements (when nothing is selected)
      if ((key === 'delete' || key === 'backspace') && !ctrl && !shift && !selectedEntityId) {
        e.preventDefault();
        clearMeasurements();
        return;
      }
    }

    // Selection - Escape clears selection and switches to select tool
    if (key === 'escape') {
      e.preventDefault();
      setSelectedEntityId(null);
      clearBasket();
      showAll();
      clearStoreySelection(); // Also clear storey filtering
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
    activeTool,
    setActiveTool,
    setBasket,
    addToBasket,
    removeFromBasket,
    clearBasket,
    showPinboard,
    hideEntities,
    showAll,
    clearStoreySelection,
    toggleTheme,
    activeMeasurement,
    cancelMeasurement,
    clearMeasurements,
    toggleSnap,
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
  { key: 'P', description: 'Pan tool', category: 'Tools' },
  { key: 'O', description: 'Orbit tool', category: 'Tools' },
  { key: 'C', description: 'Walk mode', category: 'Tools' },
  { key: 'M', description: 'Measure tool', category: 'Tools' },
  { key: 'X', description: 'Section tool', category: 'Tools' },
  { key: 'S', description: 'Toggle snapping (Measure tool)', category: 'Tools' },
  { key: 'Esc', description: 'Cancel measurement (Measure tool)', category: 'Tools' },
  { key: 'Ctrl+C', description: 'Clear measurements (Measure tool)', category: 'Tools' },
  { key: 'I', description: 'Set basket (isolate selection)', category: 'Visibility' },
  { key: '+', description: 'Add selection to basket', category: 'Visibility' },
  { key: '−', description: 'Remove selection from basket', category: 'Visibility' },
  { key: 'Del / Space', description: 'Hide selection', category: 'Visibility' },
  { key: 'A', description: 'Show all (clear filters, keep basket)', category: 'Visibility' },
  { key: 'H', description: 'Home (Isometric view)', category: 'Camera' },
  { key: 'Z', description: 'Fit all (zoom extents)', category: 'Camera' },
  { key: 'F', description: 'Frame selection', category: 'Camera' },
  { key: '1-6', description: 'Preset views', category: 'Camera' },
  { key: 'T', description: 'Toggle theme', category: 'UI' },
  { key: 'Esc', description: 'Reset all (clear selection, basket, isolation)', category: 'Selection' },
  { key: 'Ctrl+K', description: 'Command palette', category: 'UI' },
  { key: '?', description: 'Show info panel', category: 'Help' },
] as const;

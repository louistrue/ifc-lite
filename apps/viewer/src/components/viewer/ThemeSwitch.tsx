/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef } from 'react';
import { ThemeToggle } from 'beautiful-theme-toggle';
import { useViewerStore } from '@/store';

/**
 * Animated SVG theme toggle (sun/moon) powered by beautiful-theme-toggle.
 *
 * Bidirectional sync:
 *  - User clicks the widget  → onChange → store.setTheme
 *  - External change (keyboard shortcut / command palette) → store updates → widget.setTheme
 */
export function ThemeSwitch() {
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<ThemeToggle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const currentTheme = useViewerStore.getState().theme;

    const toggle = new ThemeToggle({
      element: containerRef.current,
      size: 80,
      initialState: currentTheme,
      onChange: (state) => {
        useViewerStore.getState().setTheme(state);
      },
    });

    toggleRef.current = toggle;

    // Subscribe to external theme changes so the widget stays in sync
    let prevTheme = currentTheme;
    const unsub = useViewerStore.subscribe((state) => {
      if (state.theme !== prevTheme) {
        prevTheme = state.theme;
        if (toggleRef.current && toggleRef.current.getTheme() !== state.theme) {
          toggleRef.current.setTheme(state.theme, false);
        }
      }
    });

    return () => {
      unsub();
      toggle.destroy();
      toggleRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="flex items-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity" />;
}

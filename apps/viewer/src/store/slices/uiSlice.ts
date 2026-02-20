/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * UI state slice
 */

import type { StateCreator } from 'zustand';
import { UI_DEFAULTS } from '../constants.js';
import type { ContactShadingQuality } from '@ifc-lite/renderer';

export interface UISlice {
  // State
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  activeTool: string;
  theme: 'light' | 'dark';
  isMobile: boolean;
  hoverTooltipsEnabled: boolean;
  visualEnhancementsEnabled: boolean;
  edgeContrastEnabled: boolean;
  edgeContrastIntensity: number;
  contactShadingQuality: ContactShadingQuality;
  contactShadingIntensity: number;
  contactShadingRadius: number;

  // Actions
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setActiveTool: (tool: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setIsMobile: (isMobile: boolean) => void;
  toggleHoverTooltips: () => void;
  setVisualEnhancementsEnabled: (enabled: boolean) => void;
  setEdgeContrastEnabled: (enabled: boolean) => void;
  setEdgeContrastIntensity: (intensity: number) => void;
  setContactShadingQuality: (quality: ContactShadingQuality) => void;
  setContactShadingIntensity: (intensity: number) => void;
  setContactShadingRadius: (radius: number) => void;
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set, get) => ({
  // Initial state
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  activeTool: UI_DEFAULTS.ACTIVE_TOOL,
  theme: UI_DEFAULTS.THEME,
  isMobile: false,
  hoverTooltipsEnabled: UI_DEFAULTS.HOVER_TOOLTIPS_ENABLED,
  visualEnhancementsEnabled: UI_DEFAULTS.VISUAL_ENHANCEMENTS_ENABLED,
  edgeContrastEnabled: UI_DEFAULTS.EDGE_CONTRAST_ENABLED,
  edgeContrastIntensity: UI_DEFAULTS.EDGE_CONTRAST_INTENSITY,
  contactShadingQuality: UI_DEFAULTS.CONTACT_SHADING_QUALITY,
  contactShadingIntensity: UI_DEFAULTS.CONTACT_SHADING_INTENSITY,
  contactShadingRadius: UI_DEFAULTS.CONTACT_SHADING_RADIUS,

  // Actions
  setLeftPanelCollapsed: (leftPanelCollapsed) => set({ leftPanelCollapsed }),
  setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
  setActiveTool: (activeTool) => set({ activeTool }),

  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ifc-lite-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    localStorage.setItem('ifc-lite-theme', newTheme);
    set({ theme: newTheme });
  },

  setIsMobile: (isMobile) => set({ isMobile }),
  toggleHoverTooltips: () => set((state) => ({ hoverTooltipsEnabled: !state.hoverTooltipsEnabled })),
  setVisualEnhancementsEnabled: (visualEnhancementsEnabled) => set({ visualEnhancementsEnabled }),
  setEdgeContrastEnabled: (edgeContrastEnabled) => set({ edgeContrastEnabled }),
  setEdgeContrastIntensity: (edgeContrastIntensity) => set({ edgeContrastIntensity }),
  setContactShadingQuality: (contactShadingQuality) => set({ contactShadingQuality }),
  setContactShadingIntensity: (contactShadingIntensity) => set({ contactShadingIntensity }),
  setContactShadingRadius: (contactShadingRadius) => set({ contactShadingRadius }),
});

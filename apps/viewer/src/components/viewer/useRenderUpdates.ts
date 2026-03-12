/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Render updates hook for the 3D viewport
 *
 * Single consolidated effect for triggering re-renders when visibility,
 * selection, section plane, hover, or theme state changes.
 *
 * CRITICAL: Only ONE render call per state change to avoid flickering.
 * The 2D overlay upload and the 3D render happen in the same effect.
 */

import { useEffect, type MutableRefObject } from 'react';
import type { Renderer, CutPolygon2D, DrawingLine2D, VisualEnhancementOptions } from '@ifc-lite/renderer';
import type { CoordinateInfo } from '@ifc-lite/geometry';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { SectionPlane } from '@/store';
import { getThemeClearColor } from '../../utils/viewportUtils.js';

export interface UseRenderUpdatesParams {
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;

  // Theme
  theme: string;
  clearColorRef: MutableRefObject<[number, number, number, number]>;
  visualEnhancementRef: MutableRefObject<VisualEnhancementOptions>;

  // Visibility/selection state (reactive values, not refs)
  hiddenEntities: Set<number>;
  isolatedEntities: Set<number> | null;
  selectedEntityId: number | null;
  selectedEntityIds: Set<number> | undefined;
  selectedModelIndex: number | undefined;
  activeTool: string;
  sectionPlane: SectionPlane;
  sectionRange: { min: number; max: number } | null;
  coordinateInfo?: CoordinateInfo;

  // Refs for animation-loop renders (not used here, kept for interface compat)
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  selectedEntityIdsRef: MutableRefObject<Set<number> | undefined>;
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  activeToolRef: MutableRefObject<string>;

  // Drawing 2D
  drawing2D: Drawing2D | null;
  show3DOverlay: boolean;
  showHiddenLines: boolean;
}

/**
 * Build the section plane render option.
 * Returns undefined when the section tool is not active.
 * Only passes axis-mode data to the renderer (face mode is not yet supported in the renderer).
 */
function buildSectionOption(
  activeTool: string,
  sectionPlane: SectionPlane,
  sectionRange: { min: number; max: number } | null,
): import('@ifc-lite/renderer').SectionPlane | undefined {
  if (activeTool !== 'section') return undefined;

  // Face mode: renderer doesn't understand arbitrary normals yet.
  // Only pass section data when in axis mode.
  if (sectionPlane.mode === 'face') return undefined;

  return {
    axis: sectionPlane.axis,
    position: sectionPlane.position,
    enabled: sectionPlane.enabled,
    flipped: sectionPlane.flipped,
    min: sectionRange?.min,
    max: sectionRange?.max,
  };
}

export function useRenderUpdates(params: UseRenderUpdatesParams): void {
  const {
    rendererRef,
    isInitialized,
    theme,
    clearColorRef,
    visualEnhancementRef,
    hiddenEntities,
    isolatedEntities,
    selectedEntityId,
    selectedEntityIds,
    selectedModelIndex,
    activeTool,
    sectionPlane,
    sectionRange,
    coordinateInfo,
    sectionPlaneRef,
    sectionRangeRef,
    drawing2D,
    show3DOverlay,
    showHiddenLines,
  } = params;

  // Theme-aware clear color update (separate effect — theme changes are rare)
  useEffect(() => {
    clearColorRef.current = getThemeClearColor(theme as 'light' | 'dark');
  }, [theme]);

  // SINGLE consolidated render effect.
  // Handles: visibility, selection, section plane, drawing overlay, theme.
  // Only ONE renderer.render() call per state change — no flickering.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    // Step 1: Update 2D section overlay if needed
    if (activeTool === 'section' && sectionPlane.mode === 'axis' && drawing2D && drawing2D.cutPolygons.length > 0 && show3DOverlay) {
      const polygons: CutPolygon2D[] = drawing2D.cutPolygons.map((cp) => ({
        polygon: cp.polygon,
        ifcType: cp.ifcType,
        expressId: cp.entityId,
      }));

      const lines: DrawingLine2D[] = drawing2D.lines
        .filter((line) => showHiddenLines || line.visibility !== 'hidden')
        .map((line) => ({
          line: line.line,
          category: line.category,
        }));

      renderer.uploadSection2DOverlay(
        polygons,
        lines,
        sectionPlane.axis,
        sectionPlane.position,
        sectionRangeRef.current ?? undefined,
        sectionPlane.flipped
      );
    } else {
      renderer.clearSection2DOverlay();
    }

    // Step 2: Update persistent section state on the renderer.
    // This ensures ALL subsequent renders (streaming, color updates, animation loop)
    // respect section clipping even if they don't pass sectionPlane in options.
    const sectionOpt = buildSectionOption(activeTool, sectionPlane, sectionRange);
    renderer.setSectionPlane(sectionOpt, coordinateInfo?.buildingRotation);
    if (sectionOpt) {
      console.debug('[RenderUpdates] section →', sectionOpt.axis, 'pos=' + sectionOpt.position, 'en=' + sectionOpt.enabled, 'range=', sectionOpt.min, sectionOpt.max);
    }

    // Step 3: Single render call
    renderer.render({
      hiddenIds: hiddenEntities,
      isolatedIds: isolatedEntities,
      selectedId: selectedEntityId,
      selectedIds: selectedEntityIds,
      selectedModelIndex,
      clearColor: clearColorRef.current,
      visualEnhancement: visualEnhancementRef.current,
      sectionPlane: sectionOpt,
      buildingRotation: coordinateInfo?.buildingRotation,
    });
  }, [
    // All reactive dependencies — any change triggers exactly ONE render
    hiddenEntities,
    isolatedEntities,
    selectedEntityId,
    selectedEntityIds,
    selectedModelIndex,
    isInitialized,
    sectionPlane,
    activeTool,
    sectionRange,
    coordinateInfo?.buildingRotation,
    theme,
    drawing2D,
    show3DOverlay,
    showHiddenLines,
  ]);
}

export default useRenderUpdates;

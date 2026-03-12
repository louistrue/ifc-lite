/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Render updates hook for the 3D viewport
 *
 * Single source of truth for triggering re-renders when visibility, selection,
 * section plane, hover, or theme state changes. Consolidates all render calls
 * to avoid competing effects that cause flickering.
 */

import { useEffect, useCallback, type MutableRefObject } from 'react';
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

  // Refs for theme re-render
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
 * Build the section plane render option from current state.
 * Returns undefined when the section tool is not active.
 */
function buildSectionOption(
  activeTool: string,
  sectionPlane: SectionPlane,
  sectionRange: { min: number; max: number } | null,
): import('@ifc-lite/renderer').SectionPlane | undefined {
  if (activeTool !== 'section') return undefined;

  // Face mode: the renderer still uses the standard axis/position interface,
  // but the normal/distance are computed from the face data inside the renderer.
  // We pass the face data through the existing section plane options.
  return {
    ...sectionPlane,
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
    hiddenEntitiesRef,
    isolatedEntitiesRef,
    selectedEntityIdRef,
    selectedModelIndexRef,
    selectedEntityIdsRef,
    sectionPlaneRef,
    sectionRangeRef,
    activeToolRef,
    drawing2D,
    show3DOverlay,
    showHiddenLines,
  } = params;

  // Helper: perform a render with current state
  const doRender = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    renderer.render({
      hiddenIds: hiddenEntitiesRef.current,
      isolatedIds: isolatedEntitiesRef.current,
      selectedId: selectedEntityIdRef.current,
      selectedIds: selectedEntityIdsRef.current,
      selectedModelIndex: selectedModelIndexRef.current,
      clearColor: clearColorRef.current,
      visualEnhancement: visualEnhancementRef.current,
      sectionPlane: buildSectionOption(
        activeToolRef.current,
        sectionPlaneRef.current,
        sectionRangeRef.current,
      ),
      buildingRotation: coordinateInfo?.buildingRotation,
    });
  }, [isInitialized, coordinateInfo?.buildingRotation]);

  // Theme-aware clear color update
  useEffect(() => {
    clearColorRef.current = getThemeClearColor(theme as 'light' | 'dark');
    doRender();
  }, [theme, doRender]);

  // 2D section overlay: upload drawing data to renderer when available
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    if (activeTool === 'section' && drawing2D && drawing2D.cutPolygons.length > 0 && show3DOverlay) {
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

    doRender();
  }, [drawing2D, activeTool, sectionPlane, isInitialized, coordinateInfo, show3DOverlay, showHiddenLines, doRender]);

  // Re-render when visibility, selection, or section plane changes.
  // This is the single consolidated effect — no competing render calls.
  useEffect(() => {
    doRender();
  }, [
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
    doRender,
  ]);
}

export default useRenderUpdates;

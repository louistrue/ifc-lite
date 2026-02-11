/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens evaluation hook
 *
 * Evaluates active lens rules against all entities across all models,
 * producing a color map and hidden IDs set that are applied to the renderer.
 * Unmatched entities with geometry are ghosted (semi-transparent).
 *
 * The pure evaluation logic lives in @ifc-lite/lens — this hook handles
 * React lifecycle, original-color capture/restore, and Zustand integration.
 *
 * Performance notes:
 * - Does NOT subscribe to `models` or `ifcDataStore` — reads them from
 *   getState() only when the active lens changes. This prevents re-evaluation
 *   during model loading.
 * - Uses `setPendingColorUpdates` instead of `updateMeshColors` to avoid
 *   cloning the entire mesh array (O(n) mesh copies) on every lens switch.
 * - Original mesh colors are captured once and restored on deactivation.
 */

import { useEffect, useRef, useCallback } from 'react';
import { evaluateLens, rgbaToHex, isGhostColor } from '@ifc-lite/lens';
import type { RGBAColor } from '@ifc-lite/lens';
import { useViewerStore } from '@/store';
import { createLensDataProvider } from '@/lib/lens';

export function useLens() {
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const savedLenses = useViewerStore((s) => s.savedLenses);

  // Track the previously active lens to detect deactivation
  const prevLensIdRef = useRef<string | null>(null);
  // Track original colors to restore when lens is deactivated
  const originalColorsRef = useRef<Map<number, RGBAColor> | null>(null);

  /** Collect original mesh colors from all geometry sources (federation + legacy) */
  const captureOriginalColors = useCallback(() => {
    const state = useViewerStore.getState();
    const originals = new Map<number, RGBAColor>();

    // Federation mode: collect from all model geometries
    if (state.models.size > 0) {
      for (const [, model] of state.models) {
        if (model.geometryResult?.meshes) {
          for (const mesh of model.geometryResult.meshes) {
            if (mesh.color) {
              originals.set(mesh.expressId, mesh.color as RGBAColor);
            }
          }
        }
      }
    }

    // Legacy mode: collect from store geometryResult
    if (state.geometryResult?.meshes) {
      for (const mesh of state.geometryResult.meshes) {
        if (mesh.color) {
          originals.set(mesh.expressId, mesh.color as RGBAColor);
        }
      }
    }

    return originals;
  }, []);

  useEffect(() => {
    const activeLens = savedLenses.find(l => l.id === activeLensId) ?? null;

    // Lens deactivated — restore original colors
    if (!activeLens && prevLensIdRef.current !== null) {
      prevLensIdRef.current = null;
      useViewerStore.getState().setLensColorMap(new Map());
      useViewerStore.getState().setLensHiddenIds(new Set());
      useViewerStore.getState().setLensRuleCounts(new Map());
      useViewerStore.getState().setLensRuleEntityIds(new Map());

      // Restore original mesh colors via lightweight pending path
      if (originalColorsRef.current && originalColorsRef.current.size > 0) {
        useViewerStore.getState().setPendingColorUpdates(originalColorsRef.current);
      }
      originalColorsRef.current = null;
      return;
    }

    if (!activeLens) return;

    // Read data sources from getState() — NOT subscribed, so model loading
    // doesn't trigger re-evaluation
    const { models, ifcDataStore } = useViewerStore.getState();
    if (models.size === 0 && !ifcDataStore) return;

    // Save original colors before first lens application
    if (prevLensIdRef.current === null) {
      originalColorsRef.current = captureOriginalColors();
    }

    prevLensIdRef.current = activeLensId;

    // Create data provider and evaluate lens using @ifc-lite/lens package
    const provider = createLensDataProvider(models, ifcDataStore);
    const { colorMap, hiddenIds, ruleCounts, ruleEntityIds } = evaluateLens(activeLens, provider);

    // Build hex color map for UI legend (exclude ghost entries)
    const hexColorMap = new Map<number, string>();
    for (const [id, rgba] of colorMap) {
      if (!isGhostColor(rgba)) {
        hexColorMap.set(id, rgbaToHex(rgba));
      }
    }
    useViewerStore.getState().setLensColorMap(hexColorMap);
    useViewerStore.getState().setLensHiddenIds(hiddenIds);
    useViewerStore.getState().setLensRuleCounts(ruleCounts);
    useViewerStore.getState().setLensRuleEntityIds(ruleEntityIds);

    // Apply ALL colors to renderer via pendingColorUpdates only —
    // no mesh cloning needed, the renderer picks these up directly
    if (colorMap.size > 0) {
      useViewerStore.getState().setPendingColorUpdates(colorMap);
    }
  }, [activeLensId, savedLenses, captureOriginalColors]);

  return {
    activeLensId,
    savedLenses,
  };
}

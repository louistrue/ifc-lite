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
 * Performance notes:
 * - Does NOT subscribe to `models` or `ifcDataStore` — reads them from
 *   getState() only when the active lens changes. This prevents re-evaluation
 *   during model loading.
 * - Uses `setPendingColorUpdates` instead of `updateMeshColors` to avoid
 *   cloning the entire mesh array (O(n) mesh copies) on every lens switch.
 * - Original mesh colors are captured once and restored on deactivation.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore, type FederatedModel } from '@/store';
import type { LensCriteria, Lens } from '@/store/slices/lensSlice';

/** Ghost color for unmatched entities: faint gray at low opacity */
const GHOST_COLOR: [number, number, number, number] = [0.6, 0.6, 0.6, 0.15];

/** Parse hex color string to RGBA tuple (0-1 range) */
function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

/** IFC subtype → base type mapping for hierarchy-aware lens matching */
const IFC_SUBTYPE_TO_BASE: Record<string, string> = {
  IfcWallStandardCase: 'IfcWall',
  IfcSlabStandardCase: 'IfcSlab',
  IfcColumnStandardCase: 'IfcColumn',
  IfcBeamStandardCase: 'IfcBeam',
  IfcStairFlight: 'IfcStair',
  IfcRampFlight: 'IfcRamp',
};

/** Check if an entity matches a LensCriteria */
function matchesCriteria(
  criteria: LensCriteria,
  expressId: number,
  dataStore: IfcDataStore,
): boolean {
  switch (criteria.type) {
    case 'ifcType': {
      if (!criteria.ifcType) return false;
      const typeName = dataStore.entities?.getTypeName?.(expressId);
      if (!typeName) return false;
      // Exact match
      if (typeName === criteria.ifcType) return true;
      // Subtype match: e.g. IfcSlabStandardCase matches an IfcSlab rule
      const baseType = IFC_SUBTYPE_TO_BASE[typeName];
      return baseType === criteria.ifcType;
    }
    case 'property': {
      if (!criteria.propertySet || !criteria.propertyName) return false;
      const value = dataStore.properties?.getPropertyValue?.(
        expressId,
        criteria.propertySet,
        criteria.propertyName,
      );
      if (criteria.operator === 'exists') {
        return value !== null && value !== undefined;
      }
      if (criteria.operator === 'contains' && criteria.propertyValue !== undefined) {
        return String(value ?? '').toLowerCase().includes(criteria.propertyValue.toLowerCase());
      }
      // default: equals
      if (criteria.propertyValue !== undefined) {
        return String(value ?? '') === criteria.propertyValue;
      }
      return value !== null && value !== undefined;
    }
    case 'material': {
      // Material matching uses property lookup on Pset_MaterialCommon or similar
      if (!criteria.materialName) return false;
      const props = dataStore.properties?.getForEntity?.(expressId);
      if (!props) return false;
      const pattern = criteria.materialName.toLowerCase();
      for (const pset of props) {
        if (pset.name.toLowerCase().includes('material')) {
          for (const prop of pset.properties) {
            if (String(prop.value ?? '').toLowerCase().includes(pattern)) {
              return true;
            }
          }
        }
      }
      return false;
    }
    default:
      return false;
  }
}

/** Evaluate rules for a single dataStore, accumulating into colorMap/hiddenIds/ruleCounts */
function evaluateDataStore(
  enabledRules: Lens['rules'],
  dataStore: IfcDataStore,
  idOffset: number,
  colorMap: Map<number, [number, number, number, number]>,
  hiddenIds: Set<number>,
  ruleCounts: Map<string, number>,
): void {
  if (!dataStore.entities) return;

  for (let i = 0; i < dataStore.entities.count; i++) {
    const expressId = dataStore.entities.expressId[i];
    const globalId = expressId + idOffset;

    // First matching rule wins
    let matched = false;
    for (const rule of enabledRules) {
      if (matchesCriteria(rule.criteria, expressId, dataStore)) {
        matched = true;
        ruleCounts.set(rule.id, (ruleCounts.get(rule.id) ?? 0) + 1);
        switch (rule.action) {
          case 'colorize':
            colorMap.set(globalId, hexToRgba(rule.color, 1));
            break;
          case 'transparent':
            colorMap.set(globalId, hexToRgba(rule.color, 0.3));
            break;
          case 'hide':
            hiddenIds.add(globalId);
            break;
        }
        break; // First match wins
      }
    }

    // Ghost unmatched entities — they'll be faded out for context
    if (!matched) {
      colorMap.set(globalId, GHOST_COLOR);
    }
  }
}

/** Evaluate a lens against all entities, returning color map, hidden IDs, and per-rule counts */
function evaluateLens(
  lens: Lens,
  models: Map<string, FederatedModel>,
  legacyDataStore: IfcDataStore | null,
): {
  colorMap: Map<number, [number, number, number, number]>;
  hiddenIds: Set<number>;
  ruleCounts: Map<string, number>;
} {
  const colorMap = new Map<number, [number, number, number, number]>();
  const hiddenIds = new Set<number>();
  const ruleCounts = new Map<string, number>();

  const enabledRules = lens.rules.filter(r => r.enabled);
  if (enabledRules.length === 0) return { colorMap, hiddenIds, ruleCounts };

  if (models.size > 0) {
    // Federation mode: evaluate across all models
    for (const [, model] of models) {
      if (!model.ifcDataStore) continue;
      evaluateDataStore(enabledRules, model.ifcDataStore, model.idOffset ?? 0, colorMap, hiddenIds, ruleCounts);
    }
  } else if (legacyDataStore) {
    // Single-model (legacy) mode: offset = 0
    evaluateDataStore(enabledRules, legacyDataStore, 0, colorMap, hiddenIds, ruleCounts);
  }

  return { colorMap, hiddenIds, ruleCounts };
}

export function useLens() {
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const savedLenses = useViewerStore((s) => s.savedLenses);

  // Track the previously active lens to detect deactivation
  const prevLensIdRef = useRef<string | null>(null);
  // Track original colors to restore when lens is deactivated
  const originalColorsRef = useRef<Map<number, [number, number, number, number]> | null>(null);

  /** Collect original mesh colors from all geometry sources (federation + legacy) */
  const captureOriginalColors = useCallback(() => {
    const state = useViewerStore.getState();
    const originals = new Map<number, [number, number, number, number]>();

    // Federation mode: collect from all model geometries
    if (state.models.size > 0) {
      for (const [, model] of state.models) {
        if (model.geometryResult?.meshes) {
          for (const mesh of model.geometryResult.meshes) {
            if (mesh.color) {
              originals.set(mesh.expressId, mesh.color as [number, number, number, number]);
            }
          }
        }
      }
    }

    // Legacy mode: collect from store geometryResult
    if (state.geometryResult?.meshes) {
      for (const mesh of state.geometryResult.meshes) {
        if (mesh.color) {
          originals.set(mesh.expressId, mesh.color as [number, number, number, number]);
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

    // Evaluate lens rules against all entities (federation or legacy single-model)
    // Ghost coloring is included: unmatched entities get GHOST_COLOR
    const { colorMap, hiddenIds, ruleCounts } = evaluateLens(activeLens, models, ifcDataStore);

    // Build hex color map for UI legend (exclude ghost entries)
    const hexColorMap = new Map<number, string>();
    for (const [id, rgba] of colorMap) {
      // Skip ghost entries (alpha < 0.2) — they're only for rendering
      if (rgba[3] < 0.2) continue;
      const r = Math.round(rgba[0] * 255).toString(16).padStart(2, '0');
      const g = Math.round(rgba[1] * 255).toString(16).padStart(2, '0');
      const b = Math.round(rgba[2] * 255).toString(16).padStart(2, '0');
      hexColorMap.set(id, `#${r}${g}${b}`);
    }
    useViewerStore.getState().setLensColorMap(hexColorMap);
    useViewerStore.getState().setLensHiddenIds(hiddenIds);
    useViewerStore.getState().setLensRuleCounts(ruleCounts);

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

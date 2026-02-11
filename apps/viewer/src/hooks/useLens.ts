/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens evaluation hook
 *
 * Evaluates active lens rules against all entities across all models,
 * producing a color map and hidden IDs set that are applied to the renderer.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore, type FederatedModel } from '@/store';
import type { LensCriteria, Lens } from '@/store/slices/lensSlice';

/** Parse hex color string to RGBA tuple (0-1 range) */
function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

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
      return typeName === criteria.ifcType;
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

/** Evaluate rules for a single dataStore, accumulating into colorMap/hiddenIds */
function evaluateDataStore(
  enabledRules: Lens['rules'],
  dataStore: IfcDataStore,
  idOffset: number,
  colorMap: Map<number, [number, number, number, number]>,
  hiddenIds: Set<number>,
): void {
  if (!dataStore.entities) return;

  for (let i = 0; i < dataStore.entities.count; i++) {
    const expressId = dataStore.entities.expressId[i];
    const globalId = expressId + idOffset;

    // First matching rule wins
    for (const rule of enabledRules) {
      if (matchesCriteria(rule.criteria, expressId, dataStore)) {
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
  }
}

/** Evaluate a lens against all entities, returning color map and hidden IDs */
function evaluateLens(
  lens: Lens,
  models: Map<string, FederatedModel>,
  legacyDataStore: IfcDataStore | null,
): { colorMap: Map<number, [number, number, number, number]>; hiddenIds: Set<number> } {
  const colorMap = new Map<number, [number, number, number, number]>();
  const hiddenIds = new Set<number>();

  const enabledRules = lens.rules.filter(r => r.enabled);
  if (enabledRules.length === 0) return { colorMap, hiddenIds };

  if (models.size > 0) {
    // Federation mode: evaluate across all models
    for (const [, model] of models) {
      if (!model.ifcDataStore) continue;
      evaluateDataStore(enabledRules, model.ifcDataStore, model.idOffset ?? 0, colorMap, hiddenIds);
    }
  } else if (legacyDataStore) {
    // Single-model (legacy) mode: offset = 0
    evaluateDataStore(enabledRules, legacyDataStore, 0, colorMap, hiddenIds);
  }

  return { colorMap, hiddenIds };
}

export function useLens() {
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const savedLenses = useViewerStore((s) => s.savedLenses);
  const models = useViewerStore((s) => s.models);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const updateMeshColors = useViewerStore((s) => s.updateMeshColors);
  const setLensColorMap = useViewerStore((s) => s.setLensColorMap);
  const setLensHiddenIds = useViewerStore((s) => s.setLensHiddenIds);

  // Track the previously active lens to detect deactivation
  const prevLensIdRef = useRef<string | null>(null);
  // Track original colors to restore when lens is deactivated
  const originalColorsRef = useRef<Map<number, [number, number, number, number]> | null>(null);

  // Store reference to geometry for restoring colors
  const getGeometryMeshes = useCallback(() => {
    const state = useViewerStore.getState();
    return state.geometryResult?.meshes ?? [];
  }, []);

  useEffect(() => {
    const activeLens = savedLenses.find(l => l.id === activeLensId) ?? null;

    // Lens deactivated - restore original colors
    if (!activeLens && prevLensIdRef.current !== null) {
      prevLensIdRef.current = null;
      setLensColorMap(new Map());
      setLensHiddenIds(new Set());

      // Restore original mesh colors
      if (originalColorsRef.current && originalColorsRef.current.size > 0) {
        updateMeshColors(originalColorsRef.current);
        originalColorsRef.current = null;
      }
      return;
    }

    if (!activeLens) return;
    // Need at least one data source: federation models or legacy single-model dataStore
    if (models.size === 0 && !ifcDataStore) return;

    // Save original colors before first application
    if (prevLensIdRef.current === null) {
      const meshes = getGeometryMeshes();
      const originals = new Map<number, [number, number, number, number]>();
      for (const mesh of meshes) {
        if (mesh.color) {
          originals.set(mesh.expressId, mesh.color as [number, number, number, number]);
        }
      }
      originalColorsRef.current = originals;
    }

    prevLensIdRef.current = activeLensId;

    // Evaluate lens rules against all entities (federation or legacy single-model)
    const { colorMap, hiddenIds } = evaluateLens(activeLens, models, ifcDataStore);

    // Update store with computed maps
    const hexColorMap = new Map<number, string>();
    for (const [id, rgba] of colorMap) {
      const r = Math.round(rgba[0] * 255).toString(16).padStart(2, '0');
      const g = Math.round(rgba[1] * 255).toString(16).padStart(2, '0');
      const b = Math.round(rgba[2] * 255).toString(16).padStart(2, '0');
      hexColorMap.set(id, `#${r}${g}${b}`);
    }
    setLensColorMap(hexColorMap);
    setLensHiddenIds(hiddenIds);

    // Apply colors to renderer via pendingColorUpdates
    if (colorMap.size > 0) {
      updateMeshColors(colorMap);
    }
  }, [activeLensId, savedLenses, models, ifcDataStore, updateMeshColors, setLensColorMap, setLensHiddenIds, getGeometryMeshes]);

  return {
    activeLensId,
    savedLenses,
  };
}

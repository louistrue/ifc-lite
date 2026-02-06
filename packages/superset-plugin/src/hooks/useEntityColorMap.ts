import { useMemo } from 'react';
import type { RGBA } from '../utils/colorScale.js';

/**
 * Builds a lookup from ExpressID (number) → RGBA color override.
 *
 * The entityColorMap from transformProps uses string entity IDs (GlobalId or
 * ExpressID-as-string). The Renderer works with numeric ExpressIDs. This hook
 * bridges the two by attempting numeric conversion on each key.
 *
 * If no color data is available, returns an empty map so the Renderer uses
 * the model's original per-mesh colors.
 */
export function useEntityColorMap(
  entityColorMap: Map<string, RGBA>,
): Map<number, RGBA> {
  return useMemo(() => {
    if (entityColorMap.size === 0) return new Map<number, RGBA>();

    const numericMap = new Map<number, RGBA>();
    for (const [key, rgba] of entityColorMap) {
      const id = Number(key);
      if (!isNaN(id) && isFinite(id)) {
        numericMap.set(id, rgba);
      }
    }
    return numericMap;
  }, [entityColorMap]);
}

/**
 * Converts a set of string entity IDs to numeric ExpressIDs.
 * Returns null if the input is null/undefined (meaning "show all").
 */
export function useNumericEntitySet(
  stringSet: Set<string> | null | undefined,
): Set<number> | null {
  return useMemo(() => {
    if (stringSet == null) return null;
    const numericSet = new Set<number>();
    for (const key of stringSet) {
      const id = Number(key);
      if (!isNaN(id) && isFinite(id)) {
        numericSet.add(id);
      }
    }
    return numericSet;
  }, [stringSet]);
}

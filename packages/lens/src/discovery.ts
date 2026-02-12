/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data discovery for the lens system.
 *
 * Samples loaded models to discover all available IFC types, property sets,
 * quantity sets, classification systems, and material names. Uses a sampling
 * strategy (not full scan) for performance on large models.
 *
 * @example
 * ```ts
 * const provider = createLensDataProvider(models, null);
 * const discovered = discoverLensData(provider);
 * // discovered.types → ['IfcWall', 'IfcSlab', 'IfcColumn', ...]
 * // discovered.propertySets → Map { 'Pset_WallCommon' => ['IsExternal', 'FireRating', ...] }
 * ```
 */

import type { LensDataProvider } from './types.js';

/** Max entities to sample per type for property/quantity discovery */
const SAMPLE_SIZE = 30;

/** Result of lens data discovery */
export interface DiscoveredLensData {
  /** All IFC type names found in loaded models, sorted alphabetically */
  types: string[];
  /** Property set names → property names (sorted) */
  propertySets: Map<string, string[]>;
  /** Quantity set names → quantity names (sorted) */
  quantitySets: Map<string, string[]>;
  /** Classification system names found */
  classificationSystems: string[];
  /** Material names found */
  materials: string[];
}

/**
 * Discover available data from loaded models via the LensDataProvider.
 *
 * Single O(n) pass through entities (capped by sampling) to collect:
 * - Entity types (all, no sampling limit)
 * - Property set names + property names (sampled)
 * - Quantity set names + quantity names (sampled)
 * - Classification systems (sampled)
 * - Material names (sampled)
 */
export function discoverLensData(provider: LensDataProvider): DiscoveredLensData {
  const typeSet = new Set<string>();
  const propertySets = new Map<string, Set<string>>();
  const quantitySets = new Map<string, Set<string>>();
  const classificationSystems = new Set<string>();
  const materials = new Set<string>();

  // Group entity IDs by type (full pass — types are cheap to collect)
  const entitiesByType = new Map<string, number[]>();

  provider.forEachEntity((globalId) => {
    const typeName = provider.getEntityType(globalId);
    if (!typeName) return;
    typeSet.add(typeName);

    let ids = entitiesByType.get(typeName);
    if (!ids) {
      ids = [];
      entitiesByType.set(typeName, ids);
    }
    // Only collect IDs up to sample size for the property/qty pass
    if (ids.length < SAMPLE_SIZE) {
      ids.push(globalId);
    }
  });

  // Sample entities to discover properties, quantities, classifications, materials
  for (const [, sampleIds] of entitiesByType) {
    for (const globalId of sampleIds) {
      // Properties
      const psets = provider.getPropertySets(globalId);
      for (const pset of psets) {
        if (!pset.name) continue;
        let propNames = propertySets.get(pset.name);
        if (!propNames) {
          propNames = new Set();
          propertySets.set(pset.name, propNames);
        }
        for (const prop of pset.properties) {
          if (prop.name) propNames.add(prop.name);
        }
      }

      // Quantities — use dedicated accessor when available
      if (provider.getQuantitySets) {
        const qsets = provider.getQuantitySets(globalId);
        for (const qset of qsets) {
          if (!qset.name) continue;
          let quantNames = quantitySets.get(qset.name);
          if (!quantNames) {
            quantNames = new Set();
            quantitySets.set(qset.name, quantNames);
          }
          for (const q of qset.quantities) {
            if (q.name) quantNames.add(q.name);
          }
        }
      }

      // Classifications
      if (provider.getClassifications) {
        const cls = provider.getClassifications(globalId);
        for (const c of cls) {
          if (c.system) classificationSystems.add(c.system);
        }
      }

      // Materials
      if (provider.getMaterialName) {
        const mat = provider.getMaterialName(globalId);
        if (mat) materials.add(mat);
      }
    }
  }

  // Convert sets to sorted arrays
  const propertySetsResult = new Map<string, string[]>();
  for (const [psetName, propSet] of propertySets) {
    propertySetsResult.set(psetName, Array.from(propSet).sort());
  }

  const quantitySetsResult = new Map<string, string[]>();
  for (const [qsetName, quantSet] of quantitySets) {
    quantitySetsResult.set(qsetName, Array.from(quantSet).sort());
  }

  return {
    types: Array.from(typeSet).sort(),
    propertySets: propertySetsResult,
    quantitySets: quantitySetsResult,
    classificationSystems: Array.from(classificationSystems).sort(),
    materials: Array.from(materials).sort(),
  };
}

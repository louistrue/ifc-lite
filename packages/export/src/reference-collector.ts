/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reference collector for IFC STEP export filtering.
 *
 * Walks #ID references transitively from a set of root entities to build
 * the complete closure of all entities that must be included for a valid
 * STEP file. Used for visible-only export and merged export.
 *
 * KEY DESIGN: In IFC STEP files, the reference graph is:
 *   - Products reference geometry (Product → Placement → CartesianPoint)
 *   - Relationships reference products (Rel → Product, NOT Product → Rel)
 *   - Properties are reached via relationships (Rel → PropertySet → Property)
 *
 * For visible-only export, we need:
 *   1. Infrastructure + spatial structure (always included)
 *   2. Visible product entities (checked against hidden/isolated)
 *   3. Relationship entities (always included as roots — they reference products)
 *   4. Forward closure from the above roots pulls in geometry, properties, etc.
 *   5. Hidden product IDs are BLOCKED during the closure walk so their
 *      exclusively-referenced geometry doesn't get pulled in.
 */

import type { IfcDataStore } from '@ifc-lite/parser';

/** Entity types that form the shared file infrastructure and must always be included. */
const INFRASTRUCTURE_TYPES = new Set([
  'IFCOWNERHISTORY',
  'IFCAPPLICATION',
  'IFCPERSON',
  'IFCORGANIZATION',
  'IFCPERSONANDORGANIZATION',
  'IFCUNITASSIGNMENT',
  'IFCSIUNIT',
  'IFCDERIVEDUNIT',
  'IFCDERIVEDUNITELEMENT',
  'IFCCONVERSIONBASEDUNIT',
  'IFCMEASUREWITHUNIT',
  'IFCDIMENSIONALEXPONENTS',
  'IFCMONETARYUNIT',
  'IFCGEOMETRICREPRESENTATIONCONTEXT',
  'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
]);

/** Entity types that form the spatial structure skeleton. */
const SPATIAL_STRUCTURE_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
]);

/**
 * Product/element entity types that have geometry and can be hidden by the user.
 * These are the ONLY types checked against visibility filters.
 */
const PRODUCT_TYPES = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCDOOR', 'IFCWINDOW', 'IFCSLAB',
  'IFCCOLUMN', 'IFCBEAM', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCPLATE', 'IFCMEMBER',
  'IFCCURTAINWALL', 'IFCFOOTING', 'IFCPILE', 'IFCBUILDINGELEMENTPROXY',
  'IFCFURNISHINGELEMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL',
  'IFCFLOWCONTROLLER', 'IFCFLOWFITTING', 'IFCSPACE', 'IFCOPENINGELEMENT',
  'IFCCOVERING', 'IFCPROXY', 'IFCBUILDINGPROXYTYPE',
  'IFCDISTRIBUTIONELEMENT', 'IFCDISTRIBUTIONCONTROLELEMENT',
  'IFCDISTRIBUTIONFLOWELEMENT', 'IFCENERGYCONVERSIONDEVICE',
  'IFCFLOWSTORAGEDEVICE', 'IFCFLOWMOVINGDEVICE', 'IFCFLOWTERMINALTYPE',
  'IFCTRANSPORTELEMENT', 'IFCVIRTUALELEMENT', 'IFCGEOGRAPHICELEMENT',
  'IFCCIVILELEMENTTYPE', 'IFCCIVILELMENT',
]);

/** Regex to extract all #ID references from STEP entity text. */
const STEP_REF_REGEX = /#(\d+)/g;

/**
 * Collect all entity IDs transitively referenced from a set of root entities.
 *
 * Starting from `rootIds`, reads each entity's STEP text from the source buffer
 * and extracts all `#ID` references. Recursively follows those references to
 * build a complete closure that guarantees referential integrity.
 *
 * @param rootIds - Seed entity IDs to start the walk from
 * @param source - The original STEP file source buffer
 * @param entityIndex - Map of expressId → byte position in source
 * @param excludeIds - Entity IDs to NEVER follow during the walk. These IDs
 *   will not be added to the closure even if referenced by a root entity.
 *   Used to block hidden product entities from being re-included through
 *   relationship references.
 *
 * Performance: O(total bytes of included entities). Each entity visited at most once.
 */
export function collectReferencedEntityIds(
  rootIds: Set<number>,
  source: Uint8Array,
  entityIndex: Map<number, { byteOffset: number; byteLength: number }>,
  excludeIds?: Set<number>,
): Set<number> {
  const visited = new Set<number>();
  const queue: number[] = [];

  // Seed the queue with roots that exist in the entity index
  for (const id of rootIds) {
    if (entityIndex.has(id) && !visited.has(id)) {
      visited.add(id);
      queue.push(id);
    }
  }

  const decoder = new TextDecoder();

  while (queue.length > 0) {
    const entityId = queue.pop()!;
    const ref = entityIndex.get(entityId);
    if (!ref) continue;

    // Decode this entity's STEP text
    const entityText = decoder.decode(
      source.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength),
    );

    // Extract all #ID references
    STEP_REF_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STEP_REF_REGEX.exec(entityText)) !== null) {
      const referencedId = parseInt(match[1], 10);
      if (!visited.has(referencedId) && entityIndex.has(referencedId)) {
        // Block excluded IDs from being added to the closure
        if (excludeIds && excludeIds.has(referencedId)) {
          continue;
        }
        visited.add(referencedId);
        queue.push(referencedId);
      }
    }
  }

  return visited;
}

/**
 * Compute the root entity set and hidden product IDs for a visible-only export.
 *
 * Returns:
 * - `roots`: Entity IDs that form the seed set for the reference closure.
 *   Includes infrastructure, spatial structure, relationship entities, and
 *   visible product entities.
 * - `hiddenProductIds`: Product entity IDs that are hidden/not isolated.
 *   These should be passed as `excludeIds` to `collectReferencedEntityIds`
 *   to prevent the closure from walking into hidden products' geometry.
 *
 * Entities NOT in roots or hiddenProductIds (geometry, properties, materials,
 * type objects) are intentionally left out — they'll only be included if
 * transitively reached from a root during the closure walk.
 */
export function getVisibleEntityIds(
  dataStore: IfcDataStore,
  hiddenIds: Set<number>,
  isolatedIds: Set<number> | null,
): { roots: Set<number>; hiddenProductIds: Set<number> } {
  const roots = new Set<number>();
  const hiddenProductIds = new Set<number>();

  for (const [expressId, entityRef] of dataStore.entityIndex.byId) {
    const typeUpper = entityRef.type.toUpperCase();

    // Always include infrastructure entities (units, contexts, owner history)
    if (INFRASTRUCTURE_TYPES.has(typeUpper)) {
      roots.add(expressId);
      continue;
    }

    // Always include spatial structure (project, site, building, storey)
    if (SPATIAL_STRUCTURE_TYPES.has(typeUpper)) {
      roots.add(expressId);
      continue;
    }

    // Always include relationship entities as roots.
    // Relationships reference products (not vice versa), so they must be roots
    // for properties, materials, and type definitions to be reachable.
    if (typeUpper.startsWith('IFCREL')) {
      roots.add(expressId);
      continue;
    }

    // For product/element entities: check visibility
    if (PRODUCT_TYPES.has(typeUpper)) {
      const isHidden = hiddenIds.has(expressId);
      const isNotIsolated = isolatedIds !== null && !isolatedIds.has(expressId);

      if (isHidden || isNotIsolated) {
        hiddenProductIds.add(expressId);
      } else {
        roots.add(expressId);
      }
      continue;
    }

    // All other entity types (geometry, properties, materials, type objects, etc.)
    // are NOT roots. They will only be included if transitively referenced by
    // a root entity during the closure walk. This ensures hidden products'
    // exclusively-referenced geometry is excluded.
  }

  return { roots, hiddenProductIds };
}

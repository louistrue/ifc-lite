/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reference collector for IFC STEP export filtering.
 *
 * Walks #ID references transitively from a set of root entities to build
 * the complete closure of all entities that must be included for a valid
 * STEP file. Used for visible-only export and merged export.
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

/** Regex to extract all #ID references from STEP entity text. */
const STEP_REF_REGEX = /#(\d+)/g;

/**
 * Collect all entity IDs transitively referenced from a set of root entities.
 *
 * Starting from `rootIds`, reads each entity's STEP text from the source buffer
 * and extracts all `#ID` references. Recursively follows those references to
 * build a complete closure that guarantees referential integrity.
 *
 * Performance: O(total bytes of included entities). Each entity visited at most once.
 */
export function collectReferencedEntityIds(
  rootIds: Set<number>,
  source: Uint8Array,
  entityIndex: Map<number, { byteOffset: number; byteLength: number }>,
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
        visited.add(referencedId);
        queue.push(referencedId);
      }
    }
  }

  return visited;
}

/**
 * Determine which entity IDs should be seed roots for a visible-only export.
 *
 * Returns the set of local expressIds that are:
 * 1. Product entities NOT hidden and (if isolation active) in the isolated set
 * 2. Spatial structure entities (IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey)
 * 3. Infrastructure entities (units, contexts, owner history, etc.)
 *
 * The caller should then pass these to `collectReferencedEntityIds` to get the
 * complete closure including geometry, placements, properties, etc.
 */
export function getVisibleEntityIds(
  dataStore: IfcDataStore,
  hiddenIds: Set<number>,
  isolatedIds: Set<number> | null,
): Set<number> {
  const roots = new Set<number>();

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

    // For product/element entities: check visibility
    // Skip entities that are explicitly hidden
    if (hiddenIds.has(expressId)) {
      continue;
    }

    // If isolation is active, only include entities in the isolated set
    if (isolatedIds !== null && !isolatedIds.has(expressId)) {
      continue;
    }

    // Include this entity as a root
    roots.add(expressId);
  }

  return roots;
}

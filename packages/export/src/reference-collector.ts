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
 * This list covers common IFC4 subtypes of IfcProduct / IfcElement.
 * Entities whose IDs appear in the viewer's hidden set are also treated as
 * hidden products even if their type is not listed here (see fallback below).
 */
const PRODUCT_TYPES = new Set([
  // Building elements
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE',
  'IFCDOOR', 'IFCWINDOW', 'IFCSLAB', 'IFCSLABELEMENTEDCASE',
  'IFCCOLUMN', 'IFCBEAM', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCPLATE', 'IFCMEMBER',
  'IFCCURTAINWALL', 'IFCFOOTING', 'IFCPILE', 'IFCBUILDINGELEMENTPROXY',
  'IFCCOVERING', 'IFCSHADINGDEVICE', 'IFCCHIMNEY',
  'IFCBUILDINGELEMENTPART',
  // Furnishing
  'IFCFURNISHINGELEMENT', 'IFCFURNITURE', 'IFCSYSTEMFURNITUREELEMENT',
  // Distribution / MEP
  'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL', 'IFCFLOWCONTROLLER',
  'IFCFLOWFITTING', 'IFCFLOWSTORAGEDEVICE', 'IFCFLOWMOVINGDEVICE',
  'IFCDISTRIBUTIONELEMENT', 'IFCDISTRIBUTIONCONTROLELEMENT',
  'IFCDISTRIBUTIONFLOWELEMENT', 'IFCENERGYCONVERSIONDEVICE',
  'IFCDUCTSEGMENT', 'IFCDUCTFITTING', 'IFCDUCTSILENCER',
  'IFCPIPESEGMENT', 'IFCPIPEFITTING',
  'IFCCABLESEGMENT', 'IFCCABLECARRIERSEGMENT',
  'IFCCABLEFITTING', 'IFCCABLECARRIERFITTING',
  'IFCSANITARYTERMINAL', 'IFCSTACKTERMINAL', 'IFCWASTETERMINAL',
  'IFCAIRTERMINAL', 'IFCAIRTERMINALBOX', 'IFCAIRTOAIRHEATRECOVERY',
  'IFCFIRESUPPRESSIONTERMINAL', 'IFCELECTRICAPPLIANCE',
  'IFCLAMP', 'IFCLIGHTFIXTURE', 'IFCOUTLET', 'IFCJUNCTIONBOX',
  'IFCSWITCHINGDEVICE', 'IFCPROTECTIVEDEVICE',
  'IFCSENSOR', 'IFCALARM', 'IFCDETECTOR', 'IFCACTUATOR',
  'IFCVALVE', 'IFCPUMP', 'IFCFAN', 'IFCCOMPRESSOR',
  'IFCHEATEXCHANGER', 'IFCCHILLER', 'IFCBOILER', 'IFCCOOLEDBEAM',
  'IFCCOOLINGTOWER', 'IFCUNITARYEQUIPMENT', 'IFCCOIL',
  'IFCDAMPER', 'IFCFILTER', 'IFCHUMIDIFIER', 'IFCMEDICALDEVICE',
  'IFCELECTRICGENERATOR', 'IFCELECTRICMOTOR', 'IFCTRANSFORMER',
  'IFCSOLARDEVICE', 'IFCSPACEHEATER',
  // Fasteners and accessories
  'IFCFASTENER', 'IFCMECHANICALFASTENER', 'IFCDISCRETEACCESSORY',
  // Openings and voids
  'IFCOPENINGELEMENT', 'IFCVOIDINGFEATURE',
  // Other products
  'IFCSPACE', 'IFCPROXY', 'IFCTRANSPORTELEMENT',
  'IFCVIRTUALELEMENT', 'IFCGEOGRAPHICELEMENT', 'IFCCIVILELEMENT',
  'IFCGRID', 'IFCANNOTATION',
  // Distribution ports
  'IFCDISTRIBUTIONPORT',
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

    // Fallback: if the entity ID is explicitly hidden by the viewer, block it
    // even if its type isn't in PRODUCT_TYPES (catches unknown product subtypes)
    if (hiddenIds.has(expressId)) {
      hiddenProductIds.add(expressId);
      continue;
    }

    // Fallback: if isolation is active and this entity IS isolated, it must be
    // a product the user wants to see — make it a root
    if (isolatedIds !== null && isolatedIds.has(expressId)) {
      roots.add(expressId);
      continue;
    }

    // All other entity types (geometry, properties, materials, type objects, etc.)
    // are NOT roots. They will only be included if transitively referenced by
    // a root entity during the closure walk. This ensures hidden products'
    // exclusively-referenced geometry is excluded.
  }

  return { roots, hiddenProductIds };
}

/** Style-related entity types that reference geometry but aren't referenced back. */
const STYLE_ENTITY_TYPES = new Set([
  'IFCSTYLEDITEM',
  'IFCSTYLEDREPRESENTATION',
]);

/**
 * Collect style entities (IFCSTYLEDITEM, etc.) that reference geometry already
 * in the closure, then transitively follow their style references.
 *
 * In IFC STEP, IFCSTYLEDITEM references a geometry RepresentationItem, but
 * nothing references the StyledItem back. So the forward closure walk misses
 * them entirely. This function does a reverse pass: for each styled item, check
 * if its Item reference (first #ID in the entity) is in the closure. If yes,
 * add the styled item and walk its style chain into the closure.
 *
 * Must be called AFTER collectReferencedEntityIds so the closure is complete.
 *
 * @param closure - The existing closure set (mutated in place)
 * @param source - The original STEP file source buffer
 * @param entityIndex - Full entity index with type info
 */
export function collectStyleEntities(
  closure: Set<number>,
  source: Uint8Array,
  entityIndex: {
    byId: Map<number, { type: string; byteOffset: number; byteLength: number }>;
    byType: Map<string, number[]>;
  },
): void {
  const decoder = new TextDecoder();
  const queue: number[] = [];

  // Find styled items whose geometry target is in the closure
  for (const [expressId, entityRef] of entityIndex.byId) {
    if (closure.has(expressId)) continue; // Already included
    const typeUpper = entityRef.type.toUpperCase();
    if (!STYLE_ENTITY_TYPES.has(typeUpper)) continue;

    // Read entity text and check if any referenced ID is in the closure
    const entityText = decoder.decode(
      source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength),
    );

    STEP_REF_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    let referencesClosureEntity = false;
    while ((match = STEP_REF_REGEX.exec(entityText)) !== null) {
      const refId = parseInt(match[1], 10);
      if (closure.has(refId)) {
        referencesClosureEntity = true;
        break;
      }
    }

    if (referencesClosureEntity) {
      closure.add(expressId);
      queue.push(expressId);
    }
  }

  // Walk forward from newly added style entities to pull in their style chain
  // (IfcPresentationStyleAssignment → IfcSurfaceStyle → IfcSurfaceStyleRendering → IfcColourRgb)
  while (queue.length > 0) {
    const entityId = queue.pop()!;
    const ref = entityIndex.byId.get(entityId);
    if (!ref) continue;

    const entityText = decoder.decode(
      source.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength),
    );

    STEP_REF_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STEP_REF_REGEX.exec(entityText)) !== null) {
      const referencedId = parseInt(match[1], 10);
      if (!closure.has(referencedId) && entityIndex.byId.has(referencedId)) {
        closure.add(referencedId);
        queue.push(referencedId);
      }
    }
  }
}

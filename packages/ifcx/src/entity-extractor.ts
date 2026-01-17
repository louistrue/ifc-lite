/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity Extractor for IFCX
 * Extracts entities from composed nodes and builds EntityTable
 */

import type { ComposedNode, IfcClass } from './types.js';
import { ATTR, BUILDING_ELEMENT_TYPES } from './types.js';
import {
  StringTable,
  EntityTableBuilder,
  IfcTypeEnumFromString,
  EntityFlags,
} from '@ifc-lite/data';
import type { EntityTable } from '@ifc-lite/data';

export interface EntityExtractionResult {
  entities: EntityTable;
  pathToId: Map<string, number>;
  idToPath: Map<number, string>;
}

/**
 * Extract entities from composed IFCX nodes.
 *
 * Mapping:
 * - path -> expressId (synthetic, auto-incrementing)
 * - bsi::ifc::class.code -> typeEnum
 * - children hierarchy -> spatial structure
 */
export function extractEntities(
  composed: Map<string, ComposedNode>,
  strings: StringTable
): EntityExtractionResult {
  const pathToId = new Map<string, number>();
  const idToPath = new Map<number, string>();

  // First pass: count entities to allocate builder
  let entityCount = 0;
  for (const node of composed.values()) {
    const ifcClass = node.attributes.get(ATTR.CLASS) as IfcClass | undefined;
    if (ifcClass) {
      entityCount++;
    }
  }

  const builder = new EntityTableBuilder(Math.max(entityCount, 100), strings);
  let nextExpressId = 1;

  // Second pass: extract entities
  for (const node of composed.values()) {
    const ifcClass = node.attributes.get(ATTR.CLASS) as IfcClass | undefined;
    if (!ifcClass) continue; // Skip non-IFC nodes (geometry-only, materials, etc.)

    const expressId = nextExpressId++;
    pathToId.set(node.path, expressId);
    idToPath.set(expressId, node.path);

    // Extract name from attributes
    const name = extractName(node) ?? node.path.slice(0, 8);

    // Check if has geometry
    const hasGeometry = hasGeometryInSubtree(node);

    // Check if this is a type definition
    const isType = ifcClass.code.toUpperCase().endsWith('TYPE');

    // Add entity to builder
    builder.add(
      expressId,
      ifcClass.code,
      node.path, // Use path as GlobalId
      name,
      '', // description
      ifcClass.code, // objectType
      hasGeometry,
      isType
    );
  }

  return {
    entities: builder.build(),
    pathToId,
    idToPath,
  };
}

/**
 * Extract entity name from node attributes.
 */
function extractName(node: ComposedNode): string | null {
  // Try common property patterns
  const name = node.attributes.get('bsi::ifc::prop::Name');
  if (typeof name === 'string') return name;

  const typeName = node.attributes.get('bsi::ifc::prop::TypeName');
  if (typeof typeName === 'string') return typeName;

  const objectName = node.attributes.get('bsi::ifc::prop::ObjectName');
  if (typeof objectName === 'string') return objectName;

  // Try to get name from the node's child key in parent
  // (e.g., if parent has children: { "Wall_001": path }, use "Wall_001")
  const parent = node.parent;
  if (parent) {
    for (const [key, child] of parent.children) {
      if (child.path === node.path) {
        // Use the child key as name if it's not just the path
        if (key !== node.path && !key.match(/^[0-9a-f-]{36}$/i)) {
          return key;
        }
      }
    }
  }

  return null;
}

/**
 * Check if node or any of its children have geometry.
 */
function hasGeometryInSubtree(node: ComposedNode): boolean {
  // Check this node
  if (node.attributes.has(ATTR.MESH)) {
    return true;
  }

  // Check children
  for (const child of node.children.values()) {
    if (hasGeometryInSubtree(child)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a type code represents a building element.
 */
export function isBuildingElement(typeCode: string): boolean {
  return BUILDING_ELEMENT_TYPES.has(typeCode);
}

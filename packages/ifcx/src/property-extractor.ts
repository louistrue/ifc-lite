/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property Extractor for IFCX
 * Extracts properties from node attributes and builds PropertyTable
 */

import type { ComposedNode } from './types.js';
import { ATTR } from './types.js';
import {
  StringTable,
  PropertyTableBuilder,
  PropertyValueType,
} from '@ifc-lite/data';
import type { PropertyTable } from '@ifc-lite/data';

// Attributes to skip (not properties)
const SKIP_ATTRIBUTES: Set<string> = new Set([
  ATTR.CLASS,
  ATTR.MESH,
  ATTR.TRANSFORM,
  ATTR.VISIBILITY,
  ATTR.DIFFUSE_COLOR,
  ATTR.OPACITY,
  ATTR.MATERIAL,
]);

/**
 * Extract properties from composed IFCX nodes.
 *
 * IFCX properties are flat attributes with namespace prefixes:
 * - bsi::ifc::prop::IsExternal -> PropertySingleValue
 * - bsi::ifc::prop::Volume -> QuantitySingleValue
 *
 * We group properties by namespace prefix for PropertySet-like grouping.
 */
export function extractProperties(
  composed: Map<string, ComposedNode>,
  pathToId: Map<string, number>,
  strings: StringTable
): PropertyTable {
  const builder = new PropertyTableBuilder(strings);

  for (const node of composed.values()) {
    const expressId = pathToId.get(node.path);
    if (expressId === undefined) continue;

    // Group attributes by namespace
    const grouped = groupAttributesByNamespace(node.attributes);

    for (const [psetName, props] of grouped) {
      for (const [propName, value] of props) {
        const { propType, propValue } = convertPropertyValue(value);

        builder.add({
          entityId: expressId,
          psetName,
          psetGlobalId: '',
          propName,
          propType,
          value: propValue,
        });
      }
    }
  }

  return builder.build();
}

/**
 * Group attributes by their namespace prefix.
 */
function groupAttributesByNamespace(
  attributes: Map<string, unknown>
): Map<string, Map<string, unknown>> {
  const grouped = new Map<string, Map<string, unknown>>();

  for (const [key, value] of attributes) {
    // Skip non-property attributes
    if (SKIP_ATTRIBUTES.has(key)) {
      continue;
    }

    // Parse namespace::name pattern
    const lastColon = key.lastIndexOf('::');
    if (lastColon === -1) continue;

    const namespace = key.slice(0, lastColon);
    const propName = key.slice(lastColon + 2);

    // Use namespace as pset name, format for display
    const psetName = formatNamespace(namespace);

    if (!grouped.has(psetName)) {
      grouped.set(psetName, new Map());
    }
    grouped.get(psetName)!.set(propName, value);
  }

  return grouped;
}

/**
 * Format namespace for display as PropertySet name.
 */
function formatNamespace(namespace: string): string {
  // Replace :: with / for readability
  // e.g., "bsi::ifc::prop" -> "bsi / ifc / prop"
  return namespace.replace(/::/g, ' / ');
}

/**
 * Convert IFCX attribute value to PropertyTable format.
 */
function convertPropertyValue(value: unknown): {
  propType: PropertyValueType;
  propValue: string | number | boolean;
} {
  if (typeof value === 'string') {
    return {
      propType: PropertyValueType.String,
      propValue: value,
    };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {
        propType: PropertyValueType.Integer,
        propValue: value,
      };
    }
    return {
      propType: PropertyValueType.Real,
      propValue: value,
    };
  }

  if (typeof value === 'boolean') {
    return {
      propType: PropertyValueType.Boolean,
      propValue: value,
    };
  }

  // Arrays and objects - serialize to JSON string
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return {
      propType: PropertyValueType.String,
      propValue: JSON.stringify(value),
    };
  }

  // Null or undefined
  return {
    propType: PropertyValueType.String,
    propValue: '',
  };
}

/**
 * Extract quantity-like properties (Volume, Area, Length, etc.)
 * These are identified by their names matching quantity patterns.
 */
export function isQuantityProperty(propName: string): boolean {
  const quantityPatterns = [
    'Volume',
    'Area',
    'Length',
    'Width',
    'Height',
    'Depth',
    'Thickness',
    'Weight',
    'Mass',
    'Count',
    'GrossArea',
    'NetArea',
    'GrossVolume',
    'NetVolume',
    'GrossWeight',
    'NetWeight',
  ];

  return quantityPatterns.some(
    pattern => propName === pattern || propName.endsWith(pattern)
  );
}

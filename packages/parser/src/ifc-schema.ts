/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC Schema accessors — thin wrappers over the generated schema registry.
 *
 * The registry is code-generated from the IFC EXPRESS schema via `@ifc-lite/codegen`.
 * Do NOT hardcode entity types or attributes here; regenerate instead.
 */

import { getAllAttributesForEntity, isKnownEntity, getInheritanceChainForEntity } from './generated/schema-registry.js';

/**
 * Get all attribute names for an IFC entity type in STEP positional order.
 * Walks the inheritance chain (root → leaf) via the generated schema registry.
 */
export function getAttributeNames(type: string): string[] {
    const allAttrs = getAllAttributesForEntity(type);
    return allAttrs.map(a => a.name);
}

/**
 * Check if a type is known in the IFC schema.
 */
export function isKnownType(type: string): boolean {
    return isKnownEntity(type);
}

/**
 * Get the full inheritance chain for an IFC entity type (root → leaf).
 * Returns PascalCase names, e.g. ['IfcRoot', ..., 'IfcFlowTerminal', 'IfcAirTerminal'].
 */
export function getInheritanceChain(type: string): string[] {
    return getInheritanceChainForEntity(type);
}

/**
 * Get attribute name at a specific index for a type.
 */
export function getAttributeNameAt(type: string, index: number): string | null {
    const names = getAttributeNames(type);
    return names[index] || null;
}

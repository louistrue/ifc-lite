/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/data - Columnar data structures
 */

export { StringTable } from './string-table.js';
export { EntityTableBuilder } from './entity-table.js';
export type { EntityTable } from './entity-table.js';
export { PropertyTableBuilder } from './property-table.js';
export type { PropertyTable, PropertySet, Property, PropertyValue } from './property-table.js';
export { QuantityTableBuilder } from './quantity-table.js';
export type { QuantityTable, QuantitySet, Quantity } from './quantity-table.js';
export { RelationshipGraphBuilder } from './relationship-graph.js';
export type { RelationshipGraph, Edge, RelationshipInfo } from './relationship-graph.js';
export * from './types.js';
// Explicitly export const enums for runtime use
export { IfcTypeEnum, PropertyValueType, QuantityType, RelationshipType, EntityFlags } from './types.js';
export type { SpatialNode, SpatialHierarchy } from './types.js';

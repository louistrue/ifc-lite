/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Types for the Lists feature - configurable property tables from IFC data
 */

import type { IfcTypeEnum } from '@ifc-lite/data';

// ============================================================================
// List Definition (persisted config)
// ============================================================================

export interface ListDefinition {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;

  /** Which entity types to include */
  entityTypes: IfcTypeEnum[];

  /** Optional property-based filter conditions */
  conditions: PropertyCondition[];

  /** Columns to display */
  columns: ColumnDefinition[];

  /** Current sort state */
  sortBy?: { columnId: string; direction: 'asc' | 'desc' };
}

// ============================================================================
// Source Set Filtering
// ============================================================================

export interface PropertyCondition {
  source: 'attribute' | 'property' | 'quantity';
  /** Property set name (for property/quantity sources) */
  psetName?: string;
  /** Property name within the set */
  propertyName: string;
  operator: ConditionOperator;
  value: string | number | boolean;
}

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'exists';

// ============================================================================
// Column Definitions
// ============================================================================

export interface ColumnDefinition {
  id: string;
  source: 'attribute' | 'property' | 'quantity';
  /** For property: pset name. For quantity: qset name. */
  psetName?: string;
  /** Attribute name or property/quantity name */
  propertyName: string;
  /** Display label override */
  label?: string;
}

// ============================================================================
// List Execution Results
// ============================================================================

export interface ListResult {
  columns: ColumnDefinition[];
  rows: ListRow[];
  /** Total matched entities before pagination */
  totalCount: number;
  /** Execution time in ms */
  executionTime: number;
}

export interface ListRow {
  /** Entity reference for 3D selection */
  entityId: number;
  modelId: string;
  /** Column values in same order as ListResult.columns */
  values: CellValue[];
}

export type CellValue = string | number | boolean | null;

// ============================================================================
// Column Discovery
// ============================================================================

/** Available columns discovered from the model */
export interface DiscoveredColumns {
  attributes: string[];
  properties: Map<string, string[]>; // psetName -> propNames[]
  quantities: Map<string, string[]>; // qsetName -> quantNames[]
}

// ============================================================================
// Built-in Attributes
// ============================================================================

export const ENTITY_ATTRIBUTES = [
  'Name',
  'GlobalId',
  'Type',
  'Description',
  'ObjectType',
] as const;

export type EntityAttribute = typeof ENTITY_ATTRIBUTES[number];

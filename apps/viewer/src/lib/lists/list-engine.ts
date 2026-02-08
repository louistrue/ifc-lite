/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * List execution engine - resolves source sets and extracts column values
 *
 * PERF: Uses EntityTable.getByType() for O(typeRange) entity lookups,
 * and PropertyTable indices for O(1) property lookups per entity.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import type { PropertySet, QuantitySet } from '@ifc-lite/data';
import { parsePropertyValue } from '@/components/viewer/properties/encodingUtils';
import type {
  ListDefinition,
  ListResult,
  ListRow,
  CellValue,
  PropertyCondition,
  ColumnDefinition,
} from './types.js';

/**
 * Execute a list definition against a data store.
 * Returns a flat table result with matched entities and column values.
 */
export function executeList(
  definition: ListDefinition,
  store: IfcDataStore,
  modelId: string,
): ListResult {
  const startTime = performance.now();

  // Step 1: Resolve source set (which entities match)
  const matchedIds = resolveSourceSet(definition, store);

  // Step 2: Extract column values for matched entities
  const rows: ListRow[] = new Array(matchedIds.length);

  for (let i = 0; i < matchedIds.length; i++) {
    const entityId = matchedIds[i];
    const values = extractColumnValues(definition.columns, entityId, store);
    rows[i] = { entityId, modelId, values };
  }

  // Step 3: Sort if configured
  if (definition.sortBy) {
    const colIndex = definition.columns.findIndex(c => c.id === definition.sortBy!.columnId);
    if (colIndex >= 0) {
      const dir = definition.sortBy.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => compareCellValues(a.values[colIndex], b.values[colIndex]) * dir);
    }
  }

  return {
    columns: definition.columns,
    rows,
    totalCount: rows.length,
    executionTime: performance.now() - startTime,
  };
}

// ============================================================================
// Source Set Resolution
// ============================================================================

function resolveSourceSet(definition: ListDefinition, store: IfcDataStore): number[] {
  const { entityTypes, conditions } = definition;

  // Collect entity IDs by type
  let entityIds: number[] = [];
  for (const type of entityTypes) {
    const ids = store.entities.getByType(type);
    entityIds = entityIds.concat(ids);
  }

  // Apply conditions as filters
  if (conditions.length === 0) {
    return entityIds;
  }

  return entityIds.filter(id => matchesAllConditions(id, conditions, store));
}

function matchesAllConditions(
  entityId: number,
  conditions: PropertyCondition[],
  store: IfcDataStore,
): boolean {
  for (const condition of conditions) {
    if (!matchesCondition(entityId, condition, store)) {
      return false;
    }
  }
  return true;
}

function matchesCondition(
  entityId: number,
  condition: PropertyCondition,
  store: IfcDataStore,
): boolean {
  const actualValue = getConditionValue(entityId, condition, store);

  if (condition.operator === 'exists') {
    return actualValue !== null && actualValue !== undefined && actualValue !== '';
  }

  if (actualValue === null || actualValue === undefined) {
    return false;
  }

  switch (condition.operator) {
    case 'equals':
      return String(actualValue) === String(condition.value);
    case 'notEquals':
      return String(actualValue) !== String(condition.value);
    case 'contains':
      return String(actualValue).toLowerCase().includes(String(condition.value).toLowerCase());
    case 'gt':
      return Number(actualValue) > Number(condition.value);
    case 'lt':
      return Number(actualValue) < Number(condition.value);
    case 'gte':
      return Number(actualValue) >= Number(condition.value);
    case 'lte':
      return Number(actualValue) <= Number(condition.value);
    default:
      return false;
  }
}

function getConditionValue(
  entityId: number,
  condition: PropertyCondition,
  store: IfcDataStore,
): CellValue {
  switch (condition.source) {
    case 'attribute':
      return getAttributeValue(entityId, condition.propertyName, store);
    case 'property':
      return getPropertyValue(entityId, condition.psetName ?? '', condition.propertyName, store);
    case 'quantity':
      return getQuantityValue(entityId, condition.psetName ?? '', condition.propertyName, store);
    default:
      return null;
  }
}

// ============================================================================
// Column Value Extraction
// ============================================================================

function extractColumnValues(
  columns: ColumnDefinition[],
  entityId: number,
  store: IfcDataStore,
): CellValue[] {
  // For efficiency, batch extract properties and quantities once per entity
  // if any columns need them
  const needsProperties = columns.some(c => c.source === 'property');
  const needsQuantities = columns.some(c => c.source === 'quantity');

  let psets: PropertySet[] | undefined;
  let qsets: QuantitySet[] | undefined;

  if (needsProperties) {
    psets = getPropertySets(entityId, store);
  }
  if (needsQuantities) {
    qsets = getQuantitySets(entityId, store);
  }

  const values: CellValue[] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    switch (col.source) {
      case 'attribute':
        values[i] = getAttributeValue(entityId, col.propertyName, store);
        break;
      case 'property':
        values[i] = findPropertyInSets(psets ?? [], col.psetName ?? '', col.propertyName);
        break;
      case 'quantity':
        values[i] = findQuantityInSets(qsets ?? [], col.psetName ?? '', col.propertyName);
        break;
      default:
        values[i] = null;
    }
  }
  return values;
}

// ============================================================================
// Value Accessors
// ============================================================================

function getAttributeValue(entityId: number, attrName: string, store: IfcDataStore): CellValue {
  switch (attrName) {
    case 'Name':
      return store.entities.getName(entityId) || null;
    case 'GlobalId':
      return store.entities.getGlobalId(entityId) || null;
    case 'Type':
      return store.entities.getTypeName(entityId) || null;
    case 'Description':
      return store.entities.getDescription(entityId) || null;
    case 'ObjectType':
      return store.entities.getObjectType(entityId) || null;
    default:
      return null;
  }
}

function getPropertySets(entityId: number, store: IfcDataStore): PropertySet[] {
  if (store.onDemandPropertyMap && store.source?.length > 0) {
    return extractPropertiesOnDemand(store, entityId) as PropertySet[];
  }
  return store.properties?.getForEntity(entityId) ?? [];
}

function getQuantitySets(entityId: number, store: IfcDataStore): QuantitySet[] {
  if (store.onDemandQuantityMap && store.source?.length > 0) {
    return extractQuantitiesOnDemand(store, entityId) as QuantitySet[];
  }
  return store.quantities?.getForEntity(entityId) ?? [];
}

function getPropertyValue(
  entityId: number,
  psetName: string,
  propName: string,
  store: IfcDataStore,
): CellValue {
  const psets = getPropertySets(entityId, store);
  return findPropertyInSets(psets, psetName, propName);
}

function getQuantityValue(
  entityId: number,
  qsetName: string,
  quantName: string,
  store: IfcDataStore,
): CellValue {
  const qsets = getQuantitySets(entityId, store);
  return findQuantityInSets(qsets, qsetName, quantName);
}

function findPropertyInSets(psets: PropertySet[], psetName: string, propName: string): CellValue {
  for (const pset of psets) {
    if (pset.name === psetName) {
      for (const prop of pset.properties) {
        if (prop.name === propName) {
          return resolvePropertyValue(prop.value);
        }
      }
    }
  }
  return null;
}

/**
 * Resolve a raw IFC property value to a clean display value.
 * Handles typed arrays [IFCTYPE, value], boolean enums (.T./.F./.U.),
 * IFC string encodings, etc. — same logic as PropertiesPanel.
 */
function resolvePropertyValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;

  // Use the same parsing as PropertiesPanel
  const parsed = parsePropertyValue(value);
  const display = parsed.displayValue;

  // Return null for em-dash (null indicator)
  if (display === '\u2014') return null;

  // Try to preserve numeric values for sorting
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return display; // "True"/"False"

  // For typed values like [IFCREAL, 5.3], check if the resolved value is numeric
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'number') {
    return value[1];
  }

  return display;
}

/** Unit suffixes indexed by QuantityType enum */
const QUANTITY_UNITS = ['m', 'm²', 'm³', '', 'kg', 's'];

function findQuantityInSets(qsets: QuantitySet[], qsetName: string, quantName: string): CellValue {
  for (const qset of qsets) {
    if (qset.name === qsetName) {
      for (const quant of qset.quantities) {
        if (quant.name === quantName) {
          return formatQuantityValue(quant.value, quant.type);
        }
      }
    }
  }
  return null;
}

function formatQuantityValue(value: number, type: number): CellValue {
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const unit = QUANTITY_UNITS[type];
  return unit ? `${formatted} ${unit}` : formatted;
}

// ============================================================================
// Sorting
// ============================================================================

function compareCellValues(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}

// ============================================================================
// CSV Export from List Result
// ============================================================================

export function listResultToCSV(result: ListResult, delimiter = ','): string {
  const escape = (val: CellValue): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = result.columns.map(c => escape(c.label ?? `${c.psetName ? c.psetName + '.' : ''}${c.propertyName}`));
  const lines = [headers.join(delimiter)];

  for (const row of result.rows) {
    lines.push(row.values.map(escape).join(delimiter));
  }

  return lines.join('\n');
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Thin wrapper around @ifc-lite/parser for entity data and spatial tree access.
 *
 * buildDataStore         — scans the raw IFC buffer and builds a columnar index.
 *                          Run once after file load; ~50–300 ms for typical models.
 * getEntityData          — queries attributes + property sets for a given expressId.
 *                          O(1) table lookups after the store is built.
 * buildSpatialTreeFromStore — converts the parsed SpatialHierarchy into a simple
 *                          recursive tree suited for rendering in the side panel.
 */

import {
  StepTokenizer,
  ColumnarParser,
  type IfcDataStore,
  extractEntityAttributesOnDemand,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
} from '@ifc-lite/parser';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';

export type { IfcDataStore };
export { IfcTypeEnum };

// ── Entity data ───────────────────────────────────────────────────────

export interface PropertyValue {
  name: string;
  value: string;
}

export interface PropertySet {
  name: string;
  properties: PropertyValue[];
}

export interface QuantitySet {
  name: string;
  quantities: Array<{ name: string; value: string }>;
}

export interface EntityData {
  expressId: number;
  ifcType: string;
  globalId: string;
  name: string;
  description: string;
  objectType: string;
  tag: string;
  propertySets: PropertySet[];
  quantitySets: QuantitySet[];
}

// ── Spatial tree ─────────────────────────────────────────────────────

export interface SpatialTreeNode {
  expressId: number;
  name: string;
  type: IfcTypeEnum;
  /** m above project base, only set for IfcBuildingStorey */
  elevation?: number;
  /** Child spatial containers (Site, Building, Storey, Space) */
  children: SpatialTreeNode[];
  /** Direct elements, grouped by IFC type name → sorted by count desc */
  elementGroups: Array<{ typeName: string; ids: number[] }>;
  /** Recursive total element count for display badge */
  totalElements: number;
}

// ── buildDataStore ────────────────────────────────────────────────────

/**
 * Scan the IFC STEP buffer and build the columnar data store.
 *
 * Pure-JS tokeniser — does NOT require WASM to run.
 */
export async function buildDataStore(buffer: ArrayBuffer): Promise<IfcDataStore> {
  const uint8Buffer = new Uint8Array(buffer);
  const tokenizer = new StepTokenizer(uint8Buffer);

  const entityRefs: Array<{
    expressId: number;
    type: string;
    byteOffset: number;
    byteLength: number;
    lineNumber: number;
  }> = [];

  for (const ref of tokenizer.scanEntities()) {
    entityRefs.push({
      expressId: ref.expressId,
      type: ref.type,
      byteOffset: ref.offset,
      byteLength: ref.length,
      lineNumber: ref.line,
    });
  }

  const parser = new ColumnarParser();
  return parser.parseLite(buffer, entityRefs);
}

// ── getEntityData ─────────────────────────────────────────────────────

/**
 * Extract all available data for a single entity.
 */
export function getEntityData(
  store: IfcDataStore,
  expressId: number,
  ifcType: string,
): EntityData {
  const attrs = extractEntityAttributesOnDemand(store, expressId);

  const rawPsets = extractPropertiesOnDemand(store, expressId);
  const propertySets: PropertySet[] = rawPsets.map((pset) => ({
    name: pset.name,
    properties: pset.properties.map((p) => ({
      name: p.name,
      value: formatValue(p.value),
    })),
  }));

  const rawQsets = extractQuantitiesOnDemand(store, expressId);
  const quantitySets: QuantitySet[] = rawQsets.map((qset) => ({
    name: qset.name,
    quantities: qset.quantities.map((q) => ({
      name: q.name,
      value: typeof q.value === 'number' ? q.value.toFixed(3) : String(q.value),
    })),
  }));

  return {
    expressId,
    ifcType,
    globalId: attrs.globalId,
    name: attrs.name,
    description: attrs.description,
    objectType: attrs.objectType,
    tag: attrs.tag,
    propertySets,
    quantitySets,
  };
}

// ── buildSpatialTreeFromStore ─────────────────────────────────────────

/**
 * Convert the store's parsed spatial hierarchy into a flat tree of
 * SpatialTreeNode objects. Returns null if no spatial hierarchy was found.
 */
export function buildSpatialTreeFromStore(store: IfcDataStore): SpatialTreeNode | null {
  const { spatialHierarchy } = store;
  if (!spatialHierarchy) return null;
  return convertNode(spatialHierarchy.project, store);
}

/**
 * Total number of entities with geometry in the spatial hierarchy.
 */
export function countSpatialElements(root: SpatialTreeNode): number {
  return root.totalElements;
}

// ── Internal helpers ──────────────────────────────────────────────────

function convertNode(node: SpatialNode, store: IfcDataStore): SpatialTreeNode {
  const children = node.children.map((c) => convertNode(c, store));

  // Group direct elements by IFC type name, sorted by count desc
  const typeMap = new Map<string, number[]>();
  for (const id of node.elements) {
    const typeName = store.entities.getTypeName(id) || 'IfcBuildingElement';
    let arr = typeMap.get(typeName);
    if (!arr) {
      arr = [];
      typeMap.set(typeName, arr);
    }
    arr.push(id);
  }
  const elementGroups = [...typeMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([typeName, ids]) => ({ typeName, ids }));

  const ownCount = node.elements.length;
  const childCount = children.reduce((s, c) => s + c.totalElements, 0);

  return {
    expressId: node.expressId,
    name: node.name,
    type: node.type as IfcTypeEnum,
    elevation: node.elevation,
    children,
    elementGroups,
    totalElements: ownCount + childCount,
  };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('value' in v) return formatValue(v.value);
    if ('wrappedValue' in v) return formatValue(v.wrappedValue);
    return JSON.stringify(value);
  }
  return String(value);
}

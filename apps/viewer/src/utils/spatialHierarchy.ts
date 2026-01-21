/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Spatial hierarchy utilities for IFC models
 * Pure functions for building spatial structure from entities and relationships
 * Extracted from useIfc.ts for reusability and testability
 */

import {
  IfcTypeEnum,
  RelationshipType,
  type SpatialHierarchy,
  type SpatialNode,
  type EntityTable,
  type RelationshipGraph,
} from '@ifc-lite/data';

// Spatial structure types that form the IFC containment hierarchy
const SPATIAL_TYPES = new Set([
  IfcTypeEnum.IfcProject,
  IfcTypeEnum.IfcSite,
  IfcTypeEnum.IfcBuilding,
  IfcTypeEnum.IfcBuildingStorey,
  IfcTypeEnum.IfcSpace,
]);

/**
 * Rebuild spatial hierarchy from cache data (entities + relationships)
 * OPTIMIZED: Uses index maps for O(1) lookups instead of O(n) linear searches
 *
 * @param entities - Entity table from parsed IFC
 * @param relationships - Relationship graph from parsed IFC
 * @returns Spatial hierarchy or undefined if no project found
 */
export function rebuildSpatialHierarchy(
  entities: EntityTable,
  relationships: RelationshipGraph
): SpatialHierarchy | undefined {
  // PRE-BUILD INDEX MAP: O(n) once, then O(1) lookups
  // This eliminates the O(n²) nested loops from before
  const entityTypeMap = new Map<number, IfcTypeEnum>();
  for (let i = 0; i < entities.count; i++) {
    entityTypeMap.set(entities.expressId[i], entities.typeEnum[i]);
  }

  const byStorey = new Map<number, number[]>();
  const byBuilding = new Map<number, number[]>();
  const bySite = new Map<number, number[]>();
  const bySpace = new Map<number, number[]>();
  const storeyElevations = new Map<number, number>();
  const storeyHeights = new Map<number, number>();
  const elementToStorey = new Map<number, number>();

  // Find IfcProject
  const projectIds = entities.getByType(IfcTypeEnum.IfcProject);
  if (projectIds.length === 0) {
    console.warn('[rebuildSpatialHierarchy] No IfcProject found');
    return undefined;
  }
  const projectId = projectIds[0];

  // Build node tree recursively - NOW O(1) lookups!
  function buildNode(expressId: number): SpatialNode {
    // O(1) lookup instead of O(n) linear search
    const typeEnum = entityTypeMap.get(expressId) ?? IfcTypeEnum.Unknown;
    const name = entities.getName(expressId) || `Entity #${expressId}`;

    // Get contained elements via IfcRelContainedInSpatialStructure
    const rawContainedElements = relationships.getRelated(
      expressId,
      RelationshipType.ContainsElements,
      'forward'
    );

    // Filter out spatial structure elements - O(1) per element now!
    const containedElements = rawContainedElements.filter((id) => {
      const elemType = entityTypeMap.get(id);
      return elemType !== undefined && !SPATIAL_TYPES.has(elemType);
    });

    // Get aggregated children via IfcRelAggregates
    const aggregatedChildren = relationships.getRelated(
      expressId,
      RelationshipType.Aggregates,
      'forward'
    );

    // Filter to spatial structure types and recurse - O(1) per child now!
    const childNodes: SpatialNode[] = [];
    for (const childId of aggregatedChildren) {
      const childType = entityTypeMap.get(childId);
      if (childType && SPATIAL_TYPES.has(childType) && childType !== IfcTypeEnum.IfcProject) {
        childNodes.push(buildNode(childId));
      }
    }

    // Add elements to appropriate maps
    if (typeEnum === IfcTypeEnum.IfcBuildingStorey) {
      byStorey.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcBuilding) {
      byBuilding.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcSite) {
      bySite.set(expressId, containedElements);
    } else if (typeEnum === IfcTypeEnum.IfcSpace) {
      bySpace.set(expressId, containedElements);
    }

    return {
      expressId,
      type: typeEnum,
      name,
      children: childNodes,
      elements: containedElements,
    };
  }

  const projectNode = buildNode(projectId);

  // Build reverse lookup map: elementId -> storeyId
  for (const [storeyId, elementIds] of byStorey) {
    for (const elementId of elementIds) {
      elementToStorey.set(elementId, storeyId);
    }
  }

  // Pre-build space lookup for O(1) getContainingSpace
  const elementToSpace = new Map<number, number>();
  for (const [spaceId, elementIds] of bySpace) {
    for (const elementId of elementIds) {
      elementToSpace.set(elementId, spaceId);
    }
  }

  // Note: storeyHeights remains empty for cache path - client uses on-demand property extraction

  return {
    project: projectNode,
    byStorey,
    byBuilding,
    bySite,
    bySpace,
    storeyElevations,
    storeyHeights,
    elementToStorey,

    getStoreyElements(storeyId: number): number[] {
      return byStorey.get(storeyId) ?? [];
    },

    getStoreyByElevation(): number | null {
      return null;
    },

    getContainingSpace(elementId: number): number | null {
      return elementToSpace.get(elementId) ?? null;
    },

    getPath(elementId: number): SpatialNode[] {
      const path: SpatialNode[] = [];

      // DFS to find element in spatial tree
      // Elements can be in SpatialNode.elements (e.g., IfcSpace) even if not in elementToStorey
      const findPath = (node: SpatialNode, targetId: number): boolean => {
        path.push(node);
        if (node.elements.includes(targetId)) {
          return true;
        }
        for (const child of node.children) {
          if (findPath(child, targetId)) {
            return true;
          }
        }
        path.pop();
        return false;
      };

      findPath(projectNode, elementId);
      return path;
    },
  };
}

/**
 * Entity index type for property/quantity set lookup
 */
export interface EntityIndex {
  byId: Map<number, unknown>;
  byType: Map<string, number[]>;
}

/**
 * Result of rebuilding on-demand maps
 */
export interface OnDemandMaps {
  onDemandPropertyMap: Map<number, number[]>;
  onDemandQuantityMap: Map<number, number[]>;
}

/**
 * Rebuild on-demand property/quantity maps from relationships and entity types
 * Uses FORWARD direction: pset -> elements (more efficient than inverse lookup)
 * OPTIMIZED: Uses entityIndex.byType for property/quantity set lookup since
 * the entity table may not include these types (filtered during fresh parse)
 *
 * @param entities - Entity table from parsed IFC
 * @param relationships - Relationship graph from parsed IFC
 * @param entityIndex - Optional entity index with byType map for cache loads
 * @returns Maps from entity ID to property/quantity set IDs
 */
export function rebuildOnDemandMaps(
  entities: EntityTable,
  relationships: RelationshipGraph,
  entityIndex?: EntityIndex
): OnDemandMaps {
  const onDemandPropertyMap = new Map<number, number[]>();
  const onDemandQuantityMap = new Map<number, number[]>();

  // Use entityIndex.byType if available (needed for cache loads where entity table
  // doesn't include IfcPropertySet/IfcElementQuantity entities)
  // Fall back to entities.getByType() for fresh parses where entity table has these types
  let propertySets: number[];
  let quantitySets: number[];

  if (entityIndex?.byType) {
    // entityIndex.byType keys are the original type strings from the IFC file
    // Check both common casings (STEP files may use either)
    propertySets =
      entityIndex.byType.get('IFCPROPERTYSET') || entityIndex.byType.get('IfcPropertySet') || [];
    quantitySets =
      entityIndex.byType.get('IFCELEMENTQUANTITY') ||
      entityIndex.byType.get('IfcElementQuantity') ||
      [];
  } else {
    // Fallback for when entityIndex is not provided
    propertySets = entities.getByType(IfcTypeEnum.IfcPropertySet);
    quantitySets = entities.getByType(IfcTypeEnum.IfcElementQuantity);
  }

  // Process property sets
  for (const psetId of propertySets) {
    // Get elements defined by this pset (FORWARD: pset -> elements)
    const definedElements = relationships.getRelated(
      psetId,
      RelationshipType.DefinesByProperties,
      'forward'
    );

    for (const entityId of definedElements) {
      let list = onDemandPropertyMap.get(entityId);
      if (!list) {
        list = [];
        onDemandPropertyMap.set(entityId, list);
      }
      list.push(psetId);
    }
  }

  // Process quantity sets
  for (const qsetId of quantitySets) {
    // Get elements defined by this qset (FORWARD: qset -> elements)
    const definedElements = relationships.getRelated(
      qsetId,
      RelationshipType.DefinesByProperties,
      'forward'
    );

    for (const entityId of definedElements) {
      let list = onDemandQuantityMap.get(entityId);
      if (!list) {
        list = [];
        onDemandQuantityMap.set(entityId, list);
      }
      list.push(qsetId);
    }
  }

  console.log(
    `[spatialHierarchy] Rebuilt on-demand maps: ${propertySets.length} psets, ${quantitySets.length} qsets -> ${onDemandPropertyMap.size} entities with properties, ${onDemandQuantityMap.size} with quantities`
  );
  return { onDemandPropertyMap, onDemandQuantityMap };
}

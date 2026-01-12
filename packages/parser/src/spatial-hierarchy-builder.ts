/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Spatial hierarchy builder - builds project/building/storey tree
 */

import type { EntityTable, StringTable, RelationshipGraph, SpatialHierarchy, SpatialNode } from '@ifc-lite/data';
import { IfcTypeEnum, RelationshipType } from '@ifc-lite/data';
import type { EntityRef } from './types.js';
import { EntityExtractor } from './entity-extractor.js';

export class SpatialHierarchyBuilder {
  /**
   * Build spatial hierarchy from entities and relationships
   */
  build(
    entities: EntityTable,
    relationships: RelationshipGraph,
    strings: StringTable,
    source: Uint8Array,
    entityIndex: { byId: Map<number, EntityRef> }
  ): SpatialHierarchy {
    const byStorey = new Map<number, number[]>();
    const byBuilding = new Map<number, number[]>();
    const bySite = new Map<number, number[]>();
    const bySpace = new Map<number, number[]>();
    const storeyElevations = new Map<number, number>();
    const elementToStorey = new Map<number, number>();

    // Find IfcProject (should be only one)
    const projectIds = entities.getByType(IfcTypeEnum.IfcProject);
    if (projectIds.length === 0) {
      console.warn('[SpatialHierarchyBuilder] No IfcProject found in IFC file');
      throw new Error('No IfcProject found in IFC file');
    }
    const projectId = projectIds[0];

    // Build project node
    const projectNode = this.buildNode(
      projectId,
      entities,
      relationships,
      strings,
      source,
      entityIndex,
      byStorey,
      byBuilding,
      bySite,
      bySpace,
      storeyElevations,
      elementToStorey
    );

    // Build reverse lookup map: elementId -> storeyId
    for (const [storeyId, elementIds] of byStorey) {
      for (const elementId of elementIds) {
        elementToStorey.set(elementId, storeyId);
      }
    }

    // Validation: log warnings if maps are empty
    if (byStorey.size === 0) {
      console.warn('[SpatialHierarchyBuilder] No storeys found in spatial hierarchy');
    }
    if (byBuilding.size === 0) {
      console.warn('[SpatialHierarchyBuilder] No buildings found in spatial hierarchy');
    }

    const hierarchy: SpatialHierarchy = {
      project: projectNode,
      byStorey,
      byBuilding,
      bySite,
      bySpace,
      storeyElevations,
      elementToStorey,
      
      getStoreyElements(storeyId: number): number[] {
        return byStorey.get(storeyId) ?? [];
      },
      
      getStoreyByElevation(z: number): number | null {
        let closestStorey: number | null = null;
        let closestDistance = Infinity;
        
        for (const [storeyId, elevation] of storeyElevations) {
          const distance = Math.abs(elevation - z);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestStorey = storeyId;
          }
        }
        
        // Only return if within reasonable distance (1 meter)
        return closestDistance < 1.0 ? closestStorey : null;
      },
      
      getContainingSpace(elementId: number): number | null {
        // Check if element is directly contained in a space
        for (const [spaceId, elementIds] of bySpace) {
          if (elementIds.includes(elementId)) {
            return spaceId;
          }
        }
        return null;
      },
      
      getPath(elementId: number): SpatialNode[] {
        const path: SpatialNode[] = [];
        
        // Find which storey contains this element
        const storeyId = elementToStorey.get(elementId);
        if (!storeyId) return path;
        
        // Build path from project to element
        const findPath = (node: SpatialNode, targetId: number): boolean => {
          path.push(node);
          
          // Check if this node contains the target
          if (node.elements.includes(targetId)) {
            return true;
          }
          
          // Recursively search children
          for (const child of node.children) {
            if (findPath(child, targetId)) {
              return true;
            }
          }
          
          // Backtrack
          path.pop();
          return false;
        };
        
        findPath(projectNode, elementId);
        return path;
      },
    };

    return hierarchy;
  }

  private buildNode(
    expressId: number,
    entities: EntityTable,
    relationships: RelationshipGraph,
    strings: StringTable,
    source: Uint8Array,
    entityIndex: { byId: Map<number, EntityRef> },
    byStorey: Map<number, number[]>,
    byBuilding: Map<number, number[]>,
    bySite: Map<number, number[]>,
    bySpace: Map<number, number[]>,
    storeyElevations: Map<number, number>,
    elementToStorey: Map<number, number>
  ): SpatialNode {
    const typeEnum = this.getTypeEnum(expressId, entities);
    const name = entities.getName(expressId);

    // Extract elevation for storeys
    let elevation: number | undefined;
    if (typeEnum === IfcTypeEnum.IfcBuildingStorey) {
      elevation = this.extractElevation(expressId, source, entityIndex);
      if (elevation !== undefined) {
        storeyElevations.set(expressId, elevation);
      }
    }

    // Get direct contained elements via IfcRelContainedInSpatialStructure
    const containedElements = relationships.getRelated(
      expressId,
      RelationshipType.ContainsElements,
      'forward'
    );

    // Get child spatial elements via IfcRelAggregates (inverse - who aggregates this?)
    // Actually, we want forward - what does this element aggregate?
    const aggregatedChildren = relationships.getRelated(
      expressId,
      RelationshipType.Aggregates,
      'forward'
    );

    // Filter to only spatial structure types
    const childNodes: SpatialNode[] = [];
    for (const childId of aggregatedChildren) {
      const childType = this.getTypeEnum(childId, entities);
      if (
        childType === IfcTypeEnum.IfcSite ||
        childType === IfcTypeEnum.IfcBuilding ||
        childType === IfcTypeEnum.IfcBuildingStorey ||
        childType === IfcTypeEnum.IfcSpace
      ) {
        const childNode = this.buildNode(
          childId,
          entities,
          relationships,
          strings,
          source,
          entityIndex,
          byStorey,
          byBuilding,
          bySite,
          bySpace,
          storeyElevations,
          elementToStorey
        );
        childNodes.push(childNode);
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
      elevation,
      children: childNodes,
      elements: containedElements,
    };
  }

  private getTypeEnum(expressId: number, entities: EntityTable): IfcTypeEnum {
    // Linear search through expressId array
    for (let i = 0; i < entities.count; i++) {
      if (entities.expressId[i] === expressId) {
        return entities.typeEnum[i];
      }
    }
    return IfcTypeEnum.Unknown;
  }

  /**
   * Extract elevation from IfcBuildingStorey entity
   * Elevation is typically in attribute index 8 (after GlobalId, OwnerHistory, Name, Description, ObjectType, etc.)
   */
  private extractElevation(
    expressId: number,
    source: Uint8Array,
    entityIndex: { byId: Map<number, EntityRef> }
  ): number | undefined {
    const ref = entityIndex.byId.get(expressId);
    if (!ref) return undefined;

    try {
      const extractor = new EntityExtractor(source);
      const entity = extractor.extractEntity(ref);
      if (!entity) return undefined;

      // IfcBuildingStorey elevation is typically at index 8
      // But it might vary, so try common indices
      const attrs = entity.attributes || [];
      
      // Try index 8 first (most common)
      if (attrs.length > 8 && typeof attrs[8] === 'number') {
        return attrs[8];
      }
      
      // Try index 7
      if (attrs.length > 7 && typeof attrs[7] === 'number') {
        return attrs[7];
      }
      
      // Try index 6
      if (attrs.length > 6 && typeof attrs[6] === 'number') {
        return attrs[6];
      }

      // Search for first numeric value that looks like an elevation
      for (let i = 0; i < attrs.length; i++) {
        if (typeof attrs[i] === 'number' && Math.abs(attrs[i]) < 10000) {
          return attrs[i];
        }
      }
    } catch (error) {
      // Silently fail - elevation is optional
    }

    return undefined;
  }
}

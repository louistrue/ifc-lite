/**
 * Relationship extractor - extracts spatial structure and other relationships
 */

import type { IfcEntity, Relationship } from './types.js';

export class RelationshipExtractor {
  private entities: Map<number, IfcEntity>;

  constructor(entities: Map<number, IfcEntity>) {
    this.entities = entities;
  }

  /**
   * Extract all relationships
   */
  extractRelationships(): Relationship[] {
    const relationships: Relationship[] = [];

    for (const [id, entity] of this.entities) {
      const rel = this.extractRelationship(entity);
      if (rel) {
        relationships.push(rel);
      }
    }

    return relationships;
  }

  /**
   * Extract relationship from entity
   */
  private extractRelationship(entity: IfcEntity): Relationship | null {
    const relTypes = [
      'IfcRelContainedInSpatialStructure',
      'IfcRelAggregates',
      'IfcRelDefinesByProperties',
      'IfcRelDefinesByType',
      'IfcRelAssociatesMaterial',
      'IfcRelVoidsElement',
      'IfcRelFillsElement',
    ];

    if (!relTypes.includes(entity.type)) {
      return null;
    }

    try {
      // Common structure: (GlobalId, OwnerHistory, Name, Description, RelatingObject, RelatedObjects)
      const relatingObject = this.getAttributeValue(entity, 4);
      const relatedObjects = this.getAttributeValue(entity, 5);

      if (relatingObject === null || !Array.isArray(relatedObjects)) {
        return null;
      }

      return {
        type: entity.type,
        relatingObject: typeof relatingObject === 'number' ? relatingObject : null,
        relatedObjects: relatedObjects.filter((id): id is number => typeof id === 'number'),
      };
    } catch (error) {
      console.warn(`Failed to extract relationship #${entity.expressId}:`, error);
      return null;
    }
  }

  private getAttributeValue(entity: IfcEntity, index: number): any {
    if (index < 0 || index >= entity.attributes.length) {
      return null;
    }
    return entity.attributes[index];
  }
}

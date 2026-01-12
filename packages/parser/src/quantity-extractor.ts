/**
 * Quantity extractor - extracts IfcElementQuantity sets and their values
 */

import type { IfcEntity } from './types.js';

export interface QuantitySet {
  expressId: number;
  name: string;
  methodOfMeasurement?: string;
  quantities: QuantityValue[];
}

export interface QuantityValue {
  name: string;
  type: QuantityValueType;
  value: number;
  unit?: string;
  formula?: string;
}

export type QuantityValueType = 'length' | 'area' | 'volume' | 'count' | 'weight' | 'time';

export class QuantityExtractor {
  private entities: Map<number, IfcEntity>;

  constructor(entities: Map<number, IfcEntity>) {
    this.entities = entities;
  }

  /**
   * Extract all IfcElementQuantity sets from entities
   */
  extractQuantitySets(): Map<number, QuantitySet> {
    const quantitySets = new Map<number, QuantitySet>();

    for (const [id, entity] of this.entities) {
      if (entity.type.toUpperCase() === 'IFCELEMENTQUANTITY') {
        const qset = this.extractQuantitySet(entity);
        if (qset) {
          quantitySets.set(id, qset);
        }
      }
    }

    return quantitySets;
  }

  /**
   * Extract QuantitySet from IfcElementQuantity entity
   */
  private extractQuantitySet(entity: IfcEntity): QuantitySet | null {
    try {
      // IfcElementQuantity structure:
      // (GlobalId, OwnerHistory, Name, Description, MethodOfMeasurement, Quantities)
      // Attributes: [0]=GlobalId, [1]=OwnerHistory, [2]=Name, [3]=Description, [4]=MethodOfMeasurement, [5]=Quantities
      const name = this.getAttributeValue(entity, 2) as string;
      if (!name) return null;

      const methodOfMeasurement = this.getAttributeValue(entity, 4) as string | undefined;
      const quantitiesRefs = this.getAttributeValue(entity, 5);
      const quantities: QuantityValue[] = [];

      // Quantities is a list of references to IfcPhysicalQuantity subtypes
      if (Array.isArray(quantitiesRefs)) {
        for (const quantRef of quantitiesRefs) {
          if (typeof quantRef === 'number') {
            const quantEntity = this.entities.get(quantRef);
            if (quantEntity) {
              const quantity = this.extractQuantity(quantEntity);
              if (quantity) {
                quantities.push(quantity);
              }
            }
          }
        }
      }

      return {
        expressId: entity.expressId,
        name,
        methodOfMeasurement,
        quantities,
      };
    } catch (error) {
      console.warn(`Failed to extract QuantitySet #${entity.expressId}:`, error);
      return null;
    }
  }

  /**
   * Extract quantity from IfcPhysicalQuantity entity
   */
  private extractQuantity(entity: IfcEntity): QuantityValue | null {
    try {
      const typeUpper = entity.type.toUpperCase();

      // All quantity types have: Name, Description, Unit (optional), then value
      // IfcQuantityLength: (Name, Description, Unit, LengthValue, Formula)
      // IfcQuantityArea: (Name, Description, Unit, AreaValue, Formula)
      // IfcQuantityVolume: (Name, Description, Unit, VolumeValue, Formula)
      // IfcQuantityCount: (Name, Description, Unit, CountValue, Formula)
      // IfcQuantityWeight: (Name, Description, Unit, WeightValue, Formula)
      // IfcQuantityTime: (Name, Description, Unit, TimeValue, Formula)

      const name = this.getAttributeValue(entity, 0) as string;
      if (!name) return null;

      let type: QuantityValueType;
      let valueIndex = 3; // Value is at index 3 for all quantity types
      let formulaIndex = 4;

      switch (typeUpper) {
        case 'IFCQUANTITYLENGTH':
          type = 'length';
          break;
        case 'IFCQUANTITYAREA':
          type = 'area';
          break;
        case 'IFCQUANTITYVOLUME':
          type = 'volume';
          break;
        case 'IFCQUANTITYCOUNT':
          type = 'count';
          break;
        case 'IFCQUANTITYWEIGHT':
          type = 'weight';
          break;
        case 'IFCQUANTITYTIME':
          type = 'time';
          break;
        default:
          // Unknown quantity type
          return null;
      }

      const value = this.getAttributeValue(entity, valueIndex);
      if (typeof value !== 'number') return null;

      const formula = this.getAttributeValue(entity, formulaIndex) as string | undefined;

      return {
        name,
        type,
        value,
        formula: formula || undefined,
      };
    } catch (error) {
      console.warn(`Failed to extract quantity #${entity.expressId}:`, error);
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

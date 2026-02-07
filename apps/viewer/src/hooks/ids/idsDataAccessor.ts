/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IDS Data Accessor Factory
 *
 * Creates an IFCDataAccessor bridge from an IfcDataStore to the IDS
 * validator's expected interface. This is a pure function with no
 * React dependencies.
 */

import type {
  IFCDataAccessor,
  PropertyValueResult,
  PropertySetInfo,
  ClassificationInfo,
  MaterialInfo,
  ParentInfo,
  PartOfRelation,
} from '@ifc-lite/ids';
import type { IfcDataStore } from '@ifc-lite/parser';

/**
 * Create an IFCDataAccessor from an IfcDataStore
 * This bridges the viewer's data store to the IDS validator's interface
 */
export function createDataAccessor(
  dataStore: IfcDataStore,
  _modelId: string
): IFCDataAccessor {
  return {
    getEntityType(expressId: number): string | undefined {
      // Try entities table first
      const entityType = dataStore.entities?.getTypeName?.(expressId);
      if (entityType) return entityType;

      // Fallback to entityIndex
      const byId = dataStore.entityIndex?.byId;
      if (byId) {
        const entry = byId.get(expressId);
        if (entry) {
          return typeof entry === 'object' && 'type' in entry ? String(entry.type) : undefined;
        }
      }
      return undefined;
    },

    getEntityName(expressId: number): string | undefined {
      return dataStore.entities?.getName?.(expressId);
    },

    getGlobalId(expressId: number): string | undefined {
      return dataStore.entities?.getGlobalId?.(expressId);
    },

    getDescription(expressId: number): string | undefined {
      return dataStore.entities?.getDescription?.(expressId);
    },

    getObjectType(expressId: number): string | undefined {
      return dataStore.entities?.getObjectType?.(expressId);
    },

    getEntitiesByType(typeName: string): number[] {
      const byType = dataStore.entityIndex?.byType;
      if (byType) {
        const ids = byType.get(typeName.toUpperCase());
        if (ids) return Array.from(ids);
      }
      return [];
    },

    getAllEntityIds(): number[] {
      const byId = dataStore.entityIndex?.byId;
      if (byId) {
        return Array.from(byId.keys());
      }
      return [];
    },

    getPropertyValue(
      expressId: number,
      propertySetName: string,
      propertyName: string
    ): PropertyValueResult | undefined {
      const propertiesStore = dataStore.properties;
      if (!propertiesStore) return undefined;

      // Get property sets for this entity using getForEntity (returns PropertySet[])
      const psets = propertiesStore.getForEntity?.(expressId);
      if (!psets) return undefined;

      for (const pset of psets) {
        if (pset.name.toLowerCase() === propertySetName.toLowerCase()) {
          const props = pset.properties || [];
          for (const prop of props) {
            if (prop.name.toLowerCase() === propertyName.toLowerCase()) {
              // Convert value: ensure it's a primitive type (not array)
              let value: string | number | boolean | null = null;
              if (Array.isArray(prop.value)) {
                // For arrays, convert to string representation
                value = JSON.stringify(prop.value);
              } else {
                value = prop.value as string | number | boolean | null;
              }
              return {
                value,
                dataType: String(prop.type || 'IFCLABEL'),
                propertySetName: pset.name,
                propertyName: prop.name,
              };
            }
          }
        }
      }
      return undefined;
    },

    getPropertySets(expressId: number): PropertySetInfo[] {
      const propertiesStore = dataStore.properties;
      if (!propertiesStore) return [];

      // Use getForEntity (returns PropertySet[])
      const psets = propertiesStore.getForEntity?.(expressId);
      if (!psets) return [];

      return psets.map((pset) => ({
        name: pset.name,
        properties: (pset.properties || []).map((prop) => {
          // Convert value: ensure it's a primitive type (not array)
          let value: string | number | boolean | null = null;
          if (Array.isArray(prop.value)) {
            value = JSON.stringify(prop.value);
          } else {
            value = prop.value as string | number | boolean | null;
          }
          return {
            name: prop.name,
            value,
            dataType: String(prop.type || 'IFCLABEL'),
          };
        }),
      }));
    },

    getClassifications(expressId: number): ClassificationInfo[] {
      // Classifications might be stored separately or in properties
      // This is a placeholder - implement based on actual data structure
      const classifications: ClassificationInfo[] = [];

      // Check if there's a classifications accessor
      const classStore = (dataStore as { classifications?: { getForEntity?: (id: number) => ClassificationInfo[] } }).classifications;
      if (classStore?.getForEntity) {
        return classStore.getForEntity(expressId);
      }

      return classifications;
    },

    getMaterials(expressId: number): MaterialInfo[] {
      // Materials might be stored separately or in relationships
      const materials: MaterialInfo[] = [];

      // Check if there's a materials accessor
      const matStore = (dataStore as { materials?: { getForEntity?: (id: number) => MaterialInfo[] } }).materials;
      if (matStore?.getForEntity) {
        return matStore.getForEntity(expressId);
      }

      return materials;
    },

    getParent(
      expressId: number,
      relationType: PartOfRelation
    ): ParentInfo | undefined {
      const relationships = dataStore.relationships;
      if (!relationships) return undefined;

      // Map IDS relation type to internal relation type
      const relationMap: Record<PartOfRelation, string> = {
        'IfcRelAggregates': 'Aggregates',
        'IfcRelContainedInSpatialStructure': 'ContainedInSpatialStructure',
        'IfcRelNests': 'Nests',
        'IfcRelVoidsElement': 'VoidsElement',
        'IfcRelFillsElement': 'FillsElement',
      };

      const relType = relationMap[relationType];
      if (!relType) return undefined;

      // Get related entities (parent direction)
      const getRelated = relationships.getRelated;
      if (getRelated) {
        const parents = getRelated(expressId, relType as never, 'inverse');
        if (parents && parents.length > 0) {
          const parentId = parents[0];
          return {
            expressId: parentId,
            entityType: this.getEntityType(parentId) || 'Unknown',
            predefinedType: this.getObjectType(parentId),
          };
        }
      }

      return undefined;
    },

    getAttribute(expressId: number, attributeName: string): string | undefined {
      const lowerName = attributeName.toLowerCase();

      // Map common attribute names to accessor methods
      switch (lowerName) {
        case 'name':
          return this.getEntityName(expressId);
        case 'description':
          return this.getDescription(expressId);
        case 'globalid':
          return this.getGlobalId(expressId);
        case 'objecttype':
        case 'predefinedtype':
          return this.getObjectType(expressId);
        default: {
          // Try to get from entities table if available
          const entities = dataStore.entities as {
            getAttribute?: (id: number, attr: string) => string | undefined;
          };
          if (entities?.getAttribute) {
            return entities.getAttribute(expressId, attributeName);
          }
          return undefined;
        }
      }
    },
  };
}

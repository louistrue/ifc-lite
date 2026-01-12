/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Columnar parser - builds columnar data structures
 */

import type { EntityRef, IfcEntity } from './types.js';
import { PropertyExtractor } from './property-extractor.js';
import { QuantityExtractor } from './quantity-extractor.js';
import { RelationshipExtractor } from './relationship-extractor.js';
import { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';
import {
    StringTable,
    EntityTableBuilder,
    PropertyTableBuilder,
    QuantityTableBuilder,
    RelationshipGraphBuilder,
    RelationshipType,
    PropertyValueType,
    QuantityType,
} from '@ifc-lite/data';
import type { SpatialHierarchy, QuantityTable } from '@ifc-lite/data';

// SpatialIndex interface - matches BVH from @ifc-lite/spatial
// Defined here to avoid circular dependency
export interface SpatialIndex {
    queryAABB(bounds: { min: [number, number, number]; max: [number, number, number] }): number[];
    raycast(origin: [number, number, number], direction: [number, number, number]): number[];
}

export interface IfcDataStore {
    fileSize: number;
    schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3';
    entityCount: number;
    parseTime: number;

    source: Uint8Array;
    entityIndex: { byId: Map<number, EntityRef>; byType: Map<string, number[]> };

    strings: StringTable;
    entities: ReturnType<EntityTableBuilder['build']>;
    properties: ReturnType<PropertyTableBuilder['build']>;
    quantities: QuantityTable;
    relationships: ReturnType<RelationshipGraphBuilder['build']>;

    // Spatial structures (optional, built after parsing)
    spatialHierarchy?: SpatialHierarchy;
    spatialIndex?: SpatialIndex; // BVH from @ifc-lite/spatial
}

export class ColumnarParser {
    /**
     * Parse IFC file into columnar data store
     */
    async parse(
        buffer: ArrayBuffer,
        entityRefs: EntityRef[],
        entities: Map<number, IfcEntity>,
        options: { onProgress?: (progress: { phase: string; percent: number }) => void } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const uint8Buffer = new Uint8Array(buffer);

        // Initialize builders
        const strings = new StringTable();
        const entityTableBuilder = new EntityTableBuilder(entities.size, strings);
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        // === Build Entity Table ===
        options.onProgress?.({ phase: 'entities', percent: 0 });
        let processed = 0;

        for (const [id, entity] of entities) {
            const attrs = entity.attributes || [];
            const globalId = String(attrs[0] || '');
            const name = String(attrs[2] || '');
            const description = String(attrs[3] || '');
            const objectType = String(attrs[7] || '');

            // Check if entity has geometry (simplified check)
            const hasGeometry = entity.type.toUpperCase().includes('WALL') ||
                entity.type.toUpperCase().includes('DOOR') ||
                entity.type.toUpperCase().includes('WINDOW') ||
                entity.type.toUpperCase().includes('SLAB') ||
                entity.type.toUpperCase().includes('COLUMN') ||
                entity.type.toUpperCase().includes('BEAM');

            const isType = entity.type.toUpperCase().endsWith('TYPE');

            entityTableBuilder.add(id, entity.type, globalId, name, description, objectType, hasGeometry, isType);

            processed++;
            if (processed % 1000 === 0) {
                options.onProgress?.({ phase: 'entities', percent: (processed / entities.size) * 100 });
            }
        }

        const entityTable = entityTableBuilder.build();
        options.onProgress?.({ phase: 'entities', percent: 100 });

        // === Build Property Table ===
        options.onProgress?.({ phase: 'properties', percent: 0 });
        const propertyExtractor = new PropertyExtractor(entities);
        const propertySets = propertyExtractor.extractPropertySets();

        // Build mapping: psetId -> entityIds
        const psetToEntities = new Map<number, number[]>();
        const relationshipExtractor = new RelationshipExtractor(entities);
        const relationships = relationshipExtractor.extractRelationships();

        for (const rel of relationships) {
            if (rel.type.toUpperCase() === 'IFCRELDEFINESBYPROPERTIES') {
                const psetId = rel.relatingObject;
                for (const entityId of rel.relatedObjects) {
                    let list = psetToEntities.get(psetId);
                    if (!list) {
                        list = [];
                        psetToEntities.set(psetId, list);
                    }
                    list.push(entityId);
                }
            }
        }

        // Extract properties into columnar format
        for (const [psetId, pset] of propertySets) {
            const entityIds = psetToEntities.get(psetId) || [];
            const globalId = String(entities.get(psetId)?.attributes?.[0] || '');

            for (const [propName, propValue] of pset.properties) {
                for (const entityId of entityIds) {
                    let propType = PropertyValueType.String;
                    let value: any = propValue.value;

                    if (propValue.type === 'number') {
                        propType = PropertyValueType.Real;
                        value = propValue.value;
                    } else if (propValue.type === 'boolean') {
                        propType = PropertyValueType.Boolean;
                        value = propValue.value;
                    } else if (propValue.type === 'string') {
                        propType = PropertyValueType.String;
                        value = String(propValue.value);
                    }

                    propertyTableBuilder.add({
                        entityId,
                        psetName: pset.name,
                        psetGlobalId: globalId,
                        propName,
                        propType,
                        value,
                    });
                }
            }
        }

        const propertyTable = propertyTableBuilder.build();
        options.onProgress?.({ phase: 'properties', percent: 100 });

        // === Build Quantity Table ===
        options.onProgress?.({ phase: 'quantities', percent: 0 });
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const quantityExtractor = new QuantityExtractor(entities);
        const quantitySets = quantityExtractor.extractQuantitySets();

        // Build mapping: qsetId -> entityIds (similar to properties)
        const qsetToEntities = new Map<number, number[]>();
        for (const rel of relationships) {
            if (rel.type.toUpperCase() === 'IFCRELDEFINESBYPROPERTIES') {
                const qsetId = rel.relatingObject;
                // Check if this is actually a quantity set (not a property set)
                if (quantitySets.has(qsetId)) {
                    for (const entityId of rel.relatedObjects) {
                        let list = qsetToEntities.get(qsetId);
                        if (!list) {
                            list = [];
                            qsetToEntities.set(qsetId, list);
                        }
                        list.push(entityId);
                    }
                }
            }
        }

        // Map quantity type names to QuantityType enum
        const quantityTypeMap: Record<string, QuantityType> = {
            'length': QuantityType.Length,
            'area': QuantityType.Area,
            'volume': QuantityType.Volume,
            'count': QuantityType.Count,
            'weight': QuantityType.Weight,
            'time': QuantityType.Time,
        };

        // Extract quantities into columnar format
        for (const [qsetId, qset] of quantitySets) {
            const entityIds = qsetToEntities.get(qsetId) || [];

            for (const quantity of qset.quantities) {
                for (const entityId of entityIds) {
                    quantityTableBuilder.add({
                        entityId,
                        qsetName: qset.name,
                        quantityName: quantity.name,
                        quantityType: quantityTypeMap[quantity.type] ?? QuantityType.Length,
                        value: quantity.value,
                        formula: quantity.formula,
                    });
                }
            }
        }

        const quantityTable = quantityTableBuilder.build();
        options.onProgress?.({ phase: 'quantities', percent: 100 });

        // === Build Relationship Graph ===
        options.onProgress?.({ phase: 'relationships', percent: 0 });

        const relTypeMap: Record<string, RelationshipType> = {
            'IFCRELCONTAINEDINSPATIALSTRUCTURE': RelationshipType.ContainsElements,
            'IFCRELAGGREGATES': RelationshipType.Aggregates,
            'IFCRELDEFINESBYPROPERTIES': RelationshipType.DefinesByProperties,
            'IFCRELDEFINESBYTYPE': RelationshipType.DefinesByType,
            'IFCRELASSOCIATESMATERIAL': RelationshipType.AssociatesMaterial,
            'IFCRELASSOCIATESCLASSIFICATION': RelationshipType.AssociatesClassification,
            'IFCRELVOIDSELEMENT': RelationshipType.VoidsElement,
            'IFCRELFILLSELEMENT': RelationshipType.FillsElement,
            'IFCRELCONNECTSPATHELEMENTS': RelationshipType.ConnectsPathElements,
            'IFCRELSPACEBOUNDARY': RelationshipType.SpaceBoundary,
        };

        for (const rel of relationships) {
            const relType = relTypeMap[rel.type.toUpperCase()];
            if (relType) {
                for (const targetId of rel.relatedObjects) {
                    relationshipGraphBuilder.addEdge(rel.relatingObject, targetId, relType, rel.relatingObject);
                }
            }
        }

        const relationshipGraph = relationshipGraphBuilder.build();
        options.onProgress?.({ phase: 'relationships', percent: 100 });

        // Detect schema version (simplified)
        let schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3' = 'IFC4';
        for (const [, entity] of entities) {
            if (entity.type.toUpperCase() === 'IFCPROJECT') {
                // Check schema version from header or entity
                schemaVersion = 'IFC4';
                break;
            }
        }

        const parseTime = performance.now() - startTime;

        // Build entity index
        const entityIndex = {
            byId: new Map<number, EntityRef>(),
            byType: new Map<string, number[]>(),
        };

        for (const ref of entityRefs) {
            entityIndex.byId.set(ref.expressId, ref);
            let typeList = entityIndex.byType.get(ref.type);
            if (!typeList) {
                typeList = [];
                entityIndex.byType.set(ref.type, typeList);
            }
            typeList.push(ref.expressId);
        }

        // === Build Spatial Hierarchy ===
        options.onProgress?.({ phase: 'spatial-hierarchy', percent: 0 });
        let spatialHierarchy: SpatialHierarchy | undefined;
        try {
            const hierarchyBuilder = new SpatialHierarchyBuilder();
            spatialHierarchy = hierarchyBuilder.build(
                entityTable,
                relationshipGraph,
                strings,
                uint8Buffer,
                entityIndex
            );
        } catch (error) {
            console.warn('[ColumnarParser] Failed to build spatial hierarchy:', error);
            // Continue without hierarchy - it's optional
        }
        options.onProgress?.({ phase: 'spatial-hierarchy', percent: 100 });

        return {
            fileSize: buffer.byteLength,
            schemaVersion,
            entityCount: entities.size,
            parseTime,
            source: uint8Buffer,
            entityIndex,
            strings,
            entities: entityTable,
            properties: propertyTable,
            quantities: quantityTable,
            relationships: relationshipGraph,
            spatialHierarchy,
        };
    }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Columnar parser - builds columnar data structures
 *
 * OPTIMIZED: Single-pass extraction for maximum performance
 * Instead of multiple passes through entities, we extract everything in ONE loop.
 */

import type { EntityRef, IfcEntity, PropertySet, PropertyValue, Relationship } from './types.js';
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

    spatialHierarchy?: SpatialHierarchy;
    spatialIndex?: SpatialIndex;
}

// Pre-computed type sets for O(1) lookups
const GEOMETRY_TYPES = new Set([
    'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCDOOR', 'IFCWINDOW', 'IFCSLAB',
    'IFCCOLUMN', 'IFCBEAM', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
    'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCPLATE', 'IFCMEMBER',
    'IFCCURTAINWALL', 'IFCFOOTING', 'IFCPILE', 'IFCBUILDINGELEMENTPROXY',
    'IFCFURNISHINGELEMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL',
    'IFCFLOWCONTROLLER', 'IFCFLOWFITTING', 'IFCSPACE', 'IFCOPENINGELEMENT',
    'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
]);

const RELATIONSHIP_TYPES = new Set([
    'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELAGGREGATES',
    'IFCRELDEFINESBYPROPERTIES', 'IFCRELDEFINESBYTYPE',
    'IFCRELASSOCIATESMATERIAL', 'IFCRELASSOCIATESCLASSIFICATION',
    'IFCRELVOIDSELEMENT', 'IFCRELFILLSELEMENT',
    'IFCRELCONNECTSPATHELEMENTS', 'IFCRELSPACEBOUNDARY',
]);

const REL_TYPE_MAP: Record<string, RelationshipType> = {
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

const QUANTITY_TYPE_MAP: Record<string, QuantityType> = {
    'IFCQUANTITYLENGTH': QuantityType.Length,
    'IFCQUANTITYAREA': QuantityType.Area,
    'IFCQUANTITYVOLUME': QuantityType.Volume,
    'IFCQUANTITYCOUNT': QuantityType.Count,
    'IFCQUANTITYWEIGHT': QuantityType.Weight,
    'IFCQUANTITYTIME': QuantityType.Time,
};

// Yield helper - batched to reduce overhead
const YIELD_INTERVAL = 5000;
let yieldCounter = 0;
async function maybeYield(): Promise<void> {
    yieldCounter++;
    if (yieldCounter >= YIELD_INTERVAL) {
        yieldCounter = 0;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

export class ColumnarParser {
    /**
     * Parse IFC file into columnar data store - SINGLE PASS OPTIMIZED
     */
    async parse(
        buffer: ArrayBuffer,
        entityRefs: EntityRef[],
        entities: Map<number, IfcEntity>,
        options: { onProgress?: (progress: { phase: string; percent: number }) => void } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const uint8Buffer = new Uint8Array(buffer);
        const totalEntities = entities.size;

        // Initialize all builders upfront
        const strings = new StringTable();
        const entityTableBuilder = new EntityTableBuilder(totalEntities, strings);
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        // Temporary storage for second-pass resolution
        const propertySets = new Map<number, PropertySet>();
        const quantitySets = new Map<number, { name: string; quantities: Array<{ name: string; type: QuantityType; value: number; formula?: string }> }>();
        const relationships: Relationship[] = [];
        const propertyRefs = new Map<number, IfcEntity>(); // IfcPropertySingleValue etc.
        const quantityRefs = new Map<number, IfcEntity>(); // IfcQuantityLength etc.

        // === SINGLE PASS: Extract everything at once ===
        options.onProgress?.({ phase: 'parsing', percent: 0 });
        let processed = 0;
        let schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3' = 'IFC4';

        for (const [id, entity] of entities) {
            const typeUpper = entity.type.toUpperCase();
            const attrs = entity.attributes || [];

            // 1. Build entity table entry
            const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
            const name = typeof attrs[2] === 'string' ? attrs[2] : '';
            const description = typeof attrs[3] === 'string' ? attrs[3] : '';
            const objectType = typeof attrs[7] === 'string' ? attrs[7] : '';
            const hasGeometry = GEOMETRY_TYPES.has(typeUpper);
            const isType = typeUpper.endsWith('TYPE');

            entityTableBuilder.add(id, entity.type, globalId, name, description, objectType, hasGeometry, isType);

            // 2. Extract relationships in same pass
            if (RELATIONSHIP_TYPES.has(typeUpper)) {
                const rel = this.extractRelationshipFast(entity, typeUpper);
                if (rel) {
                    relationships.push(rel);
                }
            }

            // 3. Extract property sets in same pass
            if (typeUpper === 'IFCPROPERTYSET') {
                const psetName = typeof attrs[2] === 'string' ? attrs[2] : '';
                if (psetName) {
                    const hasProperties = attrs[4];
                    const properties = new Map<string, PropertyValue>();

                    if (Array.isArray(hasProperties)) {
                        for (const propRef of hasProperties) {
                            if (typeof propRef === 'number') {
                                // Store ref for second pass
                                const propEntity = entities.get(propRef);
                                if (propEntity) {
                                    propertyRefs.set(propRef, propEntity);
                                }
                            }
                        }
                    }
                    propertySets.set(id, { name: psetName, properties });
                }
            }

            // 4. Extract quantity sets in same pass
            if (typeUpper === 'IFCELEMENTQUANTITY') {
                const qsetName = typeof attrs[2] === 'string' ? attrs[2] : '';
                if (qsetName && attrs.length >= 6) {
                    const hasQuantities = attrs[5];
                    const quantities: Array<{ name: string; type: QuantityType; value: number; formula?: string }> = [];

                    if (Array.isArray(hasQuantities)) {
                        for (const qtyRef of hasQuantities) {
                            if (typeof qtyRef === 'number') {
                                const qtyEntity = entities.get(qtyRef);
                                if (qtyEntity) {
                                    quantityRefs.set(qtyRef, qtyEntity);
                                }
                            }
                        }
                    }
                    quantitySets.set(id, { name: qsetName, quantities });
                }
            }

            // 5. Store property/quantity value entities for resolution
            if (typeUpper.startsWith('IFCPROPERTY') || typeUpper.startsWith('IFCQUANTITY')) {
                if (typeUpper.startsWith('IFCPROPERTY')) {
                    propertyRefs.set(id, entity);
                } else {
                    quantityRefs.set(id, entity);
                }
            }

            processed++;
            if (processed % 10000 === 0) {
                options.onProgress?.({ phase: 'parsing', percent: (processed / totalEntities) * 50 });
                await maybeYield();
            }
        }

        const entityTable = entityTableBuilder.build();
        console.log(`[ColumnarParser] Single-pass extraction: ${processed} entities, ${relationships.length} relationships`);

        // === SECOND PASS: Resolve property and quantity values (much smaller datasets) ===
        options.onProgress?.({ phase: 'resolving', percent: 50 });

        // Resolve property values
        for (const [psetId, pset] of propertySets) {
            const psetEntity = entities.get(psetId);
            if (!psetEntity) continue;

            const hasProperties = psetEntity.attributes[4];
            if (Array.isArray(hasProperties)) {
                for (const propRef of hasProperties) {
                    if (typeof propRef === 'number') {
                        const propEntity = propertyRefs.get(propRef);
                        if (propEntity) {
                            const prop = this.extractPropertyFast(propEntity);
                            if (prop) {
                                pset.properties.set(prop.name, prop.value);
                            }
                        }
                    }
                }
            }
        }

        // Resolve quantity values
        for (const [qsetId, qset] of quantitySets) {
            const qsetEntity = entities.get(qsetId);
            if (!qsetEntity) continue;

            const hasQuantities = qsetEntity.attributes[5];
            if (Array.isArray(hasQuantities)) {
                for (const qtyRef of hasQuantities) {
                    if (typeof qtyRef === 'number') {
                        const qtyEntity = quantityRefs.get(qtyRef);
                        if (qtyEntity) {
                            const qty = this.extractQuantityFast(qtyEntity);
                            if (qty) {
                                qset.quantities.push(qty);
                            }
                        }
                    }
                }
            }
        }

        // === BUILD RELATIONSHIP MAPPINGS ===
        options.onProgress?.({ phase: 'building', percent: 60 });

        const psetToEntities = new Map<number, number[]>();
        const qsetToEntities = new Map<number, number[]>();

        for (const rel of relationships) {
            const typeUpper = rel.type.toUpperCase();

            if (typeUpper === 'IFCRELDEFINESBYPROPERTIES') {
                const defId = rel.relatingObject;
                for (const entityId of rel.relatedObjects) {
                    // Could be property set or quantity set
                    if (propertySets.has(defId)) {
                        let list = psetToEntities.get(defId);
                        if (!list) { list = []; psetToEntities.set(defId, list); }
                        list.push(entityId);
                    }
                    if (quantitySets.has(defId)) {
                        let list = qsetToEntities.get(defId);
                        if (!list) { list = []; qsetToEntities.set(defId, list); }
                        list.push(entityId);
                    }
                }
            }

            // Add to relationship graph
            const relType = REL_TYPE_MAP[typeUpper];
            if (relType) {
                for (const targetId of rel.relatedObjects) {
                    relationshipGraphBuilder.addEdge(rel.relatingObject, targetId, relType, rel.relatingObject);
                }
            }

            await maybeYield();
        }

        // === BUILD PROPERTY TABLE ===
        options.onProgress?.({ phase: 'properties', percent: 70 });

        for (const [psetId, pset] of propertySets) {
            const entityIds = psetToEntities.get(psetId) || [];
            const globalId = entities.get(psetId)?.attributes?.[0] || '';

            for (const [propName, propValue] of pset.properties) {
                for (const entityId of entityIds) {
                    let propType = PropertyValueType.String;
                    let value: any = propValue.value;

                    if (propValue.type === 'number') {
                        propType = PropertyValueType.Real;
                    } else if (propValue.type === 'boolean') {
                        propType = PropertyValueType.Boolean;
                    }

                    propertyTableBuilder.add({
                        entityId,
                        psetName: pset.name,
                        psetGlobalId: String(globalId),
                        propName,
                        propType,
                        value,
                    });
                }
            }
            await maybeYield();
        }

        const propertyTable = propertyTableBuilder.build();

        // === BUILD QUANTITY TABLE ===
        options.onProgress?.({ phase: 'quantities', percent: 80 });

        for (const [qsetId, qset] of quantitySets) {
            const entityIds = qsetToEntities.get(qsetId) || [];

            for (const quantity of qset.quantities) {
                for (const entityId of entityIds) {
                    quantityTableBuilder.add({
                        entityId,
                        qsetName: qset.name,
                        quantityName: quantity.name,
                        quantityType: quantity.type,
                        value: quantity.value,
                        formula: quantity.formula,
                    });
                }
            }
            await maybeYield();
        }

        const quantityTable = quantityTableBuilder.build();
        const relationshipGraph = relationshipGraphBuilder.build();

        // === BUILD ENTITY INDEX ===
        options.onProgress?.({ phase: 'indexing', percent: 90 });

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

        // === BUILD SPATIAL HIERARCHY ===
        options.onProgress?.({ phase: 'spatial-hierarchy', percent: 95 });
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
        }

        const parseTime = performance.now() - startTime;
        console.log(`[ColumnarParser] Total parse time: ${parseTime.toFixed(0)}ms`);
        options.onProgress?.({ phase: 'complete', percent: 100 });

        return {
            fileSize: buffer.byteLength,
            schemaVersion,
            entityCount: totalEntities,
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

    /**
     * LITE parsing mode - minimal structures without parsed entities
     * For very large files where we want geometry first, properties later
     */
    async parseLite(
        buffer: ArrayBuffer,
        entityRefs: EntityRef[],
        options: { onProgress?: (progress: { phase: string; percent: number }) => void } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const uint8Buffer = new Uint8Array(buffer);
        const totalEntities = entityRefs.length;

        options.onProgress?.({ phase: 'building (lite)', percent: 0 });

        // Initialize minimal builders
        const strings = new StringTable();
        const entityTableBuilder = new EntityTableBuilder(totalEntities, strings);
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        // Build entity table with just type info (no names/descriptions from attributes)
        let processed = 0;
        for (const ref of entityRefs) {
            const typeUpper = ref.type.toUpperCase();
            const hasGeometry = GEOMETRY_TYPES.has(typeUpper);
            const isType = typeUpper.endsWith('TYPE');

            // Minimal entity entry - no parsed attributes available
            entityTableBuilder.add(
                ref.expressId,
                ref.type,
                '', // globalId - not available without parsing
                '', // name - not available without parsing
                '', // description - not available without parsing
                '', // objectType - not available without parsing
                hasGeometry,
                isType
            );

            processed++;
            if (processed % 50000 === 0) {
                options.onProgress?.({ phase: 'building (lite)', percent: (processed / totalEntities) * 90 });
                await maybeYield();
            }
        }

        const entityTable = entityTableBuilder.build();

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

        // Empty property/quantity tables for lite mode
        const propertyTable = propertyTableBuilder.build();
        const quantityTable = quantityTableBuilder.build();
        const relationshipGraph = relationshipGraphBuilder.build();

        // No spatial hierarchy in lite mode (requires relationships)
        // Spatial hierarchy can be built on-demand when properties are loaded

        const parseTime = performance.now() - startTime;
        console.log(`[ColumnarParser] LITE parse: ${totalEntities} entities in ${parseTime.toFixed(0)}ms`);
        options.onProgress?.({ phase: 'complete (lite)', percent: 100 });

        return {
            fileSize: buffer.byteLength,
            schemaVersion: 'IFC4' as const,
            entityCount: totalEntities,
            parseTime,
            source: uint8Buffer,
            entityIndex,
            strings,
            entities: entityTable,
            properties: propertyTable,
            quantities: quantityTable,
            relationships: relationshipGraph,
            // spatialHierarchy omitted in lite mode - can be built on-demand
        };
    }

    /**
     * Fast relationship extraction - inline for performance
     */
    private extractRelationshipFast(entity: IfcEntity, typeUpper: string): Relationship | null {
        const attrs = entity.attributes;
        if (attrs.length < 6) return null;

        let relatingObject: any;
        let relatedObjects: any;

        if (typeUpper === 'IFCRELDEFINESBYPROPERTIES' || typeUpper === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
            relatedObjects = attrs[4];
            relatingObject = attrs[5];
        } else {
            relatingObject = attrs[4];
            relatedObjects = attrs[5];
        }

        if (typeof relatingObject !== 'number' || !Array.isArray(relatedObjects)) {
            return null;
        }

        return {
            type: entity.type,
            relatingObject,
            relatedObjects: relatedObjects.filter((id): id is number => typeof id === 'number'),
        };
    }

    /**
     * Fast property extraction - inline for performance
     */
    private extractPropertyFast(entity: IfcEntity): { name: string; value: PropertyValue } | null {
        const attrs = entity.attributes;
        const name = typeof attrs[0] === 'string' ? attrs[0] : '';
        if (!name) return null;

        const nominalValue = attrs[2];
        let value: PropertyValue;

        if (typeof nominalValue === 'number') {
            value = { type: 'number', value: nominalValue };
        } else if (typeof nominalValue === 'boolean') {
            value = { type: 'boolean', value: nominalValue };
        } else if (nominalValue === null || nominalValue === undefined) {
            value = { type: 'null', value: null };
        } else {
            value = { type: 'string', value: String(nominalValue) };
        }

        return { name, value };
    }

    /**
     * Fast quantity extraction - inline for performance
     */
    private extractQuantityFast(entity: IfcEntity): { name: string; type: QuantityType; value: number; formula?: string } | null {
        const typeUpper = entity.type.toUpperCase();
        const qtyType = QUANTITY_TYPE_MAP[typeUpper];
        if (!qtyType) return null;

        const attrs = entity.attributes;
        const name = typeof attrs[0] === 'string' ? attrs[0] : '';
        if (!name) return null;

        // Value is at index 3 for most quantity types
        const value = typeof attrs[3] === 'number' ? attrs[3] : 0;
        const formula = typeof attrs[4] === 'string' ? attrs[4] : undefined;

        return { name, type: qtyType, value, formula };
    }
}

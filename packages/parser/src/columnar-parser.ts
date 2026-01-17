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
import { EntityExtractor } from './entity-extractor.js';
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

    /** True if this was parsed in lite mode (properties/quantities not available) */
    isLiteMode?: boolean;

    /**
     * On-demand property lookup: entityId -> array of property set expressIds
     * Only populated in lite mode for instant property access
     */
    onDemandPropertyMap?: Map<number, number[]>;

    /**
     * On-demand quantity lookup: entityId -> array of quantity set expressIds
     * Only populated in lite mode for instant quantity access
     */
    onDemandQuantityMap?: Map<number, number[]>;
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

// Types needed for spatial hierarchy (small subset)
const SPATIAL_TYPES = new Set([
    'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE',
]);

// Relationship types needed for hierarchy
const HIERARCHY_REL_TYPES = new Set([
    'IFCRELAGGREGATES', 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
]);

// Relationship types for on-demand property loading
const PROPERTY_REL_TYPES = new Set([
    'IFCRELDEFINESBYPROPERTIES',
]);

// Property-related entity types for on-demand extraction
const PROPERTY_ENTITY_TYPES = new Set([
    'IFCPROPERTYSET', 'IFCELEMENTQUANTITY',
    'IFCPROPERTYSINGLEVALUE', 'IFCPROPERTYENUMERATEDVALUE',
    'IFCPROPERTYBOUNDEDVALUE', 'IFCPROPERTYTABLEVALUE',
    'IFCPROPERTYLISTVALUE', 'IFCPROPERTYREFERENCEVALUE',
    'IFCQUANTITYLENGTH', 'IFCQUANTITYAREA', 'IFCQUANTITYVOLUME',
    'IFCQUANTITYCOUNT', 'IFCQUANTITYWEIGHT', 'IFCQUANTITYTIME',
]);

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
     * LITE parsing mode - minimal structures with targeted spatial parsing
     * For very large files where we want geometry first, then hierarchy
     *
     * Parses ONLY spatial entities and relationships for hierarchy display,
     * skips all property sets and quantities (can be loaded on-demand).
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

        // Initialize builders
        const strings = new StringTable();
        const entityTableBuilder = new EntityTableBuilder(totalEntities, strings);
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        // Build entity index early (needed for property relationship lookup)
        const entityIndex = {
            byId: new Map<number, EntityRef>(),
            byType: new Map<string, number[]>(),
        };

        // First pass: collect spatial, relationship, and property refs for targeted parsing
        const spatialRefs: EntityRef[] = [];
        const relationshipRefs: EntityRef[] = [];
        const propertyRelRefs: EntityRef[] = [];
        const propertyEntityRefs: EntityRef[] = [];

        for (const ref of entityRefs) {
            // Build entity index
            entityIndex.byId.set(ref.expressId, ref);
            let typeList = entityIndex.byType.get(ref.type);
            if (!typeList) {
                typeList = [];
                entityIndex.byType.set(ref.type, typeList);
            }
            typeList.push(ref.expressId);

            // Categorize refs for targeted parsing
            const typeUpper = ref.type.toUpperCase();
            if (SPATIAL_TYPES.has(typeUpper)) {
                spatialRefs.push(ref);
            } else if (HIERARCHY_REL_TYPES.has(typeUpper)) {
                relationshipRefs.push(ref);
            } else if (PROPERTY_REL_TYPES.has(typeUpper)) {
                propertyRelRefs.push(ref);
            } else if (PROPERTY_ENTITY_TYPES.has(typeUpper)) {
                propertyEntityRefs.push(ref);
            }
        }

        // === TARGETED PARSING: Parse spatial entities first ===
        options.onProgress?.({ phase: 'parsing spatial', percent: 10 });

        const extractor = new EntityExtractor(uint8Buffer);
        const parsedSpatialData = new Map<number, { globalId: string; name: string }>();

        // Parse spatial entities (typically < 100 entities)
        for (const ref of spatialRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedSpatialData.set(ref.expressId, { globalId, name });
            }
        }

        console.log(`[ColumnarParser] Parsed ${spatialRefs.length} spatial entities`);

        // Parse relationship entities (typically < 10k entities)
        options.onProgress?.({ phase: 'parsing relationships', percent: 20 });

        const relationships: Relationship[] = [];
        for (const ref of relationshipRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const typeUpper = entity.type.toUpperCase();
                const rel = this.extractRelationshipFast(entity, typeUpper);
                if (rel) {
                    relationships.push(rel);

                    // Add to relationship graph
                    const relType = REL_TYPE_MAP[typeUpper];
                    if (relType) {
                        for (const targetId of rel.relatedObjects) {
                            relationshipGraphBuilder.addEdge(rel.relatingObject, targetId, relType, rel.relatingObject);
                        }
                    }
                }
            }
        }

        console.log(`[ColumnarParser] Parsed ${relationshipRefs.length} relationship entities, ${relationships.length} valid relationships`);

        // === PARSE PROPERTY RELATIONSHIPS for on-demand loading ===
        options.onProgress?.({ phase: 'parsing property refs', percent: 25 });

        const onDemandPropertyMap = new Map<number, number[]>();
        const onDemandQuantityMap = new Map<number, number[]>();

        // Parse IfcRelDefinesByProperties to build entity -> pset/qset mapping
        for (const ref of propertyRelRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                // IfcRelDefinesByProperties: relatedObjects at [4], relatingPropertyDefinition at [5]
                const relatedObjects = attrs[4];
                const relatingDef = attrs[5];

                if (typeof relatingDef === 'number' && Array.isArray(relatedObjects)) {
                    // Find if the relating definition is a property set or quantity set
                    const defRef = entityIndex.byId.get(relatingDef);
                    if (defRef) {
                        const defTypeUpper = defRef.type.toUpperCase();
                        const isPropertySet = defTypeUpper === 'IFCPROPERTYSET';
                        const isQuantitySet = defTypeUpper === 'IFCELEMENTQUANTITY';

                        if (isPropertySet || isQuantitySet) {
                            const targetMap = isPropertySet ? onDemandPropertyMap : onDemandQuantityMap;
                            for (const objId of relatedObjects) {
                                if (typeof objId === 'number') {
                                    let list = targetMap.get(objId);
                                    if (!list) {
                                        list = [];
                                        targetMap.set(objId, list);
                                    }
                                    list.push(relatingDef);
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log(`[ColumnarParser] On-demand: ${onDemandPropertyMap.size} entities with properties, ${onDemandQuantityMap.size} with quantities`);

        // === BUILD ENTITY TABLE with spatial data included ===
        options.onProgress?.({ phase: 'building entities', percent: 30 });

        let processed = 0;
        for (const ref of entityRefs) {
            const typeUpper = ref.type.toUpperCase();
            const hasGeometry = GEOMETRY_TYPES.has(typeUpper);
            const isType = typeUpper.endsWith('TYPE');

            // Get parsed data for spatial entities
            const spatialData = parsedSpatialData.get(ref.expressId);
            const globalId = spatialData?.globalId || '';
            const name = spatialData?.name || '';

            entityTableBuilder.add(
                ref.expressId,
                ref.type,
                globalId,
                name,
                '', // description
                '', // objectType
                hasGeometry,
                isType
            );

            processed++;
            if (processed % 50000 === 0) {
                options.onProgress?.({ phase: 'building entities', percent: 30 + (processed / totalEntities) * 50 });
                await maybeYield();
            }
        }

        const entityTable = entityTableBuilder.build();

        // Empty property/quantity tables for lite mode
        const propertyTable = propertyTableBuilder.build();
        const quantityTable = quantityTableBuilder.build();
        const relationshipGraph = relationshipGraphBuilder.build();

        // === BUILD SPATIAL HIERARCHY ===
        options.onProgress?.({ phase: 'building hierarchy', percent: 90 });

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
            console.log(`[ColumnarParser] Built spatial hierarchy with ${spatialHierarchy.byStorey.size} storeys`);
        } catch (error) {
            console.warn('[ColumnarParser] Failed to build spatial hierarchy:', error);
        }

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
            spatialHierarchy,
            isLiteMode: true, // Mark as lite mode - properties need background parse
            onDemandPropertyMap, // For instant property access
            onDemandQuantityMap, // For instant quantity access
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

    /**
     * Background full parse - takes an existing lite data store and fills in properties/quantities
     * Runs in background with minimal blocking
     */
    async parseFullBackground(
        liteStore: IfcDataStore,
        options: { onProgress?: (progress: { phase: string; percent: number }) => void } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const source = liteStore.source;
        const entityIndex = liteStore.entityIndex;

        options.onProgress?.({ phase: 'background parsing', percent: 0 });

        // Extract full entities
        const extractor = new EntityExtractor(source);
        const entities = new Map<number, IfcEntity>();
        const entityRefs = Array.from(entityIndex.byId.values());
        const totalEntities = entityRefs.length;

        let processed = 0;
        const YIELD_INTERVAL = 2000; // Yield frequently to avoid blocking

        for (const ref of entityRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                entities.set(ref.expressId, entity);
            }

            processed++;
            if (processed % YIELD_INTERVAL === 0) {
                options.onProgress?.({ phase: 'parsing entities', percent: (processed / totalEntities) * 30 });
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log(`[ColumnarParser] Background: extracted ${entities.size} entities`);

        // Now do the full parse with all entities
        const buffer = (source.buffer as ArrayBuffer).slice(source.byteOffset, source.byteOffset + source.byteLength);
        const fullStore = await this.parse(buffer, entityRefs, entities, {
            onProgress: (prog) => {
                options.onProgress?.({
                    phase: prog.phase,
                    percent: 30 + (prog.percent * 0.7) // Scale to 30-100%
                });
            }
        });

        const parseTime = performance.now() - startTime;
        console.log(`[ColumnarParser] Background full parse complete: ${parseTime.toFixed(0)}ms`);

        return fullStore;
    }

    /**
     * Extract properties for a single entity ON-DEMAND
     * For use in lite mode - parses only what's needed, instantly
     */
    extractPropertiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: any }> }> {
        if (!store.isLiteMode || !store.onDemandPropertyMap) {
            // Not in lite mode, use regular property table
            return store.properties.getForEntity(entityId);
        }

        const psetIds = store.onDemandPropertyMap.get(entityId);
        if (!psetIds || psetIds.length === 0) {
            return [];
        }

        const extractor = new EntityExtractor(store.source);
        const result: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: any }> }> = [];

        for (const psetId of psetIds) {
            const psetRef = store.entityIndex.byId.get(psetId);
            if (!psetRef) continue;

            const psetEntity = extractor.extractEntity(psetRef);
            if (!psetEntity) continue;

            const psetAttrs = psetEntity.attributes || [];
            const psetGlobalId = typeof psetAttrs[0] === 'string' ? psetAttrs[0] : undefined;
            const psetName = typeof psetAttrs[2] === 'string' ? psetAttrs[2] : `PropertySet #${psetId}`;
            const hasProperties = psetAttrs[4];

            const properties: Array<{ name: string; type: number; value: any }> = [];

            if (Array.isArray(hasProperties)) {
                for (const propRef of hasProperties) {
                    if (typeof propRef !== 'number') continue;

                    const propEntityRef = store.entityIndex.byId.get(propRef);
                    if (!propEntityRef) continue;

                    const propEntity = extractor.extractEntity(propEntityRef);
                    if (!propEntity) continue;

                    const propAttrs = propEntity.attributes || [];
                    const propName = typeof propAttrs[0] === 'string' ? propAttrs[0] : '';
                    if (!propName) continue;

                    // IfcPropertySingleValue: [name, description, nominalValue, unit]
                    const nominalValue = propAttrs[2];
                    let type = 0; // String
                    let value: any = nominalValue;

                    if (typeof nominalValue === 'number') {
                        type = 1; // Real
                    } else if (typeof nominalValue === 'boolean') {
                        type = 2; // Boolean
                    } else if (nominalValue !== null && nominalValue !== undefined) {
                        value = String(nominalValue);
                    }

                    properties.push({ name: propName, type, value });
                }
            }

            if (properties.length > 0 || psetName) {
                result.push({ name: psetName, globalId: psetGlobalId, properties });
            }
        }

        return result;
    }

    /**
     * Extract quantities for a single entity ON-DEMAND
     * For use in lite mode - parses only what's needed, instantly
     */
    extractQuantitiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
        if (!store.isLiteMode || !store.onDemandQuantityMap) {
            // Not in lite mode, use regular quantity table
            return store.quantities.getForEntity(entityId);
        }

        const qsetIds = store.onDemandQuantityMap.get(entityId);
        if (!qsetIds || qsetIds.length === 0) {
            return [];
        }

        const extractor = new EntityExtractor(store.source);
        const result: Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> = [];

        for (const qsetId of qsetIds) {
            const qsetRef = store.entityIndex.byId.get(qsetId);
            if (!qsetRef) continue;

            const qsetEntity = extractor.extractEntity(qsetRef);
            if (!qsetEntity) continue;

            const qsetAttrs = qsetEntity.attributes || [];
            const qsetName = typeof qsetAttrs[2] === 'string' ? qsetAttrs[2] : `QuantitySet #${qsetId}`;
            const hasQuantities = qsetAttrs[5];

            const quantities: Array<{ name: string; type: number; value: number }> = [];

            if (Array.isArray(hasQuantities)) {
                for (const qtyRef of hasQuantities) {
                    if (typeof qtyRef !== 'number') continue;

                    const qtyEntityRef = store.entityIndex.byId.get(qtyRef);
                    if (!qtyEntityRef) continue;

                    const qtyEntity = extractor.extractEntity(qtyEntityRef);
                    if (!qtyEntity) continue;

                    const qtyAttrs = qtyEntity.attributes || [];
                    const qtyName = typeof qtyAttrs[0] === 'string' ? qtyAttrs[0] : '';
                    if (!qtyName) continue;

                    // Get quantity type from entity type
                    const qtyTypeUpper = qtyEntity.type.toUpperCase();
                    const qtyType = QUANTITY_TYPE_MAP[qtyTypeUpper] ?? QuantityType.Count;

                    // Value is at index 3 for most quantity types
                    const value = typeof qtyAttrs[3] === 'number' ? qtyAttrs[3] : 0;

                    quantities.push({ name: qtyName, type: qtyType, value });
                }
            }

            if (quantities.length > 0 || qsetName) {
                result.push({ name: qsetName, quantities });
            }
        }

        return result;
    }
}

/**
 * Standalone on-demand property extractor
 * Can be used outside ColumnarParser class
 */
export function extractPropertiesOnDemand(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: any }> }> {
    const parser = new ColumnarParser();
    return parser.extractPropertiesOnDemand(store, entityId);
}

/**
 * Standalone on-demand quantity extractor
 * Can be used outside ColumnarParser class
 */
export function extractQuantitiesOnDemand(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
    const parser = new ColumnarParser();
    return parser.extractQuantitiesOnDemand(store, entityId);
}

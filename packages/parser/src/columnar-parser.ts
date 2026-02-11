/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Columnar parser - builds columnar data structures
 *
 * OPTIMIZED: Single-pass extraction for maximum performance
 * Instead of multiple passes through entities, we extract everything in ONE loop.
 */

import type { EntityRef, IfcEntity, Relationship } from './types.js';
import { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';
import { EntityExtractor } from './entity-extractor.js';
import { extractLengthUnitScale } from './unit-extractor.js';
import { getAttributeNames } from './ifc-schema.js';
import {
    StringTable,
    EntityTableBuilder,
    PropertyTableBuilder,
    QuantityTableBuilder,
    RelationshipGraphBuilder,
    RelationshipType,
    QuantityType,
} from '@ifc-lite/data';
import type { SpatialHierarchy, QuantityTable, PropertyValue } from '@ifc-lite/data';

// SpatialIndex interface - matches BVH from @ifc-lite/spatial
export interface SpatialIndex {
    queryAABB(bounds: { min: [number, number, number]; max: [number, number, number] }): number[];
    raycast(origin: [number, number, number], direction: [number, number, number]): number[];
}

export interface IfcDataStore {
    fileSize: number;
    schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5';
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

    /**
     * On-demand property lookup: entityId -> array of property set expressIds
     * Used for fast single-entity property access without pre-building property tables.
     * Use extractPropertiesOnDemand() with this map for instant property retrieval.
     */
    onDemandPropertyMap?: Map<number, number[]>;

    /**
     * On-demand quantity lookup: entityId -> array of quantity set expressIds
     * Used for fast single-entity quantity access without pre-building quantity tables.
     * Use extractQuantitiesOnDemand() with this map for instant quantity retrieval.
     */
    onDemandQuantityMap?: Map<number, number[]>;

    /**
     * On-demand classification lookup: entityId -> array of IfcClassificationReference expressIds
     * Built from IfcRelAssociatesClassification relationships during parsing.
     */
    onDemandClassificationMap?: Map<number, number[]>;

    /**
     * On-demand material lookup: entityId -> relatingMaterial expressId
     * Built from IfcRelAssociatesMaterial relationships during parsing.
     * Value is the expressId of IfcMaterial, IfcMaterialLayerSet, IfcMaterialProfileSet, or IfcMaterialConstituentSet.
     */
    onDemandMaterialMap?: Map<number, number>;

    /**
     * On-demand document lookup: entityId -> array of IfcDocumentReference/IfcDocumentInformation expressIds
     * Built from IfcRelAssociatesDocument relationships during parsing.
     */
    onDemandDocumentMap?: Map<number, number[]>;
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

// IMPORTANT: This set MUST include ALL RelationshipType enum values to prevent semantic loss
// Missing types will be skipped during parsing, causing incomplete relationship graphs
const RELATIONSHIP_TYPES = new Set([
    'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELAGGREGATES',
    'IFCRELDEFINESBYPROPERTIES', 'IFCRELDEFINESBYTYPE',
    'IFCRELASSOCIATESMATERIAL', 'IFCRELASSOCIATESCLASSIFICATION',
    'IFCRELASSOCIATESDOCUMENT',
    'IFCRELVOIDSELEMENT', 'IFCRELFILLSELEMENT',
    'IFCRELCONNECTSPATHELEMENTS', 'IFCRELCONNECTSELEMENTS',
    'IFCRELSPACEBOUNDARY',
    'IFCRELASSIGNSTOGROUP', 'IFCRELASSIGNSTOPRODUCT',
    'IFCRELREFERENCEDINSPATIALSTRUCTURE',
]);

// Map IFC relationship type strings to RelationshipType enum
// MUST cover ALL RelationshipType enum values (14 types total)
const REL_TYPE_MAP: Record<string, RelationshipType> = {
    'IFCRELCONTAINEDINSPATIALSTRUCTURE': RelationshipType.ContainsElements,
    'IFCRELAGGREGATES': RelationshipType.Aggregates,
    'IFCRELDEFINESBYPROPERTIES': RelationshipType.DefinesByProperties,
    'IFCRELDEFINESBYTYPE': RelationshipType.DefinesByType,
    'IFCRELASSOCIATESMATERIAL': RelationshipType.AssociatesMaterial,
    'IFCRELASSOCIATESCLASSIFICATION': RelationshipType.AssociatesClassification,
    'IFCRELASSOCIATESDOCUMENT': RelationshipType.AssociatesDocument,
    'IFCRELVOIDSELEMENT': RelationshipType.VoidsElement,
    'IFCRELFILLSELEMENT': RelationshipType.FillsElement,
    'IFCRELCONNECTSPATHELEMENTS': RelationshipType.ConnectsPathElements,
    'IFCRELCONNECTSELEMENTS': RelationshipType.ConnectsElements,
    'IFCRELSPACEBOUNDARY': RelationshipType.SpaceBoundary,
    'IFCRELASSIGNSTOGROUP': RelationshipType.AssignsToGroup,
    'IFCRELASSIGNSTOPRODUCT': RelationshipType.AssignsToProduct,
    'IFCRELREFERENCEDINSPATIALSTRUCTURE': RelationshipType.ReferencedInSpatialStructure,
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
    'IFCRELDEFINESBYTYPE',
]);

// Relationship types for on-demand property loading
const PROPERTY_REL_TYPES = new Set([
    'IFCRELDEFINESBYPROPERTIES',
]);

// Relationship types for on-demand classification/material loading
const ASSOCIATION_REL_TYPES = new Set([
    'IFCRELASSOCIATESCLASSIFICATION', 'IFCRELASSOCIATESMATERIAL',
    'IFCRELASSOCIATESDOCUMENT',
]);

// Attributes to skip in extractAllEntityAttributes (shown elsewhere or non-displayable)
const SKIP_DISPLAY_ATTRS = new Set(['GlobalId', 'OwnerHistory', 'ObjectPlacement', 'Representation']);

// Property-related entity types for on-demand extraction
const PROPERTY_ENTITY_TYPES = new Set([
    'IFCPROPERTYSET', 'IFCELEMENTQUANTITY',
    'IFCPROPERTYSINGLEVALUE', 'IFCPROPERTYENUMERATEDVALUE',
    'IFCPROPERTYBOUNDEDVALUE', 'IFCPROPERTYTABLEVALUE',
    'IFCPROPERTYLISTVALUE', 'IFCPROPERTYREFERENCEVALUE',
    'IFCQUANTITYLENGTH', 'IFCQUANTITYAREA', 'IFCQUANTITYVOLUME',
    'IFCQUANTITYCOUNT', 'IFCQUANTITYWEIGHT', 'IFCQUANTITYTIME',
]);

/**
 * Detect the IFC schema version from the STEP FILE_SCHEMA header.
 * Scans the first 2000 bytes for FILE_SCHEMA(('IFC2X3')), FILE_SCHEMA(('IFC4')), etc.
 */
function detectSchemaVersion(buffer: Uint8Array): IfcDataStore['schemaVersion'] {
    const headerEnd = Math.min(buffer.length, 2000);
    const headerText = new TextDecoder().decode(buffer.subarray(0, headerEnd)).toUpperCase();

    if (headerText.includes('IFC4X3')) return 'IFC4X3';
    if (headerText.includes('IFC4')) return 'IFC4';
    if (headerText.includes('IFC2X3')) return 'IFC2X3';

    return 'IFC4'; // Default fallback
}

export class ColumnarParser {
    /**
     * Parse IFC file into columnar data store
     *
     * Uses fast semicolon-based scanning with on-demand property extraction.
     * Properties are parsed lazily when accessed, not upfront.
     * This provides instant UI responsiveness even for very large files.
     */
    async parseLite(
        buffer: ArrayBuffer,
        entityRefs: EntityRef[],
        options: { onProgress?: (progress: { phase: string; percent: number }) => void } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const uint8Buffer = new Uint8Array(buffer);
        const totalEntities = entityRefs.length;

        options.onProgress?.({ phase: 'building', percent: 0 });

        // Detect schema version from FILE_SCHEMA header
        const schemaVersion = detectSchemaVersion(uint8Buffer);

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

        // First pass: collect spatial, geometry, relationship, and property refs for targeted parsing
        const spatialRefs: EntityRef[] = [];
        const geometryRefs: EntityRef[] = [];
        const relationshipRefs: EntityRef[] = [];
        const propertyRelRefs: EntityRef[] = [];
        const propertyEntityRefs: EntityRef[] = [];
        const associationRelRefs: EntityRef[] = [];

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
            } else if (GEOMETRY_TYPES.has(typeUpper)) {
                geometryRefs.push(ref);
            } else if (HIERARCHY_REL_TYPES.has(typeUpper)) {
                relationshipRefs.push(ref);
            } else if (PROPERTY_REL_TYPES.has(typeUpper)) {
                propertyRelRefs.push(ref);
            } else if (PROPERTY_ENTITY_TYPES.has(typeUpper)) {
                propertyEntityRefs.push(ref);
            } else if (ASSOCIATION_REL_TYPES.has(typeUpper)) {
                associationRelRefs.push(ref);
            }
        }

        // === TARGETED PARSING: Parse spatial and geometry entities for GlobalIds ===
        options.onProgress?.({ phase: 'parsing spatial', percent: 10 });

        const extractor = new EntityExtractor(uint8Buffer);
        const parsedEntityData = new Map<number, { globalId: string; name: string }>();

        // Parse spatial entities (typically < 100 entities)
        for (const ref of spatialRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedEntityData.set(ref.expressId, { globalId, name });
            }
        }

        // Parse geometry entities for GlobalIds (needed for BCF component references)
        // IFC entities with geometry have GlobalId at attribute[0] and Name at attribute[2]
        options.onProgress?.({ phase: 'parsing geometry globalIds', percent: 12 });
        for (const ref of geometryRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedEntityData.set(ref.expressId, { globalId, name });
            }
        }

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

        // === PARSE PROPERTY RELATIONSHIPS for on-demand loading ===
        options.onProgress?.({ phase: 'parsing property refs', percent: 25 });

        const onDemandPropertyMap = new Map<number, number[]>();
        const onDemandQuantityMap = new Map<number, number[]>();

        // Parse IfcRelDefinesByProperties to build entity -> pset/qset mapping
        // ALSO add to relationship graph so cache loads can rebuild on-demand maps
        for (const ref of propertyRelRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                // IfcRelDefinesByProperties: relatedObjects at [4], relatingPropertyDefinition at [5]
                const relatedObjects = attrs[4];
                const relatingDef = attrs[5];

                if (typeof relatingDef === 'number' && Array.isArray(relatedObjects)) {
                    // Add to relationship graph (needed for cache rebuild)
                    for (const objId of relatedObjects) {
                        if (typeof objId === 'number') {
                            relationshipGraphBuilder.addEdge(relatingDef, objId, RelationshipType.DefinesByProperties, ref.expressId);
                        }
                    }

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

        // === PARSE ASSOCIATION RELATIONSHIPS for on-demand classification/material/document loading ===
        const onDemandClassificationMap = new Map<number, number[]>();
        const onDemandMaterialMap = new Map<number, number>();
        const onDemandDocumentMap = new Map<number, number[]>();

        for (const ref of associationRelRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                // IfcRelAssociates subtypes:
                // [0] GlobalId, [1] OwnerHistory, [2] Name, [3] Description
                // [4] RelatedObjects (list of element IDs)
                // [5] RelatingClassification / RelatingMaterial / RelatingDocument
                const relatedObjects = attrs[4];
                const relatingRef = attrs[5];

                if (typeof relatingRef === 'number' && Array.isArray(relatedObjects)) {
                    const typeUpper = ref.type.toUpperCase();

                    if (typeUpper === 'IFCRELASSOCIATESCLASSIFICATION') {
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                let list = onDemandClassificationMap.get(objId);
                                if (!list) {
                                    list = [];
                                    onDemandClassificationMap.set(objId, list);
                                }
                                list.push(relatingRef);
                            }
                        }
                    } else if (typeUpper === 'IFCRELASSOCIATESMATERIAL') {
                        // IFC allows multiple IfcRelAssociatesMaterial per element but typically
                        // only one is valid. Last-write-wins: later relationships override earlier ones.
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                onDemandMaterialMap.set(objId, relatingRef);
                            }
                        }
                    } else if (typeUpper === 'IFCRELASSOCIATESDOCUMENT') {
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                let list = onDemandDocumentMap.get(objId);
                                if (!list) {
                                    list = [];
                                    onDemandDocumentMap.set(objId, list);
                                }
                                list.push(relatingRef);
                            }
                        }
                    }
                }
            }
        }

        // === BUILD ENTITY TABLE with spatial data included ===
        options.onProgress?.({ phase: 'building entities', percent: 30 });

        // OPTIMIZATION: Only add entities that are useful for the viewer UI
        // Skip geometric primitives like IFCCARTESIANPOINT, IFCDIRECTION, etc.
        // This reduces 4M+ entities to ~100K relevant ones
        const RELEVANT_ENTITY_PREFIXES = new Set([
            'IFCWALL', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN', 'IFCPLATE', 'IFCDOOR', 'IFCWINDOW',
            'IFCROOF', 'IFCSTAIR', 'IFCRAILING', 'IFCRAMP', 'IFCFOOTING', 'IFCPILE',
            'IFCMEMBER', 'IFCCURTAINWALL', 'IFCBUILDINGELEMENTPROXY', 'IFCFURNISHINGELEMENT',
            'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL', 'IFCFLOWCONTROLLER', 'IFCFLOWFITTING',
            'IFCSPACE', 'IFCOPENINGELEMENT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
            'IFCPROJECT', 'IFCCOVERING', 'IFCANNOTATION', 'IFCGRID',
        ]);
        
        let processed = 0;
        let added = 0;
        for (const ref of entityRefs) {
            const typeUpper = ref.type.toUpperCase();
            
            // Skip non-relevant entities (geometric primitives, etc.)
            const hasGeometry = GEOMETRY_TYPES.has(typeUpper);
            const isType = typeUpper.endsWith('TYPE');
            const isSpatial = SPATIAL_TYPES.has(typeUpper);
            const isRelevant = hasGeometry || isType || isSpatial || 
                RELEVANT_ENTITY_PREFIXES.has(typeUpper) ||
                typeUpper.startsWith('IFCREL') ||  // Keep relationships for hierarchy
                onDemandPropertyMap.has(ref.expressId) ||  // Keep entities with properties
                onDemandQuantityMap.has(ref.expressId);    // Keep entities with quantities
            
            if (!isRelevant) {
                processed++;
                continue;
            }

            // Get parsed data (GlobalId, Name) for spatial and geometry entities
            const entityData = parsedEntityData.get(ref.expressId);
            const globalId = entityData?.globalId || '';
            const name = entityData?.name || '';

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
            added++;

            processed++;
            // Yield every 10000 entities for better interleaving with geometry streaming
            if (processed % 10000 === 0) {
                options.onProgress?.({ phase: 'building entities', percent: 30 + (processed / totalEntities) * 50 });
                // Direct yield - don't use maybeYield since we're already throttling
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        const entityTable = entityTableBuilder.build();

        // Empty property/quantity tables - use on-demand extraction instead
        const propertyTable = propertyTableBuilder.build();
        const quantityTable = quantityTableBuilder.build();
        const relationshipGraph = relationshipGraphBuilder.build();

        // === EXTRACT LENGTH UNIT SCALE ===
        options.onProgress?.({ phase: 'extracting units', percent: 85 });
        const lengthUnitScale = extractLengthUnitScale(uint8Buffer, entityIndex);

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
                entityIndex,
                lengthUnitScale
            );
        } catch (error) {
            console.warn('[ColumnarParser] Failed to build spatial hierarchy:', error);
        }

        const parseTime = performance.now() - startTime;
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
            onDemandPropertyMap, // For instant property access
            onDemandQuantityMap, // For instant quantity access
            onDemandClassificationMap, // For instant classification access
            onDemandMaterialMap, // For instant material access
            onDemandDocumentMap, // For instant document access
        };
    }

    /**
     * Fast relationship extraction - inline for performance
     */
    private extractRelationshipFast(entity: IfcEntity, typeUpper: string): Relationship | null {
        const attrs = entity.attributes;
        if (attrs.length < 6) return null;

        let relatingObject: unknown;
        let relatedObjects: unknown;

        if (typeUpper === 'IFCRELDEFINESBYPROPERTIES' || typeUpper === 'IFCRELDEFINESBYTYPE' || typeUpper === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
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
     * Extract properties for a single entity ON-DEMAND
     * Parses only what's needed from the source buffer - instant results.
     */
    extractPropertiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> {
        // Use on-demand extraction if map is available (preferred for single-entity access)
        if (!store.onDemandPropertyMap) {
            // Fallback to pre-computed property table (e.g., server-parsed data)
            return store.properties.getForEntity(entityId);
        }

        const psetIds = store.onDemandPropertyMap.get(entityId);
        if (!psetIds || psetIds.length === 0) {
            return [];
        }

        const extractor = new EntityExtractor(store.source);
        const result: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> = [];

        for (const psetId of psetIds) {
            const psetRef = store.entityIndex.byId.get(psetId);
            if (!psetRef) continue;

            const psetEntity = extractor.extractEntity(psetRef);
            if (!psetEntity) continue;

            const psetAttrs = psetEntity.attributes || [];
            const psetGlobalId = typeof psetAttrs[0] === 'string' ? psetAttrs[0] : undefined;
            const psetName = typeof psetAttrs[2] === 'string' ? psetAttrs[2] : `PropertySet #${psetId}`;
            const hasProperties = psetAttrs[4];

            const properties: Array<{ name: string; type: number; value: PropertyValue }> = [];

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

                    const parsed = parsePropertyValue(propEntity);
                    properties.push({ name: propName, type: parsed.type, value: parsed.value });
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
     * Parses only what's needed from the source buffer - instant results.
     */
    extractQuantitiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
        // Use on-demand extraction if map is available (preferred for single-entity access)
        if (!store.onDemandQuantityMap) {
            // Fallback to pre-computed quantity table (e.g., server-parsed data)
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
): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> {
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

/**
 * Extract entity attributes on-demand from source buffer
 * Returns globalId, name, description, objectType, tag for any IfcRoot-derived entity.
 * This is used for entities that weren't fully parsed during initial load.
 */
export function extractEntityAttributesOnDemand(
    store: IfcDataStore,
    entityId: number
): { globalId: string; name: string; description: string; objectType: string; tag: string } {
    const ref = store.entityIndex.byId.get(entityId);
    if (!ref) {
        return { globalId: '', name: '', description: '', objectType: '', tag: '' };
    }

    const extractor = new EntityExtractor(store.source);
    const entity = extractor.extractEntity(ref);
    if (!entity) {
        return { globalId: '', name: '', description: '', objectType: '', tag: '' };
    }

    const attrs = entity.attributes || [];
    // IfcRoot attributes: [GlobalId, OwnerHistory, Name, Description]
    // IfcObject adds: [ObjectType] at index 4
    // IfcProduct adds: [ObjectPlacement, Representation] at indices 5-6
    // IfcElement adds: [Tag] at index 7
    const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
    const name = typeof attrs[2] === 'string' ? attrs[2] : '';
    const description = typeof attrs[3] === 'string' ? attrs[3] : '';
    const objectType = typeof attrs[4] === 'string' ? attrs[4] : '';
    const tag = typeof attrs[7] === 'string' ? attrs[7] : '';

    return { globalId, name, description, objectType, tag };
}

/**
 * Extract ALL named entity attributes on-demand from source buffer.
 * Uses the IFC schema to map attribute indices to names.
 * Returns only string/enum attributes, skipping references and structural attributes.
 */
export function extractAllEntityAttributes(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; value: string }> {
    const ref = store.entityIndex.byId.get(entityId);
    if (!ref) return [];

    const extractor = new EntityExtractor(store.source);
    const entity = extractor.extractEntity(ref);
    if (!entity) return [];

    const attrs = entity.attributes || [];
    // Use properly-cased type name from entity table (IfcTypeEnumToString)
    // instead of ref.type which is UPPERCASE from STEP (e.g., IFCWALLSTANDARDCASE)
    // and breaks multi-word type normalization in getAttributeNames
    const typeName = store.entities.getTypeName(entityId);
    const attrNames = getAttributeNames(typeName || ref.type);

    const result: Array<{ name: string; value: string }> = [];
    const len = Math.min(attrs.length, attrNames.length);
    for (let i = 0; i < len; i++) {
        const attrName = attrNames[i];
        if (SKIP_DISPLAY_ATTRS.has(attrName)) continue;

        const raw = attrs[i];
        if (typeof raw === 'string' && raw) {
            // Clean enum values: .NOTDEFINED. -> NOTDEFINED
            const display = raw.startsWith('.') && raw.endsWith('.')
                ? raw.slice(1, -1)
                : raw;
            result.push({ name: attrName, value: display });
        }
    }

    return result;
}

// ============================================================================
// Classification and Material On-Demand Extractors
// ============================================================================

export interface ClassificationInfo {
    system?: string;
    identification?: string;
    name?: string;
    location?: string;
    description?: string;
    path?: string[];
}

export interface MaterialInfo {
    type: 'Material' | 'MaterialLayerSet' | 'MaterialProfileSet' | 'MaterialConstituentSet' | 'MaterialList';
    name?: string;
    description?: string;
    layers?: MaterialLayerInfo[];
    profiles?: MaterialProfileInfo[];
    constituents?: MaterialConstituentInfo[];
    materials?: string[];
}

export interface MaterialLayerInfo {
    materialName?: string;
    thickness?: number;
    isVentilated?: boolean;
    name?: string;
    category?: string;
}

export interface MaterialProfileInfo {
    materialName?: string;
    name?: string;
    category?: string;
}

export interface MaterialConstituentInfo {
    materialName?: string;
    name?: string;
    fraction?: number;
    category?: string;
}

/**
 * Extract classifications for a single entity ON-DEMAND.
 * Uses the onDemandClassificationMap built during parsing.
 * Falls back to relationship graph when on-demand map is not available (e.g., server-loaded models).
 * Also checks type-level associations via IfcRelDefinesByType.
 * Returns an array of classification references with system info.
 */
export function extractClassificationsOnDemand(
    store: IfcDataStore,
    entityId: number
): ClassificationInfo[] {
    let classRefIds: number[] | undefined;

    if (store.onDemandClassificationMap) {
        classRefIds = store.onDemandClassificationMap.get(entityId);
    } else if (store.relationships) {
        // Fallback: use relationship graph (server-loaded models)
        const related = store.relationships.getRelated(entityId, RelationshipType.AssociatesClassification, 'inverse');
        if (related.length > 0) classRefIds = related;
    }

    // Also check type-level classifications via IfcRelDefinesByType
    if (store.relationships) {
        const typeIds = store.relationships.getRelated(entityId, RelationshipType.DefinesByType, 'inverse');
        for (const typeId of typeIds) {
            let typeClassRefs: number[] | undefined;
            if (store.onDemandClassificationMap) {
                typeClassRefs = store.onDemandClassificationMap.get(typeId);
            } else {
                const related = store.relationships.getRelated(typeId, RelationshipType.AssociatesClassification, 'inverse');
                if (related.length > 0) typeClassRefs = related;
            }
            if (typeClassRefs && typeClassRefs.length > 0) {
                classRefIds = classRefIds ? [...classRefIds, ...typeClassRefs] : [...typeClassRefs];
            }
        }
    }

    if (!classRefIds || classRefIds.length === 0) return [];
    if (!store.source?.length) return [];

    const extractor = new EntityExtractor(store.source);
    const results: ClassificationInfo[] = [];

    for (const classRefId of classRefIds) {
        const ref = store.entityIndex.byId.get(classRefId);
        if (!ref) continue;

        const entity = extractor.extractEntity(ref);
        if (!entity) continue;

        const typeUpper = entity.type.toUpperCase();
        const attrs = entity.attributes || [];

        if (typeUpper === 'IFCCLASSIFICATIONREFERENCE') {
            // IfcClassificationReference: [Location, Identification, Name, ReferencedSource, Description, Sort]
            const info: ClassificationInfo = {
                location: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                identification: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                name: typeof attrs[2] === 'string' ? attrs[2] : undefined,
                description: typeof attrs[4] === 'string' ? attrs[4] : undefined,
            };

            // Walk up to find the classification system name
            const referencedSourceId = typeof attrs[3] === 'number' ? attrs[3] : undefined;
            if (referencedSourceId) {
                const path = walkClassificationChain(store, extractor, referencedSourceId);
                info.system = path.systemName;
                info.path = path.codes;
            }

            results.push(info);
        } else if (typeUpper === 'IFCCLASSIFICATION') {
            // IfcClassification: [Source, Edition, EditionDate, Name, Description, Location, ReferenceTokens]
            results.push({
                system: typeof attrs[3] === 'string' ? attrs[3] : undefined,
                name: typeof attrs[3] === 'string' ? attrs[3] : undefined,
                description: typeof attrs[4] === 'string' ? attrs[4] : undefined,
                location: typeof attrs[5] === 'string' ? attrs[5] : undefined,
            });
        }
    }

    return results;
}

/**
 * Walk up the IfcClassificationReference chain to find the root IfcClassification system.
 */
function walkClassificationChain(
    store: IfcDataStore,
    extractor: EntityExtractor,
    startId: number
): { systemName?: string; codes: string[] } {
    const codes: string[] = [];
    let currentId: number | undefined = startId;
    const visited = new Set<number>();

    while (currentId !== undefined && !visited.has(currentId)) {
        visited.add(currentId);

        const ref = store.entityIndex.byId.get(currentId);
        if (!ref) break;

        const entity = extractor.extractEntity(ref);
        if (!entity) break;

        const typeUpper = entity.type.toUpperCase();
        const attrs = entity.attributes || [];

        if (typeUpper === 'IFCCLASSIFICATION') {
            // Root: IfcClassification [Source, Edition, EditionDate, Name, ...]
            const systemName = typeof attrs[3] === 'string' ? attrs[3] : undefined;
            return { systemName, codes };
        }

        if (typeUpper === 'IFCCLASSIFICATIONREFERENCE') {
            // IfcClassificationReference [Location, Identification, Name, ReferencedSource, ...]
            const code = typeof attrs[1] === 'string' ? attrs[1] :
                         typeof attrs[2] === 'string' ? attrs[2] : undefined;
            if (code) codes.unshift(code);

            currentId = typeof attrs[3] === 'number' ? attrs[3] : undefined;
        } else {
            break;
        }
    }

    return { codes };
}

/**
 * Extract materials for a single entity ON-DEMAND.
 * Uses the onDemandMaterialMap built during parsing.
 * Falls back to relationship graph when on-demand map is not available (e.g., server-loaded models).
 * Also checks type-level material assignments via IfcRelDefinesByType.
 * Resolves the full material structure (layers, profiles, constituents, lists).
 */
export function extractMaterialsOnDemand(
    store: IfcDataStore,
    entityId: number
): MaterialInfo | null {
    let materialId: number | undefined;

    if (store.onDemandMaterialMap) {
        materialId = store.onDemandMaterialMap.get(entityId);
    } else if (store.relationships) {
        // Fallback: use relationship graph (server-loaded models)
        const related = store.relationships.getRelated(entityId, RelationshipType.AssociatesMaterial, 'inverse');
        if (related.length > 0) materialId = related[0];
    }

    // Check type-level material if occurrence has none
    if (materialId === undefined && store.relationships) {
        const typeIds = store.relationships.getRelated(entityId, RelationshipType.DefinesByType, 'inverse');
        for (const typeId of typeIds) {
            if (store.onDemandMaterialMap) {
                materialId = store.onDemandMaterialMap.get(typeId);
            } else {
                const related = store.relationships.getRelated(typeId, RelationshipType.AssociatesMaterial, 'inverse');
                if (related.length > 0) materialId = related[0];
            }
            if (materialId !== undefined) break;
        }
    }

    if (materialId === undefined) return null;
    if (!store.source?.length) return null;

    const extractor = new EntityExtractor(store.source);
    return resolveMaterial(store, extractor, materialId, new Set());
}

/**
 * Resolve a material entity by ID, handling all IFC material types.
 * Uses visited set to prevent infinite recursion on cyclic *Usage references.
 */
function resolveMaterial(
    store: IfcDataStore,
    extractor: EntityExtractor,
    materialId: number,
    visited: Set<number> = new Set()
): MaterialInfo | null {
    if (visited.has(materialId)) return null;
    visited.add(materialId);

    const ref = store.entityIndex.byId.get(materialId);
    if (!ref) return null;

    const entity = extractor.extractEntity(ref);
    if (!entity) return null;

    const typeUpper = entity.type.toUpperCase();
    const attrs = entity.attributes || [];

    switch (typeUpper) {
        case 'IFCMATERIAL': {
            // IfcMaterial: [Name, Description, Category]
            return {
                type: 'Material',
                name: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                description: typeof attrs[1] === 'string' ? attrs[1] : undefined,
            };
        }

        case 'IFCMATERIALLAYERSET': {
            // IfcMaterialLayerSet: [MaterialLayers, LayerSetName, Description]
            const layerIds = Array.isArray(attrs[0]) ? attrs[0].filter((id): id is number => typeof id === 'number') : [];
            const layers: MaterialLayerInfo[] = [];

            for (const layerId of layerIds) {
                const layerRef = store.entityIndex.byId.get(layerId);
                if (!layerRef) continue;
                const layerEntity = extractor.extractEntity(layerRef);
                if (!layerEntity) continue;

                const la = layerEntity.attributes || [];
                // IfcMaterialLayer: [Material, LayerThickness, IsVentilated, Name, Description, Category, Priority]
                const matId = typeof la[0] === 'number' ? la[0] : undefined;
                let materialName: string | undefined;
                if (matId) {
                    const matRef = store.entityIndex.byId.get(matId);
                    if (matRef) {
                        const matEntity = extractor.extractEntity(matRef);
                        if (matEntity) {
                            materialName = typeof matEntity.attributes?.[0] === 'string' ? matEntity.attributes[0] : undefined;
                        }
                    }
                }

                layers.push({
                    materialName,
                    thickness: typeof la[1] === 'number' ? la[1] : undefined,
                    isVentilated: la[2] === true || la[2] === '.T.',
                    name: typeof la[3] === 'string' ? la[3] : undefined,
                    category: typeof la[5] === 'string' ? la[5] : undefined,
                });
            }

            return {
                type: 'MaterialLayerSet',
                name: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                description: typeof attrs[2] === 'string' ? attrs[2] : undefined,
                layers,
            };
        }

        case 'IFCMATERIALPROFILESET': {
            // IfcMaterialProfileSet: [Name, Description, MaterialProfiles, CompositeProfile]
            const profileIds = Array.isArray(attrs[2]) ? attrs[2].filter((id): id is number => typeof id === 'number') : [];
            const profiles: MaterialProfileInfo[] = [];

            for (const profId of profileIds) {
                const profRef = store.entityIndex.byId.get(profId);
                if (!profRef) continue;
                const profEntity = extractor.extractEntity(profRef);
                if (!profEntity) continue;

                const pa = profEntity.attributes || [];
                // IfcMaterialProfile: [Name, Description, Material, Profile, Priority, Category]
                const matId = typeof pa[2] === 'number' ? pa[2] : undefined;
                let materialName: string | undefined;
                if (matId) {
                    const matRef = store.entityIndex.byId.get(matId);
                    if (matRef) {
                        const matEntity = extractor.extractEntity(matRef);
                        if (matEntity) {
                            materialName = typeof matEntity.attributes?.[0] === 'string' ? matEntity.attributes[0] : undefined;
                        }
                    }
                }

                profiles.push({
                    materialName,
                    name: typeof pa[0] === 'string' ? pa[0] : undefined,
                    category: typeof pa[5] === 'string' ? pa[5] : undefined,
                });
            }

            return {
                type: 'MaterialProfileSet',
                name: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                description: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                profiles,
            };
        }

        case 'IFCMATERIALCONSTITUENTSET': {
            // IfcMaterialConstituentSet: [Name, Description, MaterialConstituents]
            const constituentIds = Array.isArray(attrs[2]) ? attrs[2].filter((id): id is number => typeof id === 'number') : [];
            const constituents: MaterialConstituentInfo[] = [];

            for (const constId of constituentIds) {
                const constRef = store.entityIndex.byId.get(constId);
                if (!constRef) continue;
                const constEntity = extractor.extractEntity(constRef);
                if (!constEntity) continue;

                const ca = constEntity.attributes || [];
                // IfcMaterialConstituent: [Name, Description, Material, Fraction, Category]
                const matId = typeof ca[2] === 'number' ? ca[2] : undefined;
                let materialName: string | undefined;
                if (matId) {
                    const matRef = store.entityIndex.byId.get(matId);
                    if (matRef) {
                        const matEntity = extractor.extractEntity(matRef);
                        if (matEntity) {
                            materialName = typeof matEntity.attributes?.[0] === 'string' ? matEntity.attributes[0] : undefined;
                        }
                    }
                }

                constituents.push({
                    materialName,
                    name: typeof ca[0] === 'string' ? ca[0] : undefined,
                    fraction: typeof ca[3] === 'number' ? ca[3] : undefined,
                    category: typeof ca[4] === 'string' ? ca[4] : undefined,
                });
            }

            return {
                type: 'MaterialConstituentSet',
                name: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                description: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                constituents,
            };
        }

        case 'IFCMATERIALLIST': {
            // IfcMaterialList: [Materials]
            const matIds = Array.isArray(attrs[0]) ? attrs[0].filter((id): id is number => typeof id === 'number') : [];
            const materials: string[] = [];

            for (const matId of matIds) {
                const matRef = store.entityIndex.byId.get(matId);
                if (!matRef) continue;
                const matEntity = extractor.extractEntity(matRef);
                if (matEntity) {
                    const name = typeof matEntity.attributes?.[0] === 'string' ? matEntity.attributes[0] : `Material #${matId}`;
                    materials.push(name);
                }
            }

            return {
                type: 'MaterialList',
                materials,
            };
        }

        case 'IFCMATERIALLAYERSETUSAGE': {
            // IfcMaterialLayerSetUsage: [ForLayerSet, LayerSetDirection, DirectionSense, OffsetFromReferenceLine, ...]
            const layerSetId = typeof attrs[0] === 'number' ? attrs[0] : undefined;
            if (layerSetId) {
                return resolveMaterial(store, extractor, layerSetId, visited);
            }
            return null;
        }

        case 'IFCMATERIALPROFILESETUSAGE': {
            // IfcMaterialProfileSetUsage: [ForProfileSet, ...]
            const profileSetId = typeof attrs[0] === 'number' ? attrs[0] : undefined;
            if (profileSetId) {
                return resolveMaterial(store, extractor, profileSetId, visited);
            }
            return null;
        }

        default:
            return null;
    }
}

/**
 * Result of type-level property extraction.
 */
export interface TypePropertyInfo {
    typeName: string;
    typeId: number;
    properties: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }>;
}

/**
 * Parse a property entity's value based on its IFC type.
 * Handles all 6 IfcProperty subtypes:
 * - IfcPropertySingleValue: direct value
 * - IfcPropertyEnumeratedValue: list of enum values → joined string
 * - IfcPropertyBoundedValue: upper/lower bounds → "value [min – max]"
 * - IfcPropertyListValue: list of values → joined string
 * - IfcPropertyTableValue: defining/defined value pairs → "Table(N rows)"
 * - IfcPropertyReferenceValue: entity reference → "Reference #ID"
 */
function parsePropertyValue(propEntity: IfcEntity): { type: number; value: PropertyValue } {
    const attrs = propEntity.attributes || [];
    const typeUpper = propEntity.type.toUpperCase();

    switch (typeUpper) {
        case 'IFCPROPERTYENUMERATEDVALUE': {
            // [Name, Description, EnumerationValues (list), EnumerationReference]
            const enumValues = attrs[2];
            if (Array.isArray(enumValues)) {
                const values = enumValues.map(v => {
                    if (Array.isArray(v) && v.length === 2) return String(v[1]); // Typed value
                    return String(v);
                }).filter(v => v !== 'null' && v !== 'undefined');
                return { type: 0, value: values.join(', ') };
            }
            return { type: 0, value: null };
        }

        case 'IFCPROPERTYBOUNDEDVALUE': {
            // [Name, Description, UpperBoundValue, LowerBoundValue, Unit, SetPointValue]
            const upper = extractNumericValue(attrs[2]);
            const lower = extractNumericValue(attrs[3]);
            const setPoint = extractNumericValue(attrs[5]);
            const displayValue = setPoint ?? upper ?? lower;
            let display = displayValue != null ? String(displayValue) : '';
            if (lower != null && upper != null) {
                display += ` [${lower} – ${upper}]`;
            }
            return { type: displayValue != null ? 1 : 0, value: display || null };
        }

        case 'IFCPROPERTYLISTVALUE': {
            // [Name, Description, ListValues (list), Unit]
            const listValues = attrs[2];
            if (Array.isArray(listValues)) {
                const values = listValues.map(v => {
                    if (Array.isArray(v) && v.length === 2) return String(v[1]);
                    return String(v);
                }).filter(v => v !== 'null' && v !== 'undefined');
                return { type: 0, value: values.join(', ') };
            }
            return { type: 0, value: null };
        }

        case 'IFCPROPERTYTABLEVALUE': {
            // [Name, Description, DefiningValues, DefinedValues, ...]
            const definingValues = attrs[2];
            const definedValues = attrs[3];
            const rowCount = Array.isArray(definingValues) ? definingValues.length : 0;
            if (rowCount > 0 && Array.isArray(definedValues)) {
                return { type: 0, value: `Table (${rowCount} rows)` };
            }
            return { type: 0, value: null };
        }

        case 'IFCPROPERTYREFERENCEVALUE': {
            // [Name, Description, PropertyReference]
            const refValue = attrs[2];
            if (typeof refValue === 'number') {
                return { type: 0, value: `#${refValue}` };
            }
            return { type: 0, value: null };
        }

        default: {
            // IfcPropertySingleValue and fallback: [Name, Description, NominalValue, Unit]
            const nominalValue = attrs[2];
            let type = 0;
            let value: PropertyValue = nominalValue as PropertyValue;

            // Handle typed values like IFCBOOLEAN(.T.), IFCREAL(1.5)
            if (Array.isArray(nominalValue) && nominalValue.length === 2) {
                const innerValue = nominalValue[1];
                const typeName = String(nominalValue[0]).toUpperCase();

                if (typeName.includes('BOOLEAN') || typeName.includes('LOGICAL')) {
                    type = 2;
                    value = innerValue === '.T.' || innerValue === true;
                } else if (typeof innerValue === 'number') {
                    type = 1;
                    value = innerValue;
                } else {
                    type = 0;
                    value = String(innerValue);
                }
            } else if (typeof nominalValue === 'number') {
                type = 1;
            } else if (typeof nominalValue === 'boolean') {
                type = 2;
            } else if (nominalValue !== null && nominalValue !== undefined) {
                value = String(nominalValue);
            }

            return { type, value };
        }
    }
}

/** Extract a numeric value from a possibly typed STEP value. */
function extractNumericValue(attr: unknown): number | null {
    if (typeof attr === 'number') return attr;
    if (Array.isArray(attr) && attr.length === 2 && typeof attr[1] === 'number') return attr[1];
    return null;
}

/**
 * Extract property sets from a list of pset IDs using the entity index.
 * Shared logic between instance-level and type-level property extraction.
 */
function extractPsetsFromIds(
    store: IfcDataStore,
    extractor: EntityExtractor,
    psetIds: number[]
): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> {
    const result: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> = [];

    for (const psetId of psetIds) {
        const psetRef = store.entityIndex.byId.get(psetId);
        if (!psetRef) continue;

        // Only extract IFCPROPERTYSET entities (skip quantity sets etc.)
        if (psetRef.type.toUpperCase() !== 'IFCPROPERTYSET') continue;

        const psetEntity = extractor.extractEntity(psetRef);
        if (!psetEntity) continue;

        const psetAttrs = psetEntity.attributes || [];
        const psetGlobalId = typeof psetAttrs[0] === 'string' ? psetAttrs[0] : undefined;
        const psetName = typeof psetAttrs[2] === 'string' ? psetAttrs[2] : `PropertySet #${psetId}`;
        const hasProperties = psetAttrs[4];

        const properties: Array<{ name: string; type: number; value: PropertyValue }> = [];

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

                const parsed = parsePropertyValue(propEntity);
                properties.push({ name: propName, type: parsed.type, value: parsed.value });
            }
        }

        if (properties.length > 0 || psetName) {
            result.push({ name: psetName, globalId: psetGlobalId, properties });
        }
    }

    return result;
}

/**
 * Extract type-level properties for a single entity ON-DEMAND.
 * Finds the element's type via IfcRelDefinesByType, then extracts property sets from:
 * 1. The type entity's HasPropertySets attribute (IFC2X3/IFC4: index 5 on IfcTypeObject)
 * 2. The onDemandPropertyMap for the type entity (IFC4 IFCRELDEFINESBYPROPERTIES → type)
 * Returns null if no type relationship exists.
 */
export function extractTypePropertiesOnDemand(
    store: IfcDataStore,
    entityId: number
): TypePropertyInfo | null {
    if (!store.relationships) return null;

    // Find type entity via DefinesByType relationship (inverse: element → type)
    const typeIds = store.relationships.getRelated(entityId, RelationshipType.DefinesByType, 'inverse');
    if (typeIds.length === 0) return null;

    const typeId = typeIds[0]; // An element typically has one type
    const typeRef = store.entityIndex.byId.get(typeId);
    if (!typeRef) return null;

    if (!store.source?.length) return null;

    const extractor = new EntityExtractor(store.source);

    // Get type name from entity
    const typeEntity = extractor.extractEntity(typeRef);
    const typeName = typeEntity && typeof typeEntity.attributes?.[2] === 'string'
        ? typeEntity.attributes[2]
        : typeRef.type;

    const allPsets: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> = [];
    const seenPsetNames = new Set<string>();

    // Source 1: HasPropertySets attribute on the type entity (index 5 for IfcTypeObject subtypes)
    // Works for both IFC2X3 and IFC4
    if (typeEntity) {
        const hasPropertySets = typeEntity.attributes?.[5];
        if (Array.isArray(hasPropertySets)) {
            const psetIds = hasPropertySets.filter((id): id is number => typeof id === 'number');
            const psets = extractPsetsFromIds(store, extractor, psetIds);
            for (const pset of psets) {
                seenPsetNames.add(pset.name);
                allPsets.push(pset);
            }
        }
    }

    // Source 2: onDemandPropertyMap for the type entity (IFC4: via IFCRELDEFINESBYPROPERTIES)
    if (store.onDemandPropertyMap) {
        const typePsetIds = store.onDemandPropertyMap.get(typeId);
        if (typePsetIds && typePsetIds.length > 0) {
            const psets = extractPsetsFromIds(store, extractor, typePsetIds);
            for (const pset of psets) {
                if (!seenPsetNames.has(pset.name)) {
                    allPsets.push(pset);
                }
            }
        }
    }

    if (allPsets.length === 0) return null;

    return {
        typeName,
        typeId,
        properties: allPsets,
    };
}

/**
 * Structured document info from IFC document references.
 */
export interface DocumentInfo {
    name?: string;
    description?: string;
    location?: string;
    identification?: string;
    purpose?: string;
    intendedUse?: string;
    revision?: string;
    confidentiality?: string;
}

/**
 * Extract documents for a single entity ON-DEMAND.
 * Uses the onDemandDocumentMap built during parsing.
 * Falls back to relationship graph when on-demand map is not available.
 * Also checks type-level documents via IfcRelDefinesByType.
 * Returns an array of document info objects.
 */
export function extractDocumentsOnDemand(
    store: IfcDataStore,
    entityId: number
): DocumentInfo[] {
    let docRefIds: number[] | undefined;

    if (store.onDemandDocumentMap) {
        docRefIds = store.onDemandDocumentMap.get(entityId);
    } else if (store.relationships) {
        const related = store.relationships.getRelated(entityId, RelationshipType.AssociatesDocument, 'inverse');
        if (related.length > 0) docRefIds = related;
    }

    // Also check type-level documents via IfcRelDefinesByType
    if (store.relationships) {
        const typeIds = store.relationships.getRelated(entityId, RelationshipType.DefinesByType, 'inverse');
        for (const typeId of typeIds) {
            let typeDocRefs: number[] | undefined;
            if (store.onDemandDocumentMap) {
                typeDocRefs = store.onDemandDocumentMap.get(typeId);
            } else {
                const related = store.relationships.getRelated(typeId, RelationshipType.AssociatesDocument, 'inverse');
                if (related.length > 0) typeDocRefs = related;
            }
            if (typeDocRefs && typeDocRefs.length > 0) {
                docRefIds = docRefIds ? [...docRefIds, ...typeDocRefs] : [...typeDocRefs];
            }
        }
    }

    if (!docRefIds || docRefIds.length === 0) return [];
    if (!store.source?.length) return [];

    const extractor = new EntityExtractor(store.source);
    const results: DocumentInfo[] = [];

    for (const docId of docRefIds) {
        const docRef = store.entityIndex.byId.get(docId);
        if (!docRef) continue;

        const docEntity = extractor.extractEntity(docRef);
        if (!docEntity) continue;

        const typeUpper = docEntity.type.toUpperCase();
        const attrs = docEntity.attributes || [];

        if (typeUpper === 'IFCDOCUMENTREFERENCE') {
            // IFC4: [Location, Identification, Name, Description, ReferencedDocument]
            // IFC2X3: [Location, ItemReference, Name]
            const info: DocumentInfo = {
                location: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                identification: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                name: typeof attrs[2] === 'string' ? attrs[2] : undefined,
                description: typeof attrs[3] === 'string' ? attrs[3] : undefined,
            };

            // Walk to IfcDocumentInformation if ReferencedDocument is set (IFC4 attr[4])
            if (typeof attrs[4] === 'number') {
                const docInfoRef = store.entityIndex.byId.get(attrs[4]);
                if (docInfoRef) {
                    const docInfoEntity = extractor.extractEntity(docInfoRef);
                    if (docInfoEntity && docInfoEntity.type.toUpperCase() === 'IFCDOCUMENTINFORMATION') {
                        const ia = docInfoEntity.attributes || [];
                        // IfcDocumentInformation: [Identification, Name, Description, Location, Purpose, IntendedUse, Scope, Revision, ...]
                        if (!info.identification && typeof ia[0] === 'string') info.identification = ia[0];
                        if (!info.name && typeof ia[1] === 'string') info.name = ia[1];
                        if (!info.description && typeof ia[2] === 'string') info.description = ia[2];
                        if (!info.location && typeof ia[3] === 'string') info.location = ia[3];
                        if (typeof ia[4] === 'string') info.purpose = ia[4];
                        if (typeof ia[5] === 'string') info.intendedUse = ia[5];
                        if (typeof ia[7] === 'string') info.revision = ia[7];
                    }
                }
            }

            if (info.name || info.location || info.identification) {
                results.push(info);
            }
        } else if (typeUpper === 'IFCDOCUMENTINFORMATION') {
            // Direct IfcDocumentInformation (less common)
            const info: DocumentInfo = {
                identification: typeof attrs[0] === 'string' ? attrs[0] : undefined,
                name: typeof attrs[1] === 'string' ? attrs[1] : undefined,
                description: typeof attrs[2] === 'string' ? attrs[2] : undefined,
                location: typeof attrs[3] === 'string' ? attrs[3] : undefined,
                purpose: typeof attrs[4] === 'string' ? attrs[4] : undefined,
                intendedUse: typeof attrs[5] === 'string' ? attrs[5] : undefined,
                revision: typeof attrs[7] === 'string' ? attrs[7] : undefined,
            };

            if (info.name || info.location || info.identification) {
                results.push(info);
            }
        }
    }

    return results;
}

/**
 * Structured relationship info for an entity.
 */
export interface EntityRelationships {
    voids: Array<{ id: number; name?: string; type: string }>;
    fills: Array<{ id: number; name?: string; type: string }>;
    groups: Array<{ id: number; name?: string }>;
    connections: Array<{ id: number; name?: string; type: string }>;
}

/**
 * Extract structural relationships for a single entity ON-DEMAND.
 * Finds openings (VoidsElement), fills (FillsElement), groups (AssignsToGroup),
 * and path connections (ConnectsPathElements).
 */
export function extractRelationshipsOnDemand(
    store: IfcDataStore,
    entityId: number
): EntityRelationships {
    const result: EntityRelationships = {
        voids: [],
        fills: [],
        groups: [],
        connections: [],
    };

    if (!store.relationships) return result;

    const getEntityInfo = (id: number): { name?: string; type: string } => {
        const ref = store.entityIndex.byId.get(id);
        if (!ref) return { type: 'Unknown' };
        const name = store.entities?.getName(id);
        return { name: name || undefined, type: ref.type };
    };

    // VoidsElement: openings that void this element
    const voidsIds = store.relationships.getRelated(entityId, RelationshipType.VoidsElement, 'forward');
    for (const id of voidsIds) {
        const info = getEntityInfo(id);
        result.voids.push({ id, ...info });
    }

    // FillsElement: this element fills an opening
    const fillsIds = store.relationships.getRelated(entityId, RelationshipType.FillsElement, 'inverse');
    for (const id of fillsIds) {
        const info = getEntityInfo(id);
        result.fills.push({ id, ...info });
    }

    // AssignsToGroup: groups this element belongs to
    const groupIds = store.relationships.getRelated(entityId, RelationshipType.AssignsToGroup, 'inverse');
    for (const id of groupIds) {
        const name = store.entities?.getName(id);
        result.groups.push({ id, name: name || undefined });
    }

    // ConnectsPathElements: connected walls
    const connectedIds = store.relationships.getRelated(entityId, RelationshipType.ConnectsPathElements, 'forward');
    const connectedInverseIds = store.relationships.getRelated(entityId, RelationshipType.ConnectsPathElements, 'inverse');
    const allConnected = new Set([...connectedIds, ...connectedInverseIds]);
    allConnected.delete(entityId);
    for (const id of allConnected) {
        const info = getEntityInfo(id);
        result.connections.push({ id, ...info });
    }

    return result;
}

// ============================================================================
// On-Demand Georeferencing Extraction
// ============================================================================

import { extractGeoreferencing as extractGeorefFromEntities, type GeoreferenceInfo } from './georef-extractor.js';
export type { GeoreferenceInfo as GeorefInfo };

/**
 * Extract georeferencing info from on-demand store (source buffer + entityIndex).
 * Bridges to the entity-based georef extractor by resolving entities lazily.
 */
export function extractGeoreferencingOnDemand(store: IfcDataStore): GeoreferenceInfo | null {
    if (!store.source?.length || !store.entityIndex) return null;

    const extractor = new EntityExtractor(store.source);
    const { byId, byType } = store.entityIndex;

    // Build a lightweight entity map for just the georef-related types
    const entityMap = new Map<number, { expressId: number; attributes: unknown[] }>();
    const typeMap = new Map<string, number[]>();

    for (const typeName of ['IFCMAPCONVERSION', 'IFCPROJECTEDCRS']) {
        const ids = byType.get(typeName);
        if (!ids?.length) continue;

        // Use mixed-case for the georef extractor's type lookup
        const displayName = typeName === 'IFCMAPCONVERSION' ? 'IfcMapConversion' : 'IfcProjectedCRS';
        typeMap.set(displayName, ids);

        for (const id of ids) {
            const ref = byId.get(id);
            if (!ref) continue;
            const entity = extractor.extractEntity(ref);
            if (entity) {
                entityMap.set(id, entity);
            }
        }
    }

    if (entityMap.size === 0) return null;

    // Cast to IfcEntity (they share the same shape)
    return extractGeorefFromEntities(entityMap as Parameters<typeof extractGeorefFromEntities>[0], typeMap);
}
